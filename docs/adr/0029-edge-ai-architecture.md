# ADR-0029 — Edge AI Architecture (Substrate Seat)

**Status:** Accepted
**Date:** 2026-05-16
**Decision-makers:** Ozan (lead)

## Context

The CEO's strategic vision frames Relowa as the unifier of three pillars: Rubicon (operations) × Sensoneo (IoT) × **Greyparrot (Edge AI)**. The competitive matrix marks "In-Facility AI (Computer Vision)" as a core feature.

The supplementary briefing specifies:

- **Edge AI inference units** mounted over recycling-facility conveyor belts.
- High-resolution industrial cameras (60+ fps).
- **GPU at the edge** — Jetson Nano / Xavier or similar — running inference locally (latency budget too tight for round-trip to cloud).
- **Instance segmentation** — pixel-level classification of waste streams.
- **89+ material categories at 98% accuracy** (Greyparrot's published spec).
- **Purity score** output per conveyor lot: "%96.4 PET" etc.
- **Greyparrot adapter for P1** (cloud API); **self-hosted edge units for Phase 3**.

The challenge:

- **Cloud-based Greyparrot calls** (current ADR-0010 / PRD-0006 stub) are fine for photo-uploaded analysis at tender creation.
- **Real conveyor-belt analytics** require on-premise inference — the cameras feed 60+ fps; round-trip to AWS at minimum 100ms latency yields backlogs in seconds and seconds become unprocessed images.

ADR-0029 addresses this separately from PRD-0006 because:

1. **PRD-0006 specifies the AIScan adapter** for cloud / photo-based inference (Greyparrot API).
2. **This ADR specifies the edge inference architecture** for on-premise units — completely different deployment model (physical hardware at customer facility, not cloud API).

Phase 1 ships **substrate only** (Q4 decision). The schema, the data flow back to cloud, and the management interface land in P1. The first physical edge unit ships in Phase 2 or Phase 3.

## Decision

We adopt an **edge AI architecture** with:

- A canonical schema for inference units (physical devices), inference jobs, inference results, and per-frame audit.
- Adapter pattern: `EdgeAIProvider` interface, implementations: `MockEdgeAI`, `GreyparrotEdgeAdapter`, `RelowaSelfHostedAdapter`.
- Cloud-side ingestion of edge results (similar to IoT telemetry in ADR-0028 but with different cadence and payload).
- Integration with quality_inspection records (ADR-0026) — edge AI scan IS a quality inspection.
- HaaS-style billing (ADR-0024 — `edge_ai_unit_lease`).
- Bi-directional control plane — cloud can update the unit's model, request specific scans, retrieve logs.

### 1. Schema (M4 — substrate-only)

```sql
CREATE TYPE inference_unit_type AS ENUM (
  'conveyor_belt_camera',    -- the main Greyparrot-style use case
  'depot_intake_camera',     -- 3D depth/LiDAR for volume verification at warehouse entry
  'safety_camera',           -- gas-leak detection + perimeter security
  'gate_anpr',               -- license-plate / vehicle ID at facility gates
  'multi_purpose'
);

CREATE TYPE inference_unit_status AS ENUM (
  'provisioned',
  'shipped',
  'installed',
  'online',
  'offline',
  'updating',
  'maintenance',
  'decommissioned'
);

-- Physical AI inference units. Bound to a facility.
-- Note: NOT the same as devices in ADR-0028 (those are sensors).
-- These are GPU+camera units that run ML models.
CREATE TABLE ai_inference_units (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_serial              TEXT NOT NULL UNIQUE,
  unit_type                inference_unit_type NOT NULL,
  provider                 TEXT NOT NULL,                       -- 'mock' | 'greyparrot' | 'relowa_self_hosted'
  model_hardware           TEXT,                                 -- 'Jetson Xavier NX', 'Jetson AGX', 'Coral Dev Board'
  -- Software
  ml_model_id              TEXT,                                 -- model version currently running
  ml_model_version         TEXT,
  firmware_version         TEXT,
  -- Deployment
  org_id                   UUID REFERENCES organizations(id) ON DELETE SET NULL,
  facility_id              UUID REFERENCES facilities(id),
  installed_at             TIMESTAMPTZ,
  installed_by_user_id     UUID REFERENCES users(id),
  -- The physical observation surface
  observation_zone         TEXT,                                 -- 'conveyor_line_1', 'depot_gate', etc.
  observation_metadata     jsonb,                                -- camera angle, FOV, lighting conditions
  -- Connectivity (units are typically wired Ethernet, less power-constrained than ADR-0028 sensors)
  connectivity             TEXT,                                  -- 'ethernet' | 'wifi' | 'cellular'
  aws_iot_thing_name       TEXT UNIQUE,
  control_plane_topic      TEXT,                                  -- bi-directional MQTT
  -- Status
  status                   inference_unit_status NOT NULL DEFAULT 'provisioned',
  last_heartbeat_at        TIMESTAMPTZ,
  -- Billing
  haas_subscription_id     UUID REFERENCES org_subscriptions(id),
  monthly_lease_amount     numeric(10,2),
  -- Performance
  fps_typical              INTEGER,                                -- 60 typical
  models_loaded            TEXT[],                                  -- list of ml_model_ids
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  decommissioned_at        TIMESTAMPTZ
);

CREATE INDEX ai_units_org_idx        ON ai_inference_units(org_id);
CREATE INDEX ai_units_facility_idx   ON ai_inference_units(facility_id);
CREATE INDEX ai_units_status_idx     ON ai_inference_units(status);

-- Catalog of ML models that can run on inference units.
CREATE TABLE ml_models (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key            TEXT NOT NULL UNIQUE,                     -- 'greyparrot-detect-v1'
  display_name         TEXT NOT NULL,
  description          TEXT,
  task                 TEXT NOT NULL,                            -- 'detection' | 'segmentation' | 'classification'
  framework            TEXT,                                      -- 'onnx' | 'tflite' | 'pytorch'
  model_size_mb        numeric(8,2),
  inference_target_fps INTEGER,
  output_schema        jsonb NOT NULL,                            -- shape of inference_results.output
  s3_uri               TEXT,                                       -- model file location
  is_default           BOOLEAN NOT NULL DEFAULT false,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  released_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A run / session of an inference unit on a specific observation context.
-- Typically corresponds to one shift of operation, or one truck-load processing.
CREATE TABLE inference_jobs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_unit_id               UUID NOT NULL REFERENCES ai_inference_units(id),
  org_id                   UUID NOT NULL REFERENCES organizations(id),
  facility_id              UUID NOT NULL REFERENCES facilities(id),
  -- Context binding (these link the inference job to business entities)
  order_id                 UUID REFERENCES orders(id),            -- if this scan is for a specific order
  tender_id                UUID REFERENCES tenders(id),
  shipment_id              UUID REFERENCES shipments(id),
  quality_inspection_id    UUID REFERENCES quality_inspections(id),
  -- Job lifecycle
  job_type                 TEXT NOT NULL,                         -- 'continuous_belt' | 'truck_intake' | 'on_demand'
  status                   TEXT NOT NULL DEFAULT 'queued',        -- 'queued' | 'running' | 'completed' | 'failed'
  started_at               TIMESTAMPTZ,
  ended_at                 TIMESTAMPTZ,
  triggered_by_user_id     UUID REFERENCES users(id),
  ml_model_id              UUID REFERENCES ml_models(id),
  total_frames_processed   INTEGER NOT NULL DEFAULT 0,
  -- Summary outputs (computed from individual inference_results)
  purity_score             numeric(4,3),                           -- 0.000-1.000
  composition_breakdown    jsonb,                                  -- {'pet': 0.92, 'hdpe': 0.05, ...}
  contamination_pct        numeric(5,2),
  total_mass_kg            numeric(12,2),                          -- if estimated
  failure_reason           TEXT,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX inference_jobs_org_idx     ON inference_jobs(org_id, created_at DESC);
CREATE INDEX inference_jobs_unit_idx    ON inference_jobs(ai_unit_id, created_at DESC);
CREATE INDEX inference_jobs_order_idx   ON inference_jobs(order_id);
CREATE INDEX inference_jobs_running     ON inference_jobs(status) WHERE status = 'running';

-- Individual frame results from a job.
-- Most are aggregated into inference_jobs summary; raw frames kept for audit + retraining.
CREATE TABLE inference_results (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inference_job_id         UUID NOT NULL REFERENCES inference_jobs(id) ON DELETE CASCADE,
  -- The frame
  frame_index              INTEGER NOT NULL,
  captured_at              TIMESTAMPTZ NOT NULL,
  -- Model output
  detections               jsonb,                                  -- [{class, bbox, confidence}, ...]
  segmentation_summary     jsonb,                                  -- per-class pixel coverage
  composition              jsonb,                                  -- {'pet': 0.85, 'contamination': 0.05}
  confidence_avg           numeric(4,3),
  -- Storage (sampling — not every frame is stored)
  frame_s3_key             TEXT,                                    -- null if frame not retained
  is_anomaly               BOOLEAN NOT NULL DEFAULT false,         -- model flagged unusual content
  anomaly_reason           TEXT,
  processing_time_ms       INTEGER,                                 -- per-frame
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
)
PARTITION BY RANGE (captured_at);

-- Monthly partitions
CREATE TABLE inference_results_2026_01 PARTITION OF inference_results
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
-- ...

CREATE INDEX inference_results_job_idx ON inference_results(inference_job_id, frame_index);
CREATE INDEX inference_results_anomaly_idx ON inference_results(captured_at DESC) WHERE is_anomaly = true;

-- Bi-directional control plane: commands sent to units.
CREATE TABLE ai_unit_commands (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_unit_id               UUID NOT NULL REFERENCES ai_inference_units(id),
  command_type             TEXT NOT NULL,                          -- 'update_model' | 'restart' | 'capture_frame' | 'set_fps'
  command_params           jsonb,
  issued_by_user_id        UUID REFERENCES users(id),
  issued_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at          TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  status                   TEXT NOT NULL DEFAULT 'pending',         -- 'pending' | 'acked' | 'completed' | 'failed'
  failure_reason           TEXT
);

CREATE INDEX ai_unit_commands_pending ON ai_unit_commands(ai_unit_id, issued_at) WHERE status = 'pending';
```

### 2. RLS

```sql
ALTER TABLE ai_inference_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_units_select_own_org ON ai_inference_units
  FOR SELECT USING (org_id = auth.org_id());

-- Inference jobs visible to: org, plus any party of an associated order
ALTER TABLE inference_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY inference_jobs_select_involved ON inference_jobs
  FOR SELECT USING (
    org_id = auth.org_id()
    OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = inference_jobs.order_id
        AND (o.producer_org_id = auth.org_id()
             OR o.recycler_org_id = auth.org_id()
             OR o.carrier_org_id = auth.org_id())
    )
  );

-- Same pattern for inference_results
```

This means a producer can see the purity score of a tender they sold, because it's bound to their order. They can't see other producers' purity scores.

### 3. Bi-directional control flow

Edge units run a long-lived MQTT connection to AWS IoT Core (per ADR-0028). Bidirectional:

```
                 INGESTION (unit → cloud)
Edge Unit  ───────────────────────────────►  AWS IoT Core
   GPU                                          │
   processes 60fps                              ▼
   inference_results               Lambda processes
   (sampled)                       per inference_results row
                                          │
                                          ├── aggregations updated
                                          ├── job summary computed
                                          └── outbox events emitted

                 CONTROL (cloud → unit)
Lambda  ◄──────────────────────────────  Edge Unit
   /api/ai-units/:id/command            polls control_plane_topic
   inserts ai_unit_commands             executes (update_model, restart...)
   row, IoT Core publishes              acknowledges via MQTT
   to control_plane_topic
```

### 4. EdgeAIProvider adapter interface

```ts
// packages/edge-ai/provider.interface.ts
export interface EdgeAIProvider {
  readonly name: 'mock' | 'greyparrot' | 'relowa_self_hosted';

  /**
   * Provision a new inference unit (returns AWS IoT thing name + control topic).
   */
  provisionUnit(req: {
    ourUnitId: string;
    facilityId: string;
    unitType: InferenceUnitType;
    modelKey: string;
  }): Promise<{
    providerUnitId: string;
    awsIotThingName: string;
    controlPlaneTopic: string;
    installShipmentTrackingNumber?: string;  // if provider ships physical hardware
  }>;

  /**
   * Trigger a job on the unit (e.g. "process this truck-load at gate camera").
   */
  startJob(req: {
    inferenceJobId: string;
    providerUnitId: string;
    jobType: JobType;
    context: { orderId?: string; tenderId?: string; shipmentId?: string };
    modelKey: string;
    durationSeconds?: number;
  }): Promise<{ providerJobId: string; estimatedDurationSeconds: number }>;

  /**
   * Receive per-frame results from the unit.
   * Adapter normalizes provider-specific schema to our canonical format.
   */
  parseFrameResult(req: {
    rawPayload: Buffer;
    topic: string;
  }): Promise<{
    jobId: string;
    frameIndex: number;
    capturedAt: Date;
    detections: any[];
    composition: Record<string, number>;
    confidence: number;
  }>;

  /**
   * Issue control plane command.
   */
  sendCommand?(req: {
    providerUnitId: string;
    commandType: string;
    params: Record<string, any>;
  }): Promise<{ commandId: string }>;

  /**
   * Validate webhook (if provider uses webhooks for events outside MQTT).
   */
  verifyWebhook(req: { headers; body }): Promise<{
    valid: boolean;
    eventType: string;
    payload: unknown;
  }>;
}
```

### 5. MockEdgeAI — P1 implementation

For dev + demo:

- `POST /dev/mock-ai-units/provision { count, facility_id }` creates synthetic units.
- Synthetic units emit plausible inference results when a job runs (purity scores around 90-98%, occasional contamination flags, occasional anomalies).
- Models "trained" on the canonical waste material categories.
- Realistic processing times (50-100ms per frame).
- Configurable failure modes (offline simulation, "model corruption" simulation).

This allows full e2e testing of the AI scan flow without any physical hardware.

### 6. Greyparrot adapter — Phase 2/3

When Greyparrot integration lands (in a focused ADR similar to ADR-0027 → ADR-0030 future plans):

- `GreyparrotEdgeAdapter.parseFrameResult` maps Greyparrot's JSON schema to ours.
- Greyparrot provides the physical unit (hardware-as-a-service from them, re-sold as part of our Enterprise tier).
- Bi-directional control via Greyparrot's API.

We may instead pursue **Relowa-branded self-hosted units** in Phase 3 — develop our own model + hardware. The schema accommodates either.

### 7. Quality inspection integration (ADR-0026)

When an edge AI unit processes a truck load at depot intake:

1. Unit detects truck arrival (gate ANPR + tonnage from weighbridge → ADR-0028 sensors).
2. inference_job row created with `quality_inspection_id` link.
3. Unit processes the truck contents for N minutes.
4. job ends → purity_score, composition, contamination computed.
5. quality_inspection row updated with `purity_score`, `ai_scan_id` (FK to inference_job).
6. If purity passes threshold → order proceeds; if fails → dispute triggered.

The AI scan IS the quality inspection for facility-operated MRFs. For tender-photo scans (the simpler Greyparrot-cloud-API case from PRD-0006), `AIScanProvider` handles those separately — they live in `ai_analyses`, not `inference_jobs`.

### 8. Data privacy & retention

- Inference frames may contain identifying material (truck plates, faces) — strip / blur before retaining for ML training.
- Raw frames retained: 30 days default, longer if customer opts in.
- Aggregated metrics retained: indefinite.
- Customer right to delete: data scoped to org via RLS; deletion removes their inference history.
- Models train on **anonymized** aggregate data; no individual customer's data trains models that benefit competitors.

### 9. HaaS billing for AI units

Per ADR-0024:

- Enterprise tier feature flag: `edge_ai_units_included = N` (e.g. 1).
- Beyond N, monthly_lease_amount per unit (typically 25,000₺/mo per Greyparrot-style line per CEO matrix).
- Monthly billing line items generated by background Lambda.

### 10. Substrate-vs-implementation table

| Element | P1 ships | P2 ships | P3 ships |
|---|---|---|---|
| Schema (units, jobs, results, ml_models) | ✅ Full | — | — |
| EdgeAIProvider interface | ✅ Defined | — | — |
| MockEdgeAI | ✅ Operational | — | — |
| AWS IoT Core control plane | ⏳ Terraform-described | ✅ Deployed | — |
| Ingestion Lambda | ✅ Coded against Mock | ✅ Live data | — |
| GreyparrotEdgeAdapter | — | ✅ Real hardware | — |
| Relowa-branded units | — | — | ✅ |
| Model OTA updates | — | ✅ | — |
| Real-time dashboard | ✅ Mock data | ✅ Live | — |
| Custom model training | — | — | ✅ |

## Consequences

### Positive

- **Phase 1 substrate accepts everything needed for Phase 2** — schema, control plane, billing, RLS.
- **Quality inspection has an AI source** when units deploy.
- **HaaS for AI units is sellable from day one** in the Enterprise tier matrix.
- **Adapter pattern keeps Greyparrot vs self-hosted as an implementation detail.**
- **Bi-directional control plane** enables true managed-device experience (vs sensors which are mostly read-only).

### Negative

- **High substrate cost** — 5 new tables in M4. AWS IoT Core configuration. Mitigated by mock-only operation in P1.
- **Storage of inference_results frames** can grow fast (60 fps × 8h shift × 30 days = ~50M frames per unit). Mitigated by sampling + 30-day retention default.
- **Real edge unit cost is high** — 25,000₺/month per line. Only viable for large recyclers (Enterprise tier).

## Future plans

- **GreyparrotEdgeAdapter (P2)** — when first MRF customer signs Enterprise tier with AI.
- **Relowa-branded AI units** (P3) — co-developed with hardware contract manufacturer.
- **Custom ML model training** (P3) — using anonymized aggregate data; per-customer fine-tuned models.
- **Multi-zone inference** — one unit watches multiple conveyor lines (P2).
- **Brand-analysis** — beyond material, identify packaging brands for circular economy metrics (P3).
- **Predictive contamination alerts** — Phase 3 ML.
- **Drone-based intake inspection** — for outdoor depot scenarios (P4).
- **Cross-facility model federation** — federated learning across customer sites without sharing raw data (P3).
- **AI-augmented dispute resolution** — auto-replay disputed inferences for super_admin review (P3).

## Alternatives considered

| Option | Rejected because |
|---|---|
| No edge AI substrate; only cloud Greyparrot API | The competitive matrix's "In-Facility AI" promise becomes false. MRF customers expect on-premise. |
| Build Edge AI from scratch in P1 | Solo lead overwhelm; Greyparrot's 98% accuracy on 89 categories isn't replicable in 4 months. |
| Centralize all inference (cloud only) | Conveyor 60fps × 100ms latency = unprocessable backlog. Edge is required. |
| Reuse `devices` table for AI units | Confuses sensor data with inference data. Different cadence, different payload, different management. |
| Make `AIScanProvider` handle both photo and edge | Cloud photo and edge belt are fundamentally different deployments. Two interfaces is correct. |

## Reference

- ADR-0026 — Orders + quality_inspections (consumer of AI scan results at depot intake)
- ADR-0028 — IoT ingestion (parallel pattern for sensors)
- ADR-0024 — Subscription tiers (HaaS billing for edge units)
- ADR-0025 — Facilities (units bind to facility)
- PRD-0006 — Provider integration (parallel `AIScanProvider` for cloud photo case)
- PRD-0008 — Pricing engine (per-tier inclusion of AI units)
- PRD-0010 — Phase 2/3/4 vision
- Greyparrot: https://www.greyparrot.ai
- NVIDIA Jetson: https://developer.nvidia.com/embedded-computing
- AWS IoT Greengrass (edge ML deployment): https://aws.amazon.com/greengrass/
