# Phase 1 Milestones

**4-month build — B2B Waste Operating System for Turkey**

| Property | Detail |
|---|---|
| Start | Week 1 |
| Duration | 16 weeks (+2 buffer) |
| Team | Solo lead (Ozan) + AI agents |
| Deploy target | AWS eu-central-1 (Frankfurt) |
| Compliance target | KVKK + EU CSRD/ESPR-ready |

---

## M0 — Environment & Infrastructure

**Weeks 1-3** | Status: 📋 Planned

Goal: Every AWS service is provisioned, networked, and reachable before a single line of business logic is written. CI pipeline + agents-sync gate live.

- [ ] AWS Organizations + SSO, IAM roles (dev/prod separation)
- [ ] VPC with public/private subnets, NAT Gateway, VPC Endpoints
- [ ] RDS PostgreSQL Multi-AZ (db.t4g.medium), parameter group for RLS
- [ ] ElastiCache Redis (cache.t4g.micro), cluster mode disabled for POC
- [ ] Cognito User Pool + App Client (no client secret for SPA)
- [ ] Pre-Token-Generation Lambda (Cognito → JWT with memberships) — ADR-0005
- [ ] ECS Fargate cluster + task definitions (API, web, admin)
- [ ] ECR repositories (api, web, admin, anchor-lambda, escrow-tasks, tender-close-handler)
- [ ] S3 buckets: `audit-archive` (Object Lock WORM), `documents`, `static-assets`
- [ ] **GitHub Actions workflows** — lint, test, integration, e2e, deploy-dev, deploy-prod, security, compliance — ADR-0017 + `docs/runbook/ci-pipeline.md`
- [ ] **AWS OIDC trust** for `relowa-dev-deploy` + `relowa-prod-deploy` roles — ADR-0015
- [ ] **`pnpm agents:check`** wired into CI — ADR-0016 + `docs/agents/sync-strategy.md`
- [ ] **AWS Client VPN endpoint** + Private CA + Route53 Private Hosted Zone for `admin.relowa.local` — ADR-0015
- [ ] **IAM Identity Center** SAML application for `apps/admin` — ADR-0015
- [ ] CloudWatch log groups, CloudTrail enabled
- [ ] Sentry EU project + PostHog EU project provisioned

**Deliverables:** Terraform/CDK stack, architecture diagram, runbook for teardown/recreate, working CI pipeline

---

## M1 — Auth, Data & RLS Substrate

**Weeks 4-6** | Status: ⏳ In progress (POC done)

Goal: A user logs in via Cognito, gets a JWT, and every Postgres query is transparently scoped to their org via RLS. Zero authorization code in the application layer. Schema additions land for every Phase-1 module so future migrations don't require schema-cliff PRs.

- [x] Drizzle schema v1 complete — 7 tables, 4 enums, 16 indexes
- [x] RLS policies on every table (21 policies, POC-validated pattern)
- [x] `auth.*` helper functions (`uid()`, `org_id()`, `has_role()`, `is_member()`, `email()`, `user_org_ids()`)
- [ ] JWT-via-GUC middleware (in Hono API, M2) — ADR-0005
- [ ] Cognito → JWT claim mapping verified (sub, email, memberships) — ADR-0005
- [ ] API-signed session JWT with `active_org_id` + role — ADR-0005
- [ ] Org switching (new JWT issued, never client-claimed) — ADR-0005
- [x] `idempotency_keys` table (schema ready, middleware in M2)
- [ ] `anchor_log` table for daily Merkle root records — ADR-0008
- [ ] **Staff RBAC schema** — `internal_staff`, `staff_org_assignments`, `staff_permissions`, `staff_role_permissions`, `admin_audit_log` — ADR-0014
- [ ] **`relowa_admin` DB role** with BYPASSRLS attribute — ADR-0014
- [ ] **Carrier sub-auction schema** — `carrier_ads`, `carrier_bids`, `shipments`, `shipment_events` — ADR-0010
- [ ] **Escrow schema** — `escrow_orders`, `escrow_transactions`, `provider_webhooks` — ADR-0007
- [ ] **Outbox table** — for AppSync relay — ADR-0006
- [x] Audit hash chain trigger (POC-validated) ported to RDS
- [ ] Database backup + PITR configured on RDS

**Deliverables:** RLS isolation test suite ✅, auth flow integration test, seed data ✅

---

## M2 — Core API & Business Logic

**Weeks 7-10** | Status: ⏳ Next up

Goal: All CRUD for tenders and bids live behind Hono API. Idempotency on every mutation. EventBridge events on every state change. Full local deployable demo.

- [ ] Hono API scaffold (`apps/api/`) with route groups
- [ ] JWT-via-GUC middleware (dev HMAC, Cognito-ready)
- [ ] Idempotency middleware on all mutation endpoints
- [ ] `POST /tenders` — create tender (idempotent, RLS-enforced)
- [ ] `GET /tenders` — list tenders (RLS: own org + published)
- [ ] `GET /tenders/:id` — tender detail with bid history
- [ ] `POST /tenders/:id/bids` — place bid (idempotent, soft-close trigger)
- [ ] `PATCH /tenders/:id/publish` — publish tender (admin only)
- [ ] `GET /audit` — audit log with org-scoped filtering
- [ ] Zod validation on all request bodies
- [ ] EventBridge `PutEvents` publish from route handlers
- [ ] `docker-compose.yml` api service + healthcheck
- [ ] OpenAPI/Swagger auto-generated via `@hono/zod-openapi`

**Deliverables:** Deployable local bidding API, integration test, EventBridge trace

---

## M3 — Real-time Push + Background Workers

**Weeks 11-13** | Status: 📋 Planned

Goal: Live UI via AppSync subscriptions. Background work on SQS workers. Auction close Lambda deployed. S3 audit mirror + Arbitrum anchor running daily.

- [ ] Outbox table + DB trigger (CDC → AppSync publish)
- [ ] AppSync GraphQL schema (subscriptions: `onBidPlaced`, `onTenderUpdated`, `onAuditEvent`)
- [ ] SQS → Lambda workers (email notifications, webhook dispatches)
- [ ] Auction close Lambda deployment (production IAM + monitoring)
- [ ] S3 audit mirror daily job (JSON-Lines export with Object Lock)
- [ ] Arbitrum One anchor Lambda (daily Merkle root → Anchor contract)

**Deliverables:** End-to-end real-time test (place bid → AppSync push → UI update), EventBridge trace, anchored hash proof

---

## M4 — Escrow, Providers & ESG

**Weeks 14-16** | Status: 📋 Planned

Goal: Money moves through a Step Functions escrow state machine, provider-agnostic. e-fatura is issued on settlement. ESG certificates are anchored on-chain.

- [ ] Provider-agnostic escrow interface (`EscrowProvider` abstract class)
- [ ] `ManualProvider` implementation (DB-simulated for POC/dev)
- [ ] `IyzicoProvider` — Iyzico Marketplace API + sub-merchant + payout hold
- [ ] Step Functions escrow state machine (PENDING → FUNDED → IN_TRANSIT → DELIVERED → RELEASED, with DISPUTED branch)
- [ ] Escrow webhook handler (idempotent, idempotency key from Iyzico)
- [ ] `material_recovery_certificate` generation on escrow RELEASED
- [ ] ESG certificate hash included in daily Merkle root
- [ ] Nilvera/Foriba e-fatura stub → real integration
- [ ] IBAN hashing at rest (PII protection, KVKK m.12)
- [ ] KVKK aydınlatma metni delivery flow

**Deliverables:** Escrow state machine diagram, provider adapter test (manual → iyzico), ESG verification demo

---

## M5 — Frontend & Launch

**Weeks 17-18** | Status: 📋 Planned

Goal: `apps/web` deployed, connected to all backend services. Monitoring is live. Compliance package complete. Admin panel UI deferred to M6.

- [ ] `apps/web` Next.js App Router (TypeScript, `packages/ui`, Tailwind) — ADR-0012
- [ ] `packages/ui` design tokens + primitives + patterns + shells — ADR-0011
- [ ] `packages/maps` adapter (MapLibre default in dev/POC) — ADR-0013
- [ ] next-intl wiring with `tr/` and `en/` message files per module — PRD-0005
- [ ] Auth pages (login, register, role select, OTP, password reset via Cognito) — ADR-0005
- [ ] Marketing pages (landing, technology, contact)
- [ ] Operator dashboard (tender list, live bid feed via AppSync, audit log tail)
- [ ] Tender create wizard (2 steps, AI photo analyze)
- [ ] Tender detail page (bid form, countdown, bid history) — AppSync subscription
- [ ] Marketplace (recycler) with filters
- [ ] Carrier ad open/list/detail pages — ADR-0010 UI
- [ ] Operations tracking with `MapPanel` + `RouteLayer` — ADR-0013
- [ ] Finance / escrow / invoices pages — ADR-0007 UI
- [ ] ESG report + certificate viewer with `MerkleProofBadge` — ADR-0008
- [ ] Settings (profile, authority management, password, account close)
- [ ] Help center + ticket flow + AI assistant
- [ ] `RoleAwareSidebar` claims-driven nav — ADR-0012
- [ ] PostHog EU event tracking (page views, bid events, escrow events)
- [ ] Sentry EU error monitoring
- [ ] CloudWatch dashboard (API latency, error rate, escrow state transitions)
- [ ] KVKK compliance package: SCC documentation, VERBİS registration, 5-day breach notification template
- [ ] Load test (k6 or Artillery)
- [ ] Penetration test scope document
- [ ] Production runbook

**Deliverables:** Deployed `apps/web`, monitoring dashboard, KVKK compliance folder

## M6 — Admin Panel (post-launch)

**Weeks 19-22** | Status: 📋 Planned

Goal: `apps/admin` deployed behind VPN + SAML. Staff can search orgs, manage tickets, resolve escrow disputes, impersonate users with full audit trail.

- [ ] AWS Client VPN endpoint + Private CA setup — ADR-0015
- [ ] Route53 Private Hosted Zone for `admin.relowa.local` — ADR-0015
- [ ] AWS IAM Identity Center + SAML application — ADR-0015
- [ ] `apps/admin` Next.js scaffold + `AdminShell` — ADR-0012
- [ ] `requirePermission` middleware + audit logging — ADR-0014
- [ ] Org search + drill-down — ADR-0014
- [ ] Impersonation iframe flow with dual audit — ADR-0014
- [ ] Ticket management surface (account_manager + support_agent)
- [ ] Escrow dispute resolution UI (super_admin) — ADR-0007
- [ ] Staff management UI (super_admin) — ADR-0014
- [ ] Compliance audit log search + export (compliance_officer) — ADR-0008 Merkle proofs included

**Deliverables:** Deployed `apps/admin` on private DNS, VPN runbook, staff onboarding script

---

## Timeline view

```
Week  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19 20 21 22
M0    ████████████
M1             ████████████
M2                      ████████████████
M3                                  ████████████
M4                                              ████████████
M5                                                        ████████
M6                                                                ████████████
```

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Iyzico sandbox unavailable / slow approval | Blocks M4 escrow testing | `ManualProvider` works independently; switch to PayTR as fallback |
| Cognito Lambda cold starts > 200ms | Auth latency for every request | Provisioned concurrency for Pre-Token-Generation Lambda |
| AppSync latency in eu-central-1 | Real-time push feels sluggish | Measure; if >500ms p95, fall back to API Gateway WebSocket |
| Solo throughput ceiling | 4 months is tight for 18 weeks of work | AI agents parallelize; scope-cut non-core (AI FastAPI, KPS) to Phase 2 |
| KVKK registration delays | Cannot launch without VERBİS | Start registration Week 1; it's a paperwork dependency, not code |
| Arbitrum One testnet → mainnet migration | Anchor contract address changes | Config-driven; trivial redeploy |
