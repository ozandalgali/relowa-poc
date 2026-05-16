# Relowa — Executive Summary & Architecture

> **Handoff document** — CTO-level overview of the Phase 1 backend.
> Last updated: 2026-05-16. All code lives at `github.com/ozandalgali/relowa-poc`.

---

## 1. What Relowa Is

A **B2B Waste Operating System** for Turkey. Three actor types transact through the platform:

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

## 2. Tech Stack

| Layer | Choice | Purpose |
|-------|--------|---------|
| **System of Record** | PostgreSQL 18.4 (RDS, private subnet) | All authoritative state. Multi-tenant via RLS. |
| **API** | Hono 4 (Node.js, `apps/api/`) | REST endpoints with JWT-via-GUC + idempotency |
| **ORM** | Drizzle ORM + Drizzle Kit | Type-safe Postgres queries, auto-migrations |
| **Auth** | JWT HMAC (dev) → Cognito (prod) | Claims set via `request.jwt.claims` GUC per transaction |
| **Security boundary** | Postgres Row-Level Security (RLS) | 37 policies across 21 tables. Zero auth code in application layer. |
| **Workflows** | AWS Step Functions | Multi-day escrow state machine (15 states) |
| **Scheduling** | AWS EventBridge Scheduler | Auction close every 30s, daily audit export |
| **Realtime** | Supabase Realtime (dev) → AWS AppSync (prod) | Outbox pattern → relay → subscriptions |
| **Events** | AWS EventBridge | Domain events from mutations, fire-and-forget |
| **Queues** | AWS SQS | Webhook processing with dead-letter queue |
| **Storage** | AWS S3 (5 buckets) | Tender photos, org docs, e-fatura, audit archive (WORM), public assets |
| **IaC** | Terraform | 60+ AWS resources, OIDC trust for CI deploys |
| **CI/CD** | GitHub Actions + OIDC | Lint, test (46 API tests), deploy-dev |
| **Local dev** | Docker Compose | Postgres, Realtime, LocalStack, Adminer, pgAdmin |
| **Compliance** | Arbitrum One (EVM L2) | Daily Merkle root → smart contract ($0.01/day) |
| **Frontend (planned)** | Next.js + shadcn + packages/ui | M5 (next sprint) |

---

## 3. Database — 21 Tables, 37 RLS Policies

### Identity & Tenancy (core multi-tenant model)
| Table | Purpose | RLS |
|-------|---------|-----|
| `users` | Operator identity (email, password hash) | Own record only |
| `organizations` | Tenants (Producer/Recycler/Carrier) | Own org |
| `org_members` | User ↔ Org with role (admin/operations/accounting) | Membership-based |

### Business — Tenders & Bids
| Table | Purpose | RLS |
|-------|---------|-----|
| `tenders` | Waste tender lifecycle: DRAFT→PUBLISHED→CLOSING→WON | Producer: own. Recycler: published. Carrier: none. |
| `bids` | Recycler bids on tenders (price_per_ton) | Bidder: own. Tender owner: can't see (sealed-bid). |

### Business — Carrier Sub-Auction
| Table | Purpose | RLS |
|-------|---------|-----|
| `carrier_ads` | Recycler posts transport job after winning tender | Recycler: own. Carrier: open ads. Producer: own tender's ads. |
| `carrier_bids` | Carrier bids on transport jobs | Carrier: own. Recycler: bids on own ads. |
| `shipments` | Physical transport order | Involved parties (carrier, recycler, producer) |
| `shipment_events` | Pickup/in-transit/delivered events | Carrier: write. All involved: read. |

### Finance — Escrow
| Table | Purpose | RLS |
|-------|---------|-----|
| `escrow_orders` | Escrow lifecycle: PENDING→FUNDS_LOCKED→IN_TRANSIT→DELIVERED→RELEASED/REFUNDED/DISPUTED | Involved parties |
| `escrow_transactions` | Each money movement (fund, release, refund) | Via escrow_order |
| `provider_webhooks` | Idempotent webhook storage (unique on provider+eventId) | System-only |

### Staff RBAC (internal platform team)
| Table | Purpose | Access |
|-------|---------|--------|
| `internal_staff` | Staff identity (super_admin/account_manager/support_agent/compliance_officer/financial_analyst) | `relowa_admin` role only (BYPASSRLS) |
| `staff_org_assignments` | Staff ↔ Org assignment | `relowa_admin` only |
| `staff_permissions` | 17 permission codes with risk levels | `relowa_admin` only |
| `staff_role_permissions` | Role → Permission mapping | `relowa_admin` only |
| `admin_audit_log` | Every staff action, mandatory reason, hash-chained | `relowa_admin` only |

### Cross-cutting
| Table | Purpose | Access |
|-------|---------|--------|
| `audit_events` | SHA-256 hash-chained audit trail (append-only) | Org-scoped SELECT |
| `idempotency_keys` | Mutation replay cache (24h TTL, org-scoped) | Own org |
| `outbox` | Transactional event log → relay → realtime | System INSERT |
| `anchor_log` | Daily Merkle root records (Arbitrum anchoring) | System-only |

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
| Escrow | POST | `/escrow` | JWT+Idempotency | Create escrow from won tender |
| | GET | `/escrow/:id` | JWT | Escrow status + transactions |
| | POST | `/escrow/:id/simulate-payment` | JWT | Dev-only: fund escrow |
| Webhooks | POST | `/api/webhooks/:provider` | None (signature) | Provider callback (idempotent) |
| Files | GET | `/upload-url` | JWT | S3 presigned upload URL |
| | GET | `/download-url` | JWT | S3 presigned download URL |

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

---

## 6. Key Flows

### 6.1 Tender Lifecycle
```
DRAFT
  │  Producer creates: POST /tenders
  ▼
DRAFT
  │  Producer publishes: PATCH /tenders/:id/publish (sets closesAt)
  ▼
PUBLISHED
  │  Recyclers place bids: POST /tenders/:id/bids
  │  outbox: tender.published → bid.placed events
  │  EventBridge Scheduler → auction-close Lambda every 30s
  ▼
CLOSING (soft-close)
  │  If bid placed in last 60s → extend closesAt by 60s
  │  If no late bid → determine winner (highest pricePerTon)
  ▼
WON
  │  outbox: tender.won event
  │  Escrow flow starts
```

### 6.2 Escrow Lifecycle
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
  │  No dispute → ReleaseFunds (parallel: producer + carrier)
  ▼
RELEASED
  │  ESG cert → anchor_log entry
  │  outbox: escrow.producer_paid, escrow.carrier_paid
  │  Daily Merkle root anchored to Arbitrum One
```

---

## 7. Infrastructure — 60+ AWS Resources

| Resource | Count | Purpose |
|----------|-------|---------|
| VPC + Subnets + NAT + IGW | 10 | Network isolation (10.0.0.0/16, 2 AZs) |
| VPC Endpoints | 5 | Secrets Manager, ECR API/DKR, CloudWatch Logs, S3 |
| RDS PostgreSQL 18.4 | 1 | Single-AZ, db.t4g.micro, encrypted, backup 1 day |
| ECR Repositories | 4 | API, Web, Admin, Lambdas |
| S3 Buckets | 5 | Tender photos, Org docs, E-fatura, Audit archive (WORM), Public assets |
| Step Functions State Machine | 1 | Escrow (15 states) |
| SQS Queues | 1 + DLQ | Webhook processing |
| EventBridge Scheduler | 2 | Auction close (30s), Audit export (daily) |
| Secrets Manager | 4 | DB passwords, JWT key, Bastion SSH key |
| EC2 Bastion | 1 | t3.micro, SSH tunnel to RDS |
| IAM Roles | 6 | OIDC deploy, ECS task, Lambda exec, SFN exec, Scheduler |
| **Total** | **~60** | All Terraform-managed, tagged `Project=relowa Env=dev` |

---

## 8. Lambdas (11 total)

| Lambda | Trigger | Purpose |
|--------|---------|---------|
| `auction-close` | EventBridge every 30s | Close tenders past closesAt, pick winner, soft-close |
| `createEscrow` | Step Functions | Initialize escrow, write audit |
| `releaseToProducer` | Step Functions (Parallel) | Release waste payment, generate ESG cert |
| `releaseToCarrier` | Step Functions (Parallel) | Release transport payment |
| `refundBuyer` | Step Functions | Refund recycler on dispute |
| `updateStatus` | Step Functions | Generic status transition + audit |
| `openDispute` | Step Functions | Open dispute on shipment timeout |
| `waitForCallback` | Step Functions (task token passthrough) | Receives SendTaskSuccess from webhooks/admin |
| `audit-export` | EventBridge daily 03:00 UTC | Export audit_events → S3 WORM JSON-Lines |
| `outbox-relay` | Long-running ECS/Lambda | Poll outbox, ship to AppSync/Supabase |
| `clamav-scanner` | S3 PutObject events (M6) | Virus scan uploaded files (deferred) |

---

## 9. Test Coverage — 46 Tests, 9 Files

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

---

## 10. Deferred (blocked by external access)

| Item | Blocker | Pattern ready? |
|------|---------|---------------|
| IyzicoProvider | Sandbox API keys | `EscrowProvider` interface written |
| PayTRProvider | Sandbox API keys | Same interface |
| Nilvera/Foriba e-fatura | Sandbox access | Adapter pattern, 1 file |
| Cognito User Pool | Not needed in dev | JWT HMAC works for POC, swap middleware for prod |
| ClamAV scanner | Deferred to M6 | S3 event Lambda, ~100 lines |
| KVKK aydınlatma metni | Legal document | Not code |

---

## 11. What's Next

| # | Sprint | Type |
|---|--------|------|
| M5 | Frontend (`apps/web`) — Next.js App Router, shadcn, all operator pages | Frontend |
| M6 | Admin Panel (`apps/admin`) — VPN, SAML, staff tools | Frontend (post-launch) |

### M5 scope (planned)
- Next.js App Router with `packages/ui` design tokens
- Auth pages: login, register, role select
- Operator dashboard: tender list, live bid feed (AppSync/outbox), audit log
- Tender wizard: create → publish flow
- Marketplace: recycler view with filters
- Escrow status page
- S3 file uploads with presigned URLs
- next-intl i18n (TR primary, EN secondary)

---

## 12. Appendix — Quick Diagnose

```bash
# Local dev
pnpm infra:up                     # Start all Docker services
pnpm api:dev                      # Start Hono API on :3000
pnpm test                         # Run 46 API tests
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
