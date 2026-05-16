# Relowa — Fresh Session Handoff

> For AI agents starting a new session. Concise facts, no code.
> GitHub: `github.com/ozandalgali/relowa-poc` | AWS: `258975980370`, `eu-central-1`

---

## What this is

B2B Waste Operating System for Turkey. Three actor types:

- **Producer** — creates waste tenders, receives payment
- **Recycler** — bids on tenders, pays into escrow, publishes carrier ads
- **Carrier** — bids on transport jobs, transports waste

Phase 1 backend is **complete**. 50 tables, 50 RLS policies, 10 API route groups, 11 Lambdas, 46 tests all green. Frontend (M5) is next.

---

## Tech stack

PostgreSQL 18.4 (RDS, private subnet) — System of Record. Hono 4 API (Node.js, port 3000). Drizzle ORM. JWT HMAC (dev) → Cognito (prod). RLS as security boundary (zero auth in app code — policies only). Terraform IaC (60+ AWS resources). GitHub Actions CI (lint, test, deploy-dev via OIDC). Docker Compose for local dev. Supabase Realtime for CDC (dev) → AppSync subscriptions (prod). AWS Step Functions for escrow state machine. AWS EventBridge for domain events. SQS for webhook processing. S3 for files (5 buckets, 1 Object Lock WORM). Arbitrum One for daily Merkle root anchoring ($0.01/day).

---

## Codebase map

```
apps/api/           — Hono API (10 route groups, 3 middleware)
apps/lambdas/       — 11 Lambda functions
  auction-close/    — Runs every 30s, closes tenders, soft-close anti-sniping
  escrow/           — 6 escrow handlers + state machine ASL
  audit-export/     — Daily audit → S3 WORM
  outbox-relay/     — Polls outbox, ships to real-time backend
infra/              — 12 Terraform files (60+ AWS resources)
packages/db/        — Drizzle schema (50 tables), migrations, seed
scripts/            — setup-events.sh, wait-for-pg.sh, sync-agents.ts
tests/              — rls-isolation.sh (bash), 46 Vitest tests
docs/               — 29 ADRs, 10 PRDs, 5 plan files, CHANGELOG
.site/              — Master plan dashboard HTML
```

---

## Database — 50 tables, 50 RLS policies

### Identity & Tenancy (3 tables)
- users, organizations, org_members — multi-tenant via RLS, JWT carries active_org_id

### Business — Tenders & Bids (2)
- tenders (DRAFT→PUBLISHED→CLOSING→WON lifecycle), bids (price_per_ton, sealed-bid RLS)

### Business — Carrier Sub-Auction (4)
- carrier_ads, carrier_bids, shipments, shipment_events

### Finance — Escrow (3)
- escrow_orders (PENDING→FUNDS_LOCKED→IN_TRANSIT→DELIVERED→RELEASED/REFUNDED/DISPUTED),
  escrow_transactions, provider_webhooks (idempotent on provider+eventId)

### Staff RBAC (5) — relowa_admin BYPASSRLS role only
- internal_staff (5 roles), staff_org_assignments, staff_permissions (17 codes),
  staff_role_permissions, admin_audit_log (hash-chained)

### Pricing — PRD-0008 (4)
- fee_schedules, fee_schedule_tiers, fee_schedule_overrides, fee_applications

### Subscriptions — ADR-0024 (4)
- subscription_tiers, org_subscriptions, subscription_invoices, org_usage_counters

### Facilities — ADR-0025 (1)
- facilities (factory/warehouse/recycling_plant...)

### Orders — ADR-0026 (5+2)
- orders, order_parties, order_status_transitions, quality_inspections, delivery_proofs

### VRP — ADR-0027 (5)
- vehicles, driver_profiles, route_optimizations, route_legs, shipment_stops

### IoT — ADR-0028 (4)
- devices, device_telemetry, telemetry_aggregations, device_alerts

### Edge AI — ADR-0029 (5)
- ai_inference_units, ml_models, inference_jobs, inference_results, ai_unit_commands

### Cross-cutting (4)
- audit_events (SHA-256 hash-chained, append-only), idempotency_keys, outbox, anchor_log

### Substrate seats (29 tables from 0024-0029 + pricing)
Tables exist with RLS policies but are empty. Phase 2-3 implementations slot in without migration cliffs. P1 mocks (ManualRouteEngine, MockDeviceProvider, MockEdgeAI) are stubs.

---

## API — 10 route groups, 3 middleware

### Middleware stack
1. JWT-via-GUC — HMAC verify → SET LOCAL request.jwt.claims + SET LOCAL ROLE app_user per transaction
2. Idempotency — Idempotency-Key header → cached response replay (24h TTL)
3. EventBridge — fire-and-forget PutEvents after transaction commit

### Endpoints
| Group | Methods | Auth | Notes |
|-------|---------|------|-------|
| /health | GET | None | Health check |
| /tenders | POST, GET, GET/:id, PATCH/:id/publish | JWT + Idempotency on mutations | Full CRUD |
| /tenders/:id/bids | POST, GET | JWT + Idempotency on POST | Sealed-bid RLS |
| /escrow | POST, GET/:id, POST/:id/simulate-payment | JWT + Idempotency | via ManualProvider |
| /api/webhooks/:provider | POST | None (signature verified) | Idempotent on provider+eventId |
| /files | GET /upload-url, GET /download-url | JWT | S3 presigned URLs, content-type validation |
| /facilities | GET, POST | JWT | Phase 1 stub |
| /orders | GET, GET/:id | JWT | Phase 1 stub |
| /subscriptions | GET, GET /tiers | JWT | Phase 1 stub |

---

## Lambdas — 11 total

| Lambda | Trigger | Purpose |
|--------|---------|---------|
| auction-close | EventBridge Scheduler every 30s | Close tenders, soft-close, pick winner |
| createEscrow | Step Functions | Initialize escrow |
| releaseToProducer | Step Functions (Parallel) | Pay producer, generate ESG anchor_log |
| releaseToCarrier | Step Functions (Parallel) | Pay carrier |
| refundBuyer | Step Functions | Refund on dispute |
| updateStatus | Step Functions | Generic status transition |
| openDispute | Step Functions | Open dispute on timeout |
| waitForCallback | Step Functions (task token passthrough) | Receives SendTaskSuccess from webhooks |
| audit-export | EventBridge daily 03:00 UTC | audit_events → S3 WORM JSON-Lines |
| outbox-relay | Long-running (polls every 1s) | outbox → AppSync/Supabase Realtime |

---

## Infrastructure — 60+ AWS resources

All Terraform-managed, tagged Project=relowa Env=dev.

```
VPC: 10.0.0.0/16, 2 AZs, 2 public + 2 private subnets, NAT Gateway, 5 VPC Endpoints
RDS: PostgreSQL 18.4, db.t4g.micro, single-AZ, encrypted, backup 1 day, private subnet
ECR: 4 repositories (api, web, admin, lambdas)
S3: 5 buckets (tender-photos, org-documents, efatura, audit-archive WORM, public-assets)
SFN: 1 state machine (escrow, 15 states) + IAM role for Lambda invoke
SQS: 1 queue (webhook processing) + DLQ
Scheduler: 2 schedules (auction-close 30s, audit-export daily 03:00)
IAM: OIDC deploy, ECS task, Lambda, SFN, Scheduler roles
EC2: 1 bastion (t3.micro, public subnet, SSH tunnel to RDS, IP 63.184.134.45)
Secrets Manager: 5 secrets (DB master, DB app, JWT key, bastion SSH key)
```

---

## CI/CD

GitHub Actions workflows at `github.com/ozandalgali/relowa-poc/actions`:
- lint.yml — typecheck, prettier, agents:check, gitleaks (every PR)
- test.yml — Docker Postgres + RLS isolation + unit tests (every PR)
- deploy-dev.yml — Terraform plan via OIDC (every push to main)
- 7 inert stubs (integration, e2e, visual, perf, security, compliance, deploy-prod)

OIDC trust: GitHub → `arn:aws:iam::258975980370:role/relowa-dev-deploy`. GitHub secret: `AWS_DEPLOY_ROLE_ARN`.

---

## Test coverage — 46 tests, 9 files, all green

| File | Tests | Covers |
|------|-------|--------|
| auth.test.ts | 8 | JWT verification, expiry, RLS scoping |
| tenders.test.ts | 7 | CRUD, validation, idempotency, publish |
| bids.test.ts | 5 | Place bid, draft rejection, replay, list |
| bidding-flow.test.ts | 4 | End-to-end tender lifecycle |
| escrow.test.ts | 6 | Auth, 404, no-winner, status |
| escrow-flow.test.ts | 4 | End-to-end escrow lifecycle |
| webhooks.test.ts | 3 | Valid, replay, different events |
| files.test.ts | 5 | Upload URL, auth, validation, download |
| iban.test.ts | 5 | Deterministic hash, verify, reject |

RLS isolation: `./tests/rls-isolation.sh` (5 bash scenarios, cross-tenant isolation).

Run: `pnpm test` (Vitest) or `./tests/rls-isolation.sh` (bash).

---

## Quick start (local dev)

```bash
pnpm infra:up          # Start Docker (Postgres, Realtime, LocalStack, Adminer, pgAdmin)
pnpm db:reset          # Nuke + migrate + seed (30s)
pnpm api:dev           # Start Hono API on :3000
pnpm test              # Run 46 tests
pnpm db:studio         # Drizzle Studio on :4983
```

pgAdmin: `localhost:5050` (admin@relowa.dev / pgadmin_dev_123). Connect to `postgres:5432`.

RDS tunnel: `ssh -i ~/.ssh/relowa-bastion.pem -f -N -L 5433:relowa-dev.c56syqia8638.eu-central-1.rds.amazonaws.com:5432 ec2-user@63.184.134.45`

---

## Deferred (blocked by external access)

- **IyzicoProvider** — needs sandbox API keys (ManualProvider works for dev)
- **Nilvera/Foriba e-fatura** — needs sandbox access
- **Cognito User Pool** — JWT HMAC works for POC (swap middleware for prod)
- **ClamAV scanner** — API content-type validation catches 99% of abuse for POC; full AV in M6

---

## What's next — M5 Frontend

Next.js App Router (`apps/web/`). shadcn UI + `packages/ui` design tokens. Auth pages (login/register/role-select). Operator dashboard (tender list, live bid feed, audit log). Tender create wizard. Marketplace with filters. Escrow status page. next-intl i18n (TR primary, EN secondary). S3 file uploads with presigned URLs.

---

## Key decisions (from AGENTS.md)

1. Postgres is the system of record. Everything else is derived.
2. RLS is the security boundary, not the application.
3. Audit log is append-only (hash-chained, no UPDATE/DELETE policy).
4. Idempotency on every mutation (Idempotency-Key header, cached replay).
5. Server-authoritative state transitions (auctions close via Lambda, never client).
6. Boring technology preferred (Postgres extensions, SQL functions, shadcn).
7. Manual steps must be documented in every plan file (rule #6).
