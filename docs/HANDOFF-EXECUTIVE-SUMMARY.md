# Relowa — Executive Summary & Architecture

> **Handoff document** — CTO-level overview of the Phase 1 backend + strategic vision.
> Last updated: 2026-05-16. All code lives at `github.com/ozandalgali/relowa-poc`.

---

## 1. What Relowa Is

A **B2B Waste Operating System (WOS)** for Turkey. Three actor types transact through the platform:

```
Producer (seller)         Recycler (buyer)         Carrier (transporter)
    │                          │                          │
    │  creates waste tenders   │  bids on tenders         │  bids on transport jobs
    │  receives payment        │  pays into escrow        │  receives transport payment
    │  confirms delivery       │  publishes carrier ads   │  reports shipment events
    │                          │                          │
    └──────────────────────────┴──────────────────────────┘
                               │
                          Relowa Platform
                               │
                    Postgres (SoR) + Hono API
                    EventBridge + Step Functions
                    S3 (documents, audit WORM)
                    Arbitrum One (Merkle root anchoring)
```

**Phase 1 target:** 50-100 producers, 10-20 recyclers, solo lead + AI agents, AWS eu-central-1.

---

## 1a. Strategic Vision — The Three-Pillar Fusion

Relowa is the **only platform unifying three vertical pillars** that today exist as separate $100M+ companies. The CEO's competitive matrix:

| Capability | Evreka | Rubicon | Greyparrot | Sensoneo | **Relowa** |
|---|---|---|---|---|---|
| Business model | B2B SaaS | Marketplace + SaaS | Deep-Tech | IoT + SaaS | **Hybrid WOS** |
| Operations & Logistics (SaaS) | ✓ | ✓ | × | ✓ | **✓** |
| Smart Container & IoT Tracking | ✓ | ✓ | × | ✓ | **✓** |
| B2B Waste Marketplace | × | ✓ | × | × | **✓** |
| In-Facility AI (Computer Vision) | × | × | ✓ | × | **✓** |
| Certified ESG & Blockchain | — | ✓ | × | — | **✓** |

**The three pillars Relowa fuses:**

```
PILLAR 1 — Rubicon-style          PILLAR 2 — Sensoneo-style       PILLAR 3 — Greyparrot-style
Operations & Marketplace           IoT / Field Data                 Edge AI / Recognition
"When/where/how to collect"        "What's on the ground"           "What's being recycled"

Manages operations                 Generates data                   Interprets data

Rubicon ($1.7B EV peak)            Sensoneo (~€15-50M)              Greyparrot (~$50-150M)
SPAC, profitable pressure          80+ countries IoT installs       MRFs across Europe
Network effect, high cost          Hardware margin pressure         Hardware deployment scale
```

**Relowa's thesis:** integrate all three under one platform. Phase 1 ships Pillar 1 (Marketplace) at production quality with substrate seats for Pillars 2 and 3. Phases 2-4 deliver the fusion.

This is captured in the **5-layer architecture** that PRD-0004 organizes the 9 module buckets into:

```
LAYER 5 — Compliance & Certification    (Arbitrum anchoring, ESG, carbon credits)
LAYER 4 — Marketplace & Finance         (Tenders, orders, escrow, pricing)
LAYER 3 — Operations & Logistics        (Rubicon-style: VRP, fleet, shipments)
LAYER 2 — Analytics & Intelligence      (Greyparrot-style: edge AI, purity scoring)
LAYER 1 — Field & Data                  (Sensoneo-style: IoT, MQTT, telemetry)
```

**Phase 1 ships Layers 3-5 fully + substrate seats reserved for Layers 1-2.**
Phase 2 lights up Layer 1 (IoT live).
Phase 3 lights up Layer 2 (edge AI live).
Phase 4 makes Layer 5 tradeable (carbon credit marketplace).

See PRD-0010 for the full 4-phase roadmap.

---

## 2. Tech Stack

| Layer | Choice | Purpose |
|-------|--------|---------|
| **System of Record** | PostgreSQL 18.4 (RDS, private subnet) | All authoritative state. Multi-tenant via RLS. |
| **API** | Hono 4 (Node.js, `apps/api/`) | REST endpoints with JWT-via-GUC + idempotency |
| **ORM** | Drizzle ORM + Drizzle Kit | Type-safe Postgres queries, auto-migrations |
| **Auth** | JWT HMAC (dev) → Cognito (prod) | Claims set via `request.jwt.claims` GUC per transaction |
| **Security boundary** | Postgres Row-Level Security (RLS) | 37 policies across 21 tables (growing as substrate seats land). Zero auth code in app layer. |
| **Workflows** | AWS Step Functions | Multi-day escrow state machine (15 states); fee engine fan-out per PRD-0008 |
| **Scheduling** | AWS EventBridge Scheduler | Auction close every 30s, daily audit export |
| **Realtime** | Supabase Realtime (dev) → AWS AppSync (prod) | Outbox pattern → relay → subscriptions |
| **Events** | AWS EventBridge | Domain events from mutations, fire-and-forget |
| **Queues** | AWS SQS | Webhook processing with dead-letter queue |
| **Storage** | AWS S3 (5 buckets) | Tender photos, org docs, e-fatura, audit archive (WORM), public assets |
| **IaC** | Terraform | 60+ AWS resources, OIDC trust for CI deploys |
| **CI/CD** | GitHub Actions + OIDC | Lint, test (46 API tests + growing), deploy-dev |
| **Local dev** | Docker Compose | Postgres, Realtime, LocalStack, Adminer, pgAdmin |
| **Compliance** | Arbitrum One (EVM L2) | Daily Merkle root → smart contract ($0.01/day) |
| **Frontend (planned)** | Next.js + shadcn + packages/ui | M5 (next sprint) |
| **IoT (substrate-only P1)** | AWS IoT Core + MQTT + LPWAN adapters | ADR-0028; live in Phase 2 |
| **Edge AI (substrate-only P1)** | EdgeAIProvider adapter (Mock in P1, Greyparrot P2-P3) | ADR-0029; live in Phase 2-3 |
| **VRP (substrate-only P1)** | RouteEngine adapter (Manual in P1, Google OR-Tools P2) | ADR-0027; live in Phase 2 |
| **Mapping** | MapLibre + OSRM (POC) → AWS Location (prod) | ADR-0013, pluggable per env var |
| **Subscription billing** | Iyzico recurring (prod), Manual (dev) | ADR-0024 |

---

## 2a. Hybrid Revenue Model — SaaS + Marketplace Commission

Per the CEO's pricing matrix and ADR-0024, Relowa's revenue is **two-layered**:

**SaaS subscriptions** (monthly recurring, per segment per tier):

| Segment | Free | Pro | Enterprise |
|---|---|---|---|
| Waste Producers | Free | ₺2 499/mo | Custom |
| Recycling Facilities | Free | ₺3 499/mo | Custom |
| Logistics & Carriers | Free | ₺1 999/mo | Custom |

**Marketplace commission** (per transaction, scaled by subscription tier):

| Segment | Free | Pro | Enterprise |
|---|---|---|---|
| Waste Producers | 7% | 5% | 3% |
| Recycling Facilities | 3% | 2% | 2% |
| Logistics & Carriers | 10% | 7% | 5% |

**The pricing engine (PRD-0008) handles all of this.** Schedule resolution: org subscription tier → segment-specific fee schedule. Per-tenant overrides via super_admin for enterprise bespoke contracts. Fully customizable; CEO matrix is the seeded default.

**Phase 2+ revenue lines** (substrate-ready in Phase 1):
- **HaaS** (Hardware-as-a-Service): ₺1 500/mo per IoT sensor (Sensoneo-style).
- **Edge AI HaaS**: ₺25 000/mo per Greyparrot-style conveyor unit at recyclers.
- **Smart Inventory RFID**: ₺500/mo per tag.
- **Phase 4** — carbon credit transaction fees, ERP API contracts, data licensing.

---

## 3. Database — 25 Tables, 50+ RLS Policies (with substrate seats)

### Identity & Tenancy (core multi-tenant model)
| Table | Purpose | RLS |
|-------|---------|-----|
| `users` | Operator identity (email, password hash) | Own record only |
| `organizations` | Tenants (Producer/Recycler/Carrier) | Own org |
| `facilities` | Physical sites per org (multi-site enabled, ADR-0025) | Own org + marketplace |
| `org_members` | User ↔ Org with role (admin/operations/accounting) | Membership-based |

### Business — Tenders, Bids, Orders
| Table | Purpose | RLS |
|-------|---------|-----|
| `tenders` | Waste tender lifecycle: DRAFT→PUBLISHED→CLOSING→WON | Producer: own. Recycler: published. Carrier: none. |
| `bids` | Recycler bids on tenders (price_per_ton) | Bidder: own. Tender owner: can't see (sealed-bid). |
| `orders` | Persistent fulfillment record (one per winning bid; ADR-0026) | Producer + recycler + carrier of order |
| `order_parties` | Multi-party order participants | Via order |
| `order_status_transitions` | Lifecycle audit | Via order |

### Business — Carrier Sub-Auction
| Table | Purpose | RLS |
|-------|---------|-----|
| `carrier_ads` | Recycler posts transport job (bound to order, not tender) | Recycler: own. Carrier: open ads. |
| `carrier_bids` | Carrier bids on transport jobs | Carrier: own. Recycler: bids on own ads. |
| `shipments` | Physical transport order | Involved parties |
| `shipment_stops` | Multi-stop / multi-leg shipments (ADR-0027) | Via shipment |
| `shipment_events` | Pickup/in-transit/delivered events | Carrier: write. All involved: read. |
| `quality_inspections` | Discrete quality check at delivery (ADR-0026) | Via order |
| `quality_inspection_items` | Per-material inspection rows | Via inspection |
| `delivery_proofs` | Signed receipt + photos + GPS at delivery | Via order |

### Logistics Substrate (ADR-0027 — P1 schema, P2 implementation)
| Table | Purpose | RLS |
|-------|---------|-----|
| `vehicles` | Per-carrier fleet inventory | Own org |
| `driver_profiles` | Per-carrier drivers | Own org |
| `route_optimizations` | VRP run output (audit + history) | Own org |
| `route_legs` | Per-vehicle route within an optimization | Via optimization |

### Field & IoT Substrate (ADR-0028 — P1 schema, P2 implementation)
| Table | Purpose | RLS |
|-------|---------|-----|
| `devices` | IoT sensor inventory (fill, gas, temperature, etc.) | Own org |
| `device_telemetry` | Raw measurements (partitioned monthly) | Via device |
| `telemetry_aggregations` | Hourly/daily rollups | Via device |
| `device_alerts` | Anomaly alarms | Own org |

### Analytics & Edge AI Substrate (ADR-0029 — P1 schema, P2-P3 implementation)
| Table | Purpose | RLS |
|-------|---------|-----|
| `ai_inference_units` | Edge AI hardware inventory (Greyparrot-style) | Own org |
| `ml_models` | Catalog of deployable ML models | Reference only |
| `inference_jobs` | Per-run AI scan session | Via org or order |
| `inference_results` | Per-frame model output (partitioned) | Via job |
| `ai_unit_commands` | Bi-directional control plane | Via unit |
| `ai_analyses` | Cloud Greyparrot API photo scans (PRD-0006) | Via tender |

### Finance — Escrow + Pricing
| Table | Purpose | RLS |
|-------|---------|-----|
| `escrow_orders` | Escrow lifecycle: PENDING→FUNDS_LOCKED→IN_TRANSIT→DELIVERED→RELEASED/REFUNDED/DISPUTED | Involved parties |
| `escrow_transactions` | Each money movement (fund, release, refund, platform_fee) | Via escrow_order |
| `provider_webhooks` | Idempotent webhook storage (unique on provider+eventId) | System-only |
| `fee_schedules` | Per-segment-per-tier commission schedules (PRD-0008) | Admin-only |
| `fee_schedule_tiers` | Tier breakpoints (1.5%, caps, floors) | Admin-only |
| `fee_schedule_overrides` | Per-tenant negotiated rates | Admin-only |
| `fee_applications` | Per-transaction fee audit | Via escrow |

### Subscription Billing (ADR-0024 — P1 schema, P1-P2 implementation)
| Table | Purpose | RLS |
|-------|---------|-----|
| `subscription_tiers` | 9 tiers from CEO matrix (3 segments × Free/Pro/Enterprise) | Public-read |
| `org_subscriptions` | Per-org tier with effective dates | Own org |
| `subscription_invoices` | Monthly subscription billing | Own org |
| `org_usage_counters` | Per-feature usage caps (listings/mo etc.) | Own org |

### Staff RBAC (internal platform team)
| Table | Purpose | Access |
|-------|---------|--------|
| `internal_staff` | Staff identity (super_admin/account_manager/support_agent/compliance_officer/financial_analyst) | `relowa_admin` role only (BYPASSRLS) |
| `staff_org_assignments` | Staff ↔ Org assignment (now ↔ facility too) | `relowa_admin` only |
| `staff_permissions` | 21+ permission codes with risk levels | `relowa_admin` only |
| `staff_role_permissions` | Role → Permission mapping | `relowa_admin` only |
| `admin_audit_log` | Every staff action, mandatory reason, hash-chained | `relowa_admin` only |

### Onboarding & Compliance
| Table | Purpose | Access |
|-------|---------|--------|
| `org_documents` | Çevre Lisansı, K1, vergi levhası uploads (now facility-aware) | Own org + reviewer staff |
| `kvkk_requests` | KVKK m.13 data subject requests | Own org + compliance staff |

### Cross-cutting
| Table | Purpose | Access |
|-------|---------|--------|
| `audit_events` | SHA-256 hash-chained audit trail (append-only) | Org-scoped SELECT |
| `idempotency_keys` | Mutation replay cache (24h TTL, org-scoped) | Own org |
| `outbox` | Transactional event log → relay → realtime | System INSERT |
| `anchor_log` | Daily Merkle root records (Arbitrum anchoring) | System-only |
| `notifications` | In-app + email + SMS + push notifications | Own user |
| `notification_channels` | Per-channel delivery state | Via notification |
| `notification_preferences` | User opt-in/opt-out per template | Own user |
| `uploads` | Presigned S3 uploads + virus-scan status | Own org |

---

## 4. API — 7 Route Groups, 3 Middleware

### Middleware stack (applied per-request)
1. **JWT-via-GUC** — verifies HMAC JWT, sets `request.jwt.claims` + `SET LOCAL ROLE app_user` per transaction
2. **Idempotency** — checks `Idempotency-Key` header, returns cached response on replay
3. **EventBridge** — fire-and-forget PutEvents after transaction commit

### Endpoints
| Group | Method | Path | Auth | Description |
|-------|--------|------|------|-------------|
| Health | GET | `/health` | None | Health check |
| Tenders | POST | `/tenders` | JWT+Idempotency | Create draft tender |
| | GET | `/tenders` | JWT | List tenders (RLS-scoped) |
| | GET | `/tenders/:id` | JWT | Tender detail |
| | PATCH | `/tenders/:id/publish` | JWT+Idempotency | Publish with closesAt |
| Bids | POST | `/tenders/:id/bids` | JWT+Idempotency | Place bid |
| | GET | `/tenders/:id/bids` | JWT | List bids |
| Orders (M2+) | GET | `/orders` | JWT | List orders (RLS-scoped) |
| | GET | `/orders/:id` | JWT | Order detail |
| Escrow | POST | `/escrow` | JWT+Idempotency | Create escrow from won tender |
| | GET | `/escrow/:id` | JWT | Escrow status + transactions |
| | POST | `/escrow/:id/simulate-payment` | JWT | Dev-only: fund escrow |
| Subscriptions (M5+) | GET | `/subscriptions` | JWT | Current org's tier |
| | POST | `/subscriptions/upgrade` | JWT+Idempotency | Upgrade tier |
| | POST | `/subscriptions/cancel` | JWT+Idempotency | Cancel (effective end of period) |
| Webhooks | POST | `/api/webhooks/:provider` | None (signature) | Provider callback (idempotent) |
| Files | GET | `/upload-url` | JWT | S3 presigned upload URL |
| | GET | `/download-url` | JWT | S3 presigned download URL |
| Facilities (M2+) | GET | `/facilities` | JWT | List org's facilities |
| | POST | `/facilities` | JWT+Idempotency | Create facility (Enterprise tier) |

---

## 5. Architecture — Request Flow

```
HTTP Request
    │
    ▼
[JWT Middleware]
    │  Verify HMAC → extract sub, active_org_id, email
    │
    ▼
[Idempotency Middleware]
    │  Check idempotency_keys → replay if seen
    │
    ▼
[Feature Gate Middleware (M5+)]
    │  Check tier feature flag (e.g. max_listings_per_month)
    │
    ▼
[Transaction: Postgres]
    │  SET LOCAL request.jwt.claims = <claims>
    │  SET LOCAL ROLE app_user
    │
    ├── Business INSERT/UPDATE (RLS applies transparently)
    ├── audit_events INSERT (hash-chained)
    └── outbox INSERT (event_type, aggregate_id, payload)
    │
    ▼
[Transaction commit]
    │
    ▼
[EventBridge PutEvents] (fire-and-forget, non-blocking)
    │
    ▼
[HTTP Response]
```

### Event flow (after commit)
```
outbox table → relay worker (polls every 1s)
                    │
                    ├── REALTIME_BACKEND=supabase → Supabase Realtime reads WAL directly
                    └── REALTIME_BACKEND=appsync → SQS → Lambda → AppSync mutation → WebSocket clients
```

### IoT ingestion flow (Phase 2+; substrate exists P1)
```
Edge devices (LPWAN/MQTT)
    ↓ (TLS, AWS IoT Core)
AWS IoT Core
    ↓ (Rules engine)
Kinesis Data Stream
    ↓
Lambda (telemetry processor)
    ├── device_telemetry INSERT (raw)
    ├── telemetry_aggregations rollup
    ├── device_alerts evaluation
    └── outbox: device.telemetry.received, device.alert.triggered
```

### Edge AI flow (Phase 2-3; substrate exists P1)
```
Conveyor camera (60 fps)
    ↓
Edge GPU unit (Jetson) runs inference
    ↓ (MQTT to AWS IoT Core)
inference_results INSERT (sampled frames)
    ↓
Aggregation Lambda
    ├── inference_jobs summary update (purity_score, composition)
    ├── quality_inspections row update (linked via order)
    └── outbox: inference.completed
```

---

## 6. Key Flows

### 6.1 Tender → Order Lifecycle
```
DRAFT (tender)
  │  Producer creates: POST /tenders
  ▼
DRAFT (tender)
  │  Producer publishes: PATCH /tenders/:id/publish (sets closesAt)
  ▼
PUBLISHED (tender)
  │  Recyclers place bids: POST /tenders/:id/bids
  │  outbox: tender.published → bid.placed events
  │  EventBridge Scheduler → auction-close Lambda every 30s
  ▼
CLOSING (tender, soft-close)
  │  If bid placed in last 60s → extend closesAt by 60s
  │  If no late bid → determine winner (highest pricePerTon)
  ▼
WON (tender)
  │  outbox: tender.won event
  │  orders INSERT (one per winning bid; supports multi-winner in P2)
  │  Order PENDING → AWAITING_CARRIER → ESCROW_FUNDED → IN_TRANSIT → DELIVERED → INSPECTED → SETTLED
```

### 6.2 Escrow Lifecycle (orchestrated by Step Functions)
```
PENDING
  │  Recycler creates: POST /escrow (calls ManualProvider.createEscrow)
  │  Step Functions creates execution
  ▼
WAIT_FOR_FUNDING (up to 24h)
  │  Webhook: payment.completed → SendTaskSuccess
  ▼
FUNDS_LOCKED
  ▼
WAIT_FOR_SHIPMENT (up to 7 days)
  │  Carrier confirms delivery → SendTaskSuccess
  ▼
DISPUTE_WINDOW (72h)
  │  No dispute → ReleaseFunds (PARALLEL — 3 branches per PRD-0008)
  │    ├── ReleaseToProducer (net of producer fee)
  │    ├── ReleaseToCarrier (net of carrier fee)
  │    └── RetainToPlatform (commission per fee_applications)
  ▼
RELEASED (order SETTLED)
  │  ESG cert → anchor_log entry
  │  outbox: escrow.producer_paid, escrow.carrier_paid, escrow.platform_retained
  │  Daily Merkle root anchored to Arbitrum One
```

### 6.3 Subscription Tier Resolution (every transaction)
```
Transaction in flight (e.g. POST /tenders/:id/bids)
  │
  ▼
Pricing engine called: computeFees({ orgId, transactionType, grossAmount, at })
  │
  ▼
[1] Check fee_schedule_overrides for org+type → if found, use it
  │
  ▼
[2] Otherwise, look up org_subscriptions for org+type at time
  │  Returns subscription_tier_id
  │
  ▼
[3] Resolve fee_schedules WHERE name = '<segment>-<tier>' AND transaction_type = <type>
  │  e.g. 'recycler-pro' for waste_tender → 2% commission schedule
  │
  ▼
[4] Apply tier breakpoints + caps + floors
  │
  ▼
[5] Return per-target FeeBreakdowns (one per fee_target)
  │
  ▼
Escrow Step Function uses these to compute net disbursements
```

---

## 7. Infrastructure — 60+ AWS Resources (growing)

| Resource | Count | Purpose |
|----------|-------|---------|
| VPC + Subnets + NAT + IGW | 10 | Network isolation (10.0.0.0/16, 2 AZs) |
| VPC Endpoints | 5 | Secrets Manager, ECR API/DKR, CloudWatch Logs, S3 |
| RDS PostgreSQL 18.4 | 1 | Single-AZ (M0), Multi-AZ (M0+), db.t4g.micro, encrypted, backup 1 day |
| ECR Repositories | 4 | API, Web, Admin, Lambdas |
| S3 Buckets | 5 | Tender photos, Org docs, E-fatura, Audit archive (WORM), Public assets |
| Step Functions State Machine | 1 | Escrow (15 states; fee fan-out per PRD-0008) |
| SQS Queues | 1 + DLQ | Webhook processing |
| EventBridge Scheduler | 2 | Auction close (30s), Audit export (daily) |
| Secrets Manager | 4 | DB passwords, JWT key, Bastion SSH key |
| EC2 Bastion | 1 | t3.micro, SSH tunnel to RDS |
| IAM Roles | 6 | OIDC deploy, ECS task, Lambda exec, SFN exec, Scheduler |
| **Phase 2+ additions:** | | |
| AWS IoT Core endpoint | 1 | MQTT broker for IoT (ADR-0028) |
| Kinesis Data Stream | 1 | Telemetry ingestion buffer |
| AWS Client VPN | 1 | Admin panel access (ADR-0015) |
| Route53 Private Hosted Zone | 1 | admin.relowa.local (ADR-0015) |
| AWS Private CA | 1 | Internal certs (ADR-0015) |
| IAM Identity Center (SAML) | 1 | Staff SSO (ADR-0015) |
| AWS Location Service | 1 | Production routing/geocoding (ADR-0013) |
| AppSync | 1 | Realtime subscriptions (ADR-0006) |
| **Total Phase 1** | **~60** | All Terraform-managed, tagged `Project=relowa Env=dev` |

---

## 8. Lambdas (11 in Phase 1, growing)

| Lambda | Trigger | Purpose |
|--------|---------|---------|
| `auction-close` | EventBridge every 30s | Close tenders past closesAt, pick winner, soft-close, create orders |
| `createEscrow` | Step Functions | Initialize escrow, write audit, compute fee_applications |
| `releaseToProducer` | Step Functions (Parallel) | Release waste payment (net of producer fee), generate ESG cert |
| `releaseToCarrier` | Step Functions (Parallel) | Release transport payment (net of carrier fee) |
| `retainToPlatform` | Step Functions (Parallel, NEW) | Per PRD-0008 amendment to ADR-0007 |
| `refundBuyer` | Step Functions | Refund recycler on dispute |
| `updateStatus` | Step Functions | Generic status transition + audit |
| `openDispute` | Step Functions | Open dispute on shipment timeout |
| `waitForCallback` | Step Functions (task token passthrough) | Receives SendTaskSuccess from webhooks/admin |
| `audit-export` | EventBridge daily 03:00 UTC | Export audit_events → S3 WORM JSON-Lines |
| `outbox-relay` | Long-running ECS/Lambda | Poll outbox, ship to AppSync/Supabase |
| `clamav-scanner` | S3 PutObject events (M6) | Virus scan uploaded files |
| **Phase 2+:** | | |
| `iot-telemetry-processor` | Kinesis stream | Process device_telemetry, compute aggregations, evaluate alerts |
| `subscription-billing` | EventBridge daily | Generate monthly subscription_invoices |
| `route-optimizer` | Manual / scheduled | Run OR-Tools on order set |
| `anchor-publisher` | EventBridge daily | Compute Merkle root, publish to Arbitrum |

---

## 9. Test Coverage — 46 Tests, 9 Files (Phase 1 floor; growing per ADR-0017)

| File | Tests | Domain |
|------|-------|--------|
| `auth.test.ts` | 8 | JWT verification, expiry, RLS scoping across 3 org types |
| `tenders.test.ts` | 7 | CRUD, validation, idempotency, publish |
| `bids.test.ts` | 5 | Place bid, draft rejection, idempotent replay, list |
| `bidding-flow.test.ts` | 4 | End-to-end: create → publish → bid → verify |
| `escrow.test.ts` | 6 | Auth, 404, no-winner rejection, create on won, status |
| `escrow-flow.test.ts` | 4 | End-to-end: create → check → simulate-payment → funds_locked |
| `webhooks.test.ts` | 3 | Valid webhook, idempotent replay, different events |
| `files.test.ts` | 5 | Upload URL, auth, content-type validation, download |
| `iban.test.ts` | 5 | Deterministic hash, normalize, verify, reject, uniqueness |
| **Planned (M4-M5):** | | |
| `pricing-engine.test.ts` | TBD | PRD-0008: tier resolution, override priority, breakdown math |
| `subscription-flow.test.ts` | TBD | ADR-0024: free → pro → enterprise upgrade flows |
| `order-lifecycle.test.ts` | TBD | ADR-0026: tender → order conversion, status transitions |

Test strategy + category catalog: ADR-0017.

---

## 10. Substrate Seats Reserved (Phase 1 schema, Phase 2-3 implementation)

The discipline that prevents future architectural rewrites:

| Substrate seat | Schema in P1 | Implementation lands | ADR |
|---|---|---|---|
| **Subscription tiers** | ADR-0024 — `subscription_tiers`, `org_subscriptions`, `subscription_invoices`, `org_usage_counters` | Free auto-applied P1; paid flows M5 | ADR-0024 |
| **Multi-facility orgs** | ADR-0025 — `facilities` + FK columns on tenders/shipments/etc. | Multi-site UI M5; per-facility staff scoping P2 | ADR-0025 |
| **Orders separate from tenders** | ADR-0026 — `orders`, `order_parties`, `order_status_transitions`, `quality_inspections`, `delivery_proofs` | M2 single-winner; multi-winner P2 | ADR-0026 |
| **VRP / fleet management** | ADR-0027 — `vehicles`, `driver_profiles`, `route_optimizations`, `route_legs`, `shipment_stops` | ManualRouteEngine P1; OR-Tools P2 | ADR-0027 |
| **IoT / Sensoneo pillar** | ADR-0028 — `devices`, `device_telemetry`, `telemetry_aggregations`, `device_alerts` | MockDeviceProvider P1; Sensoneo P2 | ADR-0028 |
| **Edge AI / Greyparrot pillar** | ADR-0029 — `ai_inference_units`, `ml_models`, `inference_jobs`, `inference_results`, `ai_unit_commands` | MockEdgeAI P1; Greyparrot P2-P3 | ADR-0029 |
| **Pricing engine** | PRD-0008 — `fee_schedules`, `fee_schedule_tiers`, `fee_schedule_overrides`, `fee_applications` | Engine + default schedules M4 | PRD-0008 |

**The cost of substrate-now:** ~20 extra tables in Phase 1. Mitigated by clear pattern reuse (RLS + audit + provider adapter).
**The benefit:** zero migration cliffs when Phases 2-4 light up.

---

## 11. Deferred (blocked by external access)

| Item | Blocker | Pattern ready? |
|------|---------|---------------|
| IyzicoProvider (escrow + subscriptions) | Sandbox API keys | `EscrowProvider` + `SubscriptionProvider` interfaces written |
| PayTRProvider | Sandbox API keys | Same interfaces |
| Nilvera/Foriba e-fatura | Sandbox access | Adapter pattern, 1 file |
| Cognito User Pool | Not needed in dev | JWT HMAC works for POC, swap middleware for prod |
| Greyparrot cloud API | Pricing + KVKK terms | `AIScanProvider` interface in PRD-0006 |
| Sensoneo hardware | Vendor relationship | `DeviceProvider` interface in ADR-0028 |
| Edge AI hardware (Greyparrot units) | Vendor relationship + customer Enterprise sale | `EdgeAIProvider` interface in ADR-0029 |
| ClamAV scanner | Deferred to M6 | S3 event Lambda, ~100 lines |
| KVKK aydınlatma metni | Legal document | Not code |
| Carbon credit minting (Phase 4) | Regulatory standardization | Anchor pipeline ready |

---

## 12. What's Next

| # | Sprint | Type |
|---|--------|------|
| M5 | Frontend (`apps/web`) — Next.js App Router, shadcn, all operator pages | Frontend |
| M6 | Admin Panel (`apps/admin`) — VPN, SAML, staff tools | Frontend (post-launch) |
| Phase 2 | IoT live (Sensoneo hardware), VRP via OR-Tools, driver mobile app, Iyzico+Nilvera prod | Multi-quarter |
| Phase 3 | Edge AI live (Greyparrot or self-hosted), EU expansion, TimescaleDB if needed | Year 2-3 |
| Phase 4 | Carbon credits, ERP integrations, smart city, data licensing | Year 3-4+ |

### M5 scope (next sprint, planned)
- Next.js App Router with `packages/ui` design tokens
- Auth pages: login, register (Free tier auto-assigned), role select
- Operator dashboard: tender list, live bid feed (AppSync/outbox), audit log
- Tender wizard: create → publish flow
- Marketplace: recycler view with filters + facility-aware
- Order detail page (new in M5 per ADR-0026)
- Escrow status page with fee breakdown (per PRD-0008)
- Subscription management page (`/ayarlar/abonelik`)
- S3 file uploads with presigned URLs
- next-intl i18n (TR primary, EN secondary)

---

## 13. Appendix — Quick Diagnose

```bash
# Local dev
pnpm infra:up                     # Start all Docker services
pnpm api:dev                      # Start Hono API on :3000
pnpm test                         # Run all API tests
pnpm db:studio                    # Drizzle Studio on :4983

# AWS
terraform -chdir=infra plan       # Preview infra changes
aws rds describe-db-instances --db-instance-identifier relowa-dev --profile relowa

# RDS tunnel
ssh -i ~/.ssh/relowa-bastion.pem -f -N -L 5433:relowa-dev.c56syqia8638.eu-central-1.rds.amazonaws.com:5432 ec2-user@63.184.134.45
psql -h 127.0.0.1 -p 5433 -U relowa -d relowa

# CI
https://github.com/ozandalgali/relowa-poc/actions
```

---

## 14. Document Index (latest)

**Strategic / vision:**
- PRD-0001 — Vision
- PRD-0010 — Phase 2/3/4 roadmap (NEW)

**Phase 1 scope:**
- PRD-0002 — Phase 1 scope
- PRD-0003 — Phase 1 milestones (M0-M6)
- PRD-0004 — Module map (5-layer architecture, AMENDED)
- PRD-0007 — Operations & support
- PRD-0008 — Pricing engine (3×3 hybrid model, AMENDED)
- PRD-0009 — Onboarding & verification

**Architecture (ADRs):**
- ADR-0001/0003/0008 — Postgres SoR, RLS, anchoring
- ADR-0005/0014/0015 — Identity, staff RBAC, admin isolation
- ADR-0007/0009/0010 — Escrow, tender auction, carrier sub-auction
- ADR-0006 — Outbox/AppSync
- ADR-0011/0012/0013 — UI kit, frontend architecture, maps
- ADR-0016/0017 — Agent team, test strategy
- ADR-0018/0019/0020/0021/0022/0023 — Platform services (notifications, storage, observability, DR, rate limiting, secrets)
- ADR-0024 — Subscription tiers & SaaS billing (NEW)
- ADR-0025 — Facilities & multi-site (NEW)
- ADR-0026 — Orders separate from tenders (NEW)
- ADR-0027 — Route engine (VRP substrate, NEW)
- ADR-0028 — IoT ingestion (substrate, NEW)
- ADR-0029 — Edge AI (substrate, NEW)

**Provider integrations:**
- PRD-0006 — Provider integration specs (adapter + Manual; ADRs 0027-0030 reserved for real providers)

**Live master plan dashboard:** `docs/_site/index.html`
