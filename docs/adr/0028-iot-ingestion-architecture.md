# ADR-0028 — IoT Ingestion Architecture (Substrate Seat)

**Status:** Accepted
**Date:** 2026-05-16
**Decision-makers:** Ozan (lead)

## Context

The CEO's vision positions Relowa as the unifier of three vertical pillars: Rubicon (operations), Greyparrot (AI), and **Sensoneo (IoT)**. The CEO's competitive matrix marks "Smart Container & IoT Tracking" as a core feature, and the Gelir Modeli slide explicitly lists **HaaS (Hardware-as-a-Service)** revenue: 1500₺/month per smart sensor device.

The supplementary briefing describes the technology stack:

- **Ultrasonic sensors** on container lids, measuring fill level via time-of-flight.
- **Gas sensors** (CH4, CO2, VOC) at warehouses for safety / anomaly detection.
- **Temperature, weight, RFID** for hazardous material tracking.
- **LPWAN protocols** — NB-IoT, LoRaWAN, Sigfox, Cat-M1 — for low-power, wide-area connectivity.
- **MQTT** as the messaging protocol, **AWS IoT Core** as the broker.
- 10-year battery life on sensors.

Phase 1 does NOT deploy hardware. But the substrate must accept telemetry today so that:

1. The HaaS subscription tier (ADR-0024) is sellable from day one — even if the first hardware deployment is M+9.
2. Phase 2 hardware ships into a production-ready ingest pipeline, not a green-field rebuild.
3. The frontend "Bin Status" widget (Figma stub) can read live data the moment sensors are deployed.
4. The VRP engine (ADR-0027) can consume fill-level telemetry as input for dynamic routing — even with simulated telemetry in P1.
5. ESG reporting incorporates real-time waste-generation data from M+9 onward.

Substrate-now-implementation-later is the same pattern as ADR-0027 (route engine) and ADR-0029 (edge AI).

## Decision

We adopt a **provider-agnostic IoT ingestion substrate** with:

- AWS IoT Core as the MQTT broker (managed, EU-resident, scales).
- A canonical schema for devices, telemetry, and aggregations.
- A `DeviceProvider` adapter interface (mirroring the EscrowProvider pattern).
- A `MockDeviceProvider` in P1 for testing + demo (emits synthetic telemetry).
- Real sensor provider adapters (`SensoneoAdapter`, `RelowaCustomAdapter`) in Phase 2 when hardware ships.
- Integration with HaaS subscription billing (ADR-0024).

### 1. Schema (M3 — substrate-only, no live data yet)

```sql
CREATE TYPE device_type AS ENUM (
  'ultrasonic_fill',      -- container fill-level sensor
  'gas_safety',           -- methane / VOC / CO2 at warehouse
  'temperature',          -- heat at hazardous material storage
  'weight',               -- container weighing platform
  'rfid_reader',          -- container tracking
  'gps_tracker',          -- vehicle-mounted GPS
  'camera',               -- security camera at facility (NOT computer vision; that's ADR-0029)
  'multi_sensor',         -- combination unit
  'gateway'               -- LPWAN gateway hub
);

CREATE TYPE device_status AS ENUM (
  'provisioned',         -- in inventory, not yet deployed
  'deployed',            -- installed at customer site
  'online',              -- last heartbeat within 24h
  'offline',             -- not heard from in 24h+
  'maintenance',
  'decommissioned'
);

CREATE TYPE connectivity_protocol AS ENUM (
  'nb_iot',
  'lorawan',
  'sigfox',
  'cat_m1',
  'wifi',
  'cellular_4g',
  'ethernet'
);

-- Device inventory. Each row is a physical sensor / device.
CREATE TABLE devices (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_serial            TEXT NOT NULL UNIQUE,
  device_type              device_type NOT NULL,
  provider                 TEXT NOT NULL,                       -- 'sensoneo' | 'custom' | 'mock'
  model                    TEXT,                                 -- 'Sensoneo SingleSensor 2.0'
  hardware_version         TEXT,
  firmware_version         TEXT,
  -- Ownership + deployment
  org_id                   UUID REFERENCES organizations(id) ON DELETE SET NULL,  -- customer who owns/leases
  facility_id              UUID REFERENCES facilities(id),                          -- physical deployment site
  installed_at             TIMESTAMPTZ,
  installed_by_user_id     UUID REFERENCES users(id),
  -- Connectivity
  connectivity             connectivity_protocol,
  mqtt_topic_prefix        TEXT,                                 -- e.g. 'relowa/dev123/'
  aws_iot_thing_name       TEXT UNIQUE,                          -- AWS IoT Core thing
  -- State
  status                   device_status NOT NULL DEFAULT 'provisioned',
  last_heartbeat_at        TIMESTAMPTZ,
  battery_pct              numeric(5,2),
  signal_strength_dbm      INTEGER,
  -- Subscription tier billing context
  haas_subscription_id     UUID REFERENCES org_subscriptions(id), -- if HaaS-billed
  monthly_lease_amount     numeric(10,2),                         -- per-device HaaS fee
  -- Metadata
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  decommissioned_at        TIMESTAMPTZ
);

CREATE INDEX devices_org_idx           ON devices(org_id);
CREATE INDEX devices_facility_idx      ON devices(facility_id);
CREATE INDEX devices_status_idx        ON devices(status);
CREATE INDEX devices_type_idx          ON devices(device_type);
CREATE INDEX devices_thing_name_idx    ON devices(aws_iot_thing_name);

-- Raw telemetry from devices. Append-only.
-- This is partitioned by month for retention + query performance.
CREATE TABLE device_telemetry (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id                UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  measured_at              TIMESTAMPTZ NOT NULL,                  -- device clock
  received_at              TIMESTAMPTZ NOT NULL DEFAULT now(),    -- server clock
  metric_key               TEXT NOT NULL,                          -- 'fill_pct' | 'co2_ppm' | 'temp_c' | etc.
  metric_value             numeric(14,4),
  metric_unit              TEXT,                                   -- 'percent' | 'ppm' | 'celsius'
  payload                  jsonb NOT NULL DEFAULT '{}'::jsonb,    -- full raw telemetry
  topic                    TEXT,                                   -- MQTT topic
  -- Anomaly flags (computed by ingestion Lambda)
  is_anomaly               BOOLEAN NOT NULL DEFAULT false,
  anomaly_reason           TEXT
)
PARTITION BY RANGE (received_at);

-- Auto-create monthly partitions
CREATE TABLE device_telemetry_2026_01 PARTITION OF device_telemetry
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
-- ... and so on; or use pg_partman extension

CREATE INDEX device_telemetry_device_idx   ON device_telemetry(device_id, received_at DESC);
CREATE INDEX device_telemetry_metric_idx   ON device_telemetry(metric_key, received_at DESC);
CREATE INDEX device_telemetry_anomaly_idx  ON device_telemetry(received_at DESC) WHERE is_anomaly = true;

-- Aggregated telemetry: hourly, daily, monthly rollups for dashboards + VRP input.
-- This is the queryable surface — raw telemetry is for forensics + ML training.
CREATE TABLE telemetry_aggregations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id                UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  metric_key               TEXT NOT NULL,
  bucket_size              TEXT NOT NULL,                          -- 'hourly' | 'daily' | 'weekly' | 'monthly'
  bucket_start             TIMESTAMPTZ NOT NULL,
  bucket_end               TIMESTAMPTZ NOT NULL,
  count                    INTEGER NOT NULL,
  avg_value                numeric(14,4),
  min_value                numeric(14,4),
  max_value                numeric(14,4),
  last_value               numeric(14,4),
  anomaly_count            INTEGER NOT NULL DEFAULT 0,
  computed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, metric_key, bucket_size, bucket_start)
);

CREATE INDEX telemetry_agg_device_idx     ON telemetry_aggregations(device_id, bucket_start DESC);
CREATE INDEX telemetry_agg_metric_idx     ON telemetry_aggregations(metric_key, bucket_size, bucket_start DESC);

-- Alarms triggered by telemetry conditions (e.g. fill > 90%, CO2 > 5000 ppm)
CREATE TABLE device_alerts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id                UUID NOT NULL REFERENCES devices(id),
  org_id                   UUID NOT NULL REFERENCES organizations(id),
  facility_id              UUID REFERENCES facilities(id),
  alert_type               TEXT NOT NULL,                          -- 'fill_threshold' | 'gas_anomaly' | 'offline' | etc.
  severity                 TEXT NOT NULL,                          -- 'info' | 'warning' | 'critical'
  triggered_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at          TIMESTAMPTZ,
  acknowledged_by_user_id  UUID REFERENCES users(id),
  resolved_at              TIMESTAMPTZ,
  payload                  jsonb NOT NULL,                          -- alert details (the measured value, threshold, etc.)
  notification_sent        BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX device_alerts_org_idx     ON device_alerts(org_id, triggered_at DESC);
CREATE INDEX device_alerts_unresolved  ON device_alerts(severity, triggered_at DESC) WHERE resolved_at IS NULL;
```

### 2. RLS

```sql
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY devices_select_own_org ON devices
  FOR SELECT USING (org_id = auth.org_id());

ALTER TABLE device_telemetry ENABLE ROW LEVEL SECURITY;
CREATE POLICY device_telemetry_select_own_org ON device_telemetry
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM devices d
      WHERE d.id = device_telemetry.device_id
        AND d.org_id = auth.org_id()
    )
  );

-- Same pattern for telemetry_aggregations and device_alerts
```

### 3. AWS IoT Core integration

The broker setup:

```
Devices (physical) connect via MQTT over LPWAN
   ↓ (with mutual TLS authentication)
AWS IoT Core (eu-central-1)
   ├── MQTT broker (managed)
   ├── Device registry (mirrored to our devices table)
   ├── Shadow service (for last-known state per device)
   └── Rules engine (filters + routes messages)
                     ↓
        ┌────────────┴────────────┐
        ↓                          ↓
   Kinesis Data Stream      DynamoDB (hot state cache)
        ↓
   Lambda (telemetry processor)
        ├── Insert into device_telemetry (raw)
        ├── Compute aggregations (rolled into telemetry_aggregations)
        ├── Evaluate alert thresholds → device_alerts
        └── Outbox event: device.telemetry.received
                          device.alert.triggered
```

### 4. Device provisioning flow

```
1. Sales registers customer for HaaS subscription (ADR-0024)
   → Phase 2 admin tool, but schema supports today

2. Provisioning agent (Relowa staff via /admin/devices/provision):
   a. Generate AWS IoT Thing (per-device cert + key)
   b. Insert devices row: status = 'provisioned'
   c. Print labels with QR codes (containing device_serial + activation token)

3. Field technician installs at customer site:
   a. Scans QR with field-tech mobile app
   b. App POST /admin/devices/:id/install { facility_id, location_notes }
   c. Server updates: status = 'deployed', installed_at = now()

4. Device boots, attempts MQTT connection:
   a. Initial connect → registered as 'online'
   b. Telemetry begins flowing

5. Customer dashboard immediately shows device + live data
```

### 5. The IoT message contract (canonical)

All telemetry, regardless of source provider, normalizes to this shape:

```json
{
  "device_id": "RLW-FILL-0042",
  "measured_at": "2026-09-15T14:23:11Z",
  "metrics": [
    {"key": "fill_pct",         "value": 67.4, "unit": "percent"},
    {"key": "battery_pct",      "value": 92.0, "unit": "percent"},
    {"key": "signal_strength",  "value": -78,  "unit": "dbm"},
    {"key": "temp_c",           "value": 18.5, "unit": "celsius"}
  ],
  "topic": "relowa/devices/RLW-FILL-0042/data"
}
```

Each provider adapter (`SensoneoAdapter`, `CustomAdapter`, `MockDeviceProvider`) maps provider-native MQTT topics + payloads into this format.

### 6. DeviceProvider adapter interface

```ts
// packages/iot/provider.interface.ts
export interface DeviceProvider {
  readonly name: 'mock' | 'sensoneo' | 'custom';

  /**
   * Register a new device with the provider's cloud platform (if any).
   * Returns provider-side metadata to store in devices.payload.
   */
  registerDevice(req: {
    ourDeviceId: string;
    deviceType: DeviceType;
    serial: string;
    facilityId: string;
  }): Promise<{
    providerDeviceId: string;
    mqttTopicPrefix: string;
    awsIotThingName: string;
  }>;

  /**
   * Parse incoming MQTT message into canonical format.
   */
  parseTelemetry(req: {
    topic: string;
    rawPayload: Buffer;
  }): Promise<{
    deviceId: string;
    measuredAt: Date;
    metrics: Array<{ key: string; value: number; unit: string }>;
  }>;

  /**
   * Send command to device (where supported).
   * e.g. trigger immediate reading, reboot, update firmware.
   */
  sendCommand?(req: {
    providerDeviceId: string;
    command: string;
    params: Record<string, any>;
  }): Promise<{ acceptedAt: Date }>;
}
```

### 7. MockDeviceProvider — P1 implementation

For development + demo, `MockDeviceProvider`:

- Spawns synthetic devices via `POST /dev/mock-devices/provision { count, type, facility_id }`.
- Generates plausible time-series telemetry (sine waves with noise; fill rises slowly until "empty" event, then resets).
- Emits alerts on configured thresholds.
- Supports configurable failure modes (offline simulation, low battery simulation).

This is **complete** in the sense that the entire ingestion pipeline (parse → aggregate → alert → outbox) works against mocked data. UI dashboards render real-looking telemetry charts. VRP engine can consume fill-level inputs for routing-optimization simulations.

### 8. Sensoneo adapter — Phase 2 (deferred per Q4 substrate-only rule)

When the first Sensoneo deployment lands:

- Sensoneo cloud API delivers data via webhook or direct AWS IoT Core integration.
- `SensoneoAdapter.parseTelemetry` maps their JSON schema to ours.
- Migration path: existing customers with non-Sensoneo devices keep their adapter.

Per ADR-0027 same pattern — interface today, provider implementation when hardware ships.

### 9. Anomaly detection (substrate-ready)

The ingestion Lambda computes anomalies inline:

- **Fill spike** — fill_pct jumped from 20% to 80% in <5 min → likely tampering or sensor fault.
- **Gas threshold** — CO2 > 5000 ppm → critical alert at warehouse.
- **Offline** — device hasn't heartbeated in 24h.
- **Battery low** — < 10% → maintenance alert.
- **Temperature out of range** — for hazmat storage.

Each anomaly inserts into `device_alerts` and fires outbox event.

ML-based anomaly detection (LSTM forecasting, prediction-vs-actual deviation) is a Phase 3 enhancement — the substrate persists raw data for training.

### 10. Time-series considerations

PostgreSQL is not ideal for high-cardinality time-series at scale. P1 substrate ships with:

- **Monthly partitioning** on `device_telemetry`.
- **Aggregation tables** for query workloads (`telemetry_aggregations`).
- **Compression-friendly column types** (numeric instead of text).

If the system grows past ~100k devices, migrating to **TimescaleDB extension** is a low-friction upgrade — same Postgres, just enables compression and continuous aggregates. Documented in PRD-0001 as a future plan.

### 11. KVKK considerations

- Device data per se is NOT PII (it's about containers, not people).
- BUT — installed_by_user_id + facility location + customer activity patterns could be PII-adjacent.
- Anonymization at extraction: when exporting telemetry for ML training, strip device_id correlation to specific orgs/facilities.
- Retention: 24 months of raw telemetry, indefinite aggregations.
- Customer right to delete: removing org deletes their devices' telemetry; aggregations roll up to anonymous.

### 12. HaaS billing integration (ADR-0024)

- Each `device` references the `org_subscriptions` row authorizing it.
- HaaS is a tier feature: `tier.features.haas_devices_included = N`.
- Devices beyond N are billed extra (per-device monthly).
- A monthly Lambda generates HaaS line items into `subscription_invoices`.

### 13. Substrate-vs-implementation table

| Element | P1 ships | P2 ships |
|---|---|---|
| Schema (devices, telemetry, aggregations, alerts) | ✅ Full | (no change) |
| DeviceProvider interface | ✅ Defined | (no change) |
| MockDeviceProvider | ✅ Operational | Kept for testing + demo |
| AWS IoT Core provisioning | ⏳ Terraform-described, not deployed | ✅ Live |
| Ingestion Lambda | ✅ Coded against Mock | ✅ Live against real broker |
| SensoneoAdapter | — | ✅ Real hardware |
| Custom (Relowa-branded) hardware adapter | — | ✅ |
| HaaS billing | ⏳ Subscription tier exists; line-item billing P2 | ✅ Live |
| Dashboard widgets | ⏳ UI consumes mock data | ✅ UI consumes live data |
| ML anomaly models | — | ✅ Phase 3 |

## Consequences

### Positive

- **HaaS subscription is sellable today** (ADR-0024 ships in P1; this ADR's schema makes the line items meaningful).
- **Future hardware ships into production pipeline**, not green-field.
- **VRP engine can consume mock telemetry** for routing simulations.
- **AWS IoT Core is managed, EU-resident, scales**.
- **Adapter pattern keeps provider lock-in low** — Sensoneo, custom, future others all work.
- **Anomaly detection is structural** — alerts are first-class, not bolted on.

### Negative

- **5 new tables + telemetry partitioning in M3** — substrate cost is real.
- **AWS IoT Core has per-message cost** (~$5/million messages) — small at any rational scale.
- **Time-series in Postgres is suboptimal** at scale — migration path documented.
- **No live data in P1** — dashboards show mock data which can confuse stakeholders unless clearly labeled.

## Future plans

- **SensoneoAdapter (P2)** — when first hardware customer signs.
- **Relowa-branded hardware** — co-developed with a contract manufacturer (P3).
- **TimescaleDB migration** — when device count > 50k or telemetry > 100M rows/month.
- **ML anomaly detection** (P3) — LSTM forecasting, prediction-vs-actual.
- **Edge processing on gateways** (P3) — aggregate before sending, reduce bandwidth cost.
- **Multi-region IoT Core** — if expansion outside Turkey requires latency reduction.
- **Device firmware OTA updates** — via AWS IoT Jobs (P2).
- **Device twin / shadow synchronization** — for command-and-control beyond telemetry (P2).
- **Predictive maintenance** — battery + signal degradation models (P3).
- **Open device API** — third-party hardware integrates via webhook (P3).

## Alternatives considered

| Option | Rejected because |
|---|---|
| No substrate; defer entirely | HaaS subscription tier in ADR-0024 becomes vapor. Phase 2 schema work doubles. |
| Self-hosted MQTT broker (HiveMQ, EMQ X) | Operational burden; AWS IoT Core is managed and EU-resident. |
| Custom protocol (REST polling) | Doesn't match LPWAN reality; sensors with 10-year battery need MQTT/CoAP. |
| Store telemetry in S3 / Athena | Loses query-ability for dashboards; aggregations would be batch jobs. |
| Skip aggregation tables (compute on demand from raw) | At 100M+ rows, performance degrades; users wait for dashboards. |
| Use InfluxDB / TimescaleDB from day one | Adds operational dependency; Postgres-only is simpler in P1. |
| Direct device → API endpoint (no broker) | LPWAN devices don't speak HTTP; broker is required. |

## Reference

- ADR-0014 — Internal staff RBAC (`device:provision`, `device:read_telemetry` permissions)
- ADR-0018 — Notifications (device_alerts trigger notifications)
- ADR-0020 — Observability (IoT-related metrics in CloudWatch)
- ADR-0024 — Subscription tiers (HaaS revenue line)
- ADR-0025 — Facilities (devices bind to facility)
- ADR-0027 — Route engine (consumes telemetry for routing inputs)
- ADR-0029 — Edge AI (sibling pattern, similar adapter approach)
- PRD-0004 — Module map (IoT layer)
- PRD-0010 — Phase 2/3/4 vision (HaaS, smart-city expansion)
- AWS IoT Core: https://docs.aws.amazon.com/iot/
- TimescaleDB: https://www.timescale.com
- Sensoneo: https://sensoneo.com
