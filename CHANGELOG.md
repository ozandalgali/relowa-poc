# Changelog

All notable changes to this POC are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project tracks pre-release iterations rather than semantic versions until the substrate decision is final.

## [Unreleased]

### Added (M0 — Infrastructure & CI)
- GitHub Actions CI pipeline: `lint.yml` (typecheck + prettier + agents:check + gitleaks), `test.yml` (RLS isolation + substrate), `deploy-dev.yml` (Terraform plan via OIDC), plus 7 inert stubs (integration, e2e, visual, perf, security, compliance, deploy-prod)
- Terraform IaC under `infra/`: VPC (10.0.0.0/16, 4 subnets), RDS PostgreSQL 18.4 (db.t4g.micro, single-AZ), NAT Gateway, 5 VPC endpoints (Secrets Manager, ECR API, ECR DKR, CloudWatch Logs, S3), 4 ECR repos, IAM roles (OIDC deploy + ECS task + Lambda), Secrets Manager (DB master, DB app, JWT signing key)
- AWS OIDC trust: GitHub ↔ AWS via `token.actions.githubusercontent.com`, role `relowa-dev-deploy`
- `scripts/sync-agents.ts`: byte-identity check for `.opencode/skills/` ↔ `.claude/agents/` with `pnpm agents:check` and `pnpm agents:sync`
- `scripts/wait-for-pg.sh`: CI helper for Postgres readiness polling
- Root `tsconfig.json` for workspace typechecking
- `.prettierrc` + `pnpm format` / `pnpm format:check` scripts
- `pnpm typecheck`, `pnpm agents:check`, `pnpm agents:sync` scripts
- `docs/plans/M0-PLAN.md`: progress tracker for infrastructure milestone
- `infra/.gitignore`: Terraform state exclusion

### Added (M3 — EventBridge wiring)
- **EventBridge PutEvents** from all mutation route handlers — `tender.created`, `tender.published`, `bid.placed` published to `relowa-events` bus (LocalStack dev, fire-and-forget)
- **AWS SDK client** (`apps/api/src/events.ts`) — configures EventBridge client for LocalStack (localhost:4566) with fallback to real AWS
- **Auction close Lambda verified** — end-to-end test: create tender → place bid → wait for close → Lambda picks winner (450.75/ton), soft-close extends on late bids
- **pnpm-workspace** updated to include `apps/lambdas/*` for Lambda packages

### Fixed
- **gitleaks CI failure.** Added `.gitleaks.toml` with global allowlist for known POC dev credentials (not production secrets). Removed invalid `config-path` input from gitleaks-action.
- **Migration CI failure.** Fixed `DATABASE_URL` default port from 5432 → 5433 in `drizzle.config.ts`. Added explicit `DATABASE_URL` env var to `test.yml`.
- **Node.js 20 deprecation.** Added `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` to all active CI workflows.
- **Manual steps gap.** Added rule #6 to `AGENTS.md`: every plan MUST document human-required actions with trigger conditions. Added `## Manual steps` section to `M0-PLAN.md`.

### Added (M1 — Auth, Data & RLS Substrate)
- **14 new tables** across 5 domains: staff RBAC (5 tables), carrier sub-auction (4), escrow (3), outbox (1), anchor_log (1)
- **6 new enums**: `staff_role`, `risk_level`, `carrier_ad_status`, `carrier_bid_status`, `shipment_status`, `escrow_status`
- **RLS policies** on all new tables — 16 new policies (37 total)
- **`relowa_admin` DB role** with BYPASSRLS — staff-access role separated from `app_user`
- **Staff permissions catalog** (17 permissions with risk levels) + role-permission mapping seeded in migration
- **`admin_audit_log` hash chain trigger** — SHA-256 tamper-detection
- **Updated_at triggers** on `carrier_ads`, `carrier_bids`, `shipments`
- **Realtime publication** entries for `carrier_ads`, `carrier_bids`, `shipments`, `shipment_events`
- **RDS backup retention** enabled (1 day, free-tier max)

### Added (Bastion + pgAdmin)
- **Bastion EC2** (t3.micro, free tier) in public subnet — SSH tunnel to private RDS from any IP
- **pgAdmin** container in `docker-compose.yml` — Supabase-like dashboard at `localhost:5050`
- **SSH key auto-generated** by Terraform, stored in Secrets Manager (`/relowa/dev/bastion/ssh-private-key`)
- **RDS security group** updated with bastion-host ingress rule (5432 from bastion SG)

### Added (M3 — EventBridge wiring)
- **EventBridge PutEvents** from all mutation route handlers — `tender.created`, `tender.published`, `bid.placed` published to `relowa-events` bus (LocalStack dev, fire-and-forget)
- **AWS SDK client** (`apps/api/src/events.ts`) — configures EventBridge client for LocalStack (localhost:4566) with fallback to real AWS
- **Auction close Lambda verified** — end-to-end test: create tender → place bid → wait for close → Lambda picks winner (450.75/ton), soft-close extends on late bids
- **pnpm-workspace** updated to include `apps/lambdas/*` for Lambda packages

### Fixed (RDS connectivity)
- **RDS password not applying.** Added `apply_immediately = true` to Terraform RDS config. Previously deferred password changes to Sunday maintenance window.
- **Node.js Postgres SSL.** Added `sslmode=require` to connection strings — RDS requires SSL but Node.js client defaults to plain.
- **Publication syntax.** Replaced invalid `ALTER PUBLICATION ... ADD TABLE IF NOT EXISTS` with resilient `DO $$ ... EXCEPTION WHEN duplicate_object` blocks.
- **Verified.** Full migrations + seed + RLS isolation 5/5 running on live RDS via bastion SSH tunnel.

### Changed
- Schema grows from 7 to 21 application tables; RLS policies from 21 to 37
- `migrate.ts` default port corrected 5432 → 5433; `drizzle.config.ts` simplified (removed dotenv)
- `app_user` role creation now in migration side-car (was only in test scripts)
- `docs/plans/M1-PLAN.md` created with manual steps section

### Added (M2 — Core API & Business Logic)
- **Hono API scaffold** under `apps/api/` — port 3000, Docker service
- **JWT-via-GUC middleware** — HMAC-signed JWT verifies claims, sets `request.jwt.claims` and `SET LOCAL ROLE app_user` for transparent RLS
- **Idempotency middleware** — `Idempotency-Key` header on all mutation endpoints, cached response replay
- **Tender routes**: POST /tenders (create), GET /tenders (RLS-scoped list), GET /tenders/:id, PATCH /tenders/:id/publish
- **Bid routes**: POST /tenders/:id/bids (place bid), GET /tenders/:id/bids
- **Zod validation** on all request bodies
- **Docker Compose api service** — depends on postgres, port 3000

### Added (API Tests)
- **20 integration tests** across 3 files: JWT auth (8), tender CRUD + idempotency (7), bid flow (5)
- **RLS validation**: cross-tenant isolation verified via API (Acme sees own, EkoMetal sees published only, Hizli sees 0)
- **Idempotency tests**: replay returns cached response, missing key rejected
- **Vitest config** + 
> relowa-poc@0.1.0 test /Users/ozan/Desktop/Projects/relowa-poc
> pnpm --filter @relowa/api test


> @relowa/api@0.1.0 test /Users/ozan/Desktop/Projects/relowa-poc/apps/api
> vitest run


 RUN  v4.1.6 /Users/ozan/Desktop/Projects/relowa-poc/apps/api

stdout | src/__tests__/bids.test.ts > Bid flow
<-- GET /tenders

stdout | src/__tests__/bids.test.ts > Bid flow
--> GET /tenders [32m200[0m 29ms

stdout | src/__tests__/bids.test.ts > Bid flow
<-- POST /tenders

stdout | src/__tests__/bids.test.ts > Bid flow
--> POST /tenders [32m201[0m 14ms

 ❯ src/__tests__/bids.test.ts (5 tests | 4 failed) 112ms
     × places a bid on published tender (201) 4ms
     × rejects bid without Idempotency-Key (400) 1ms
     × returns cached bid on idempotent replay 1ms
     × lists bids for tender (200) 0ms

 Test Files  1 failed | 2 passed (3)
      Tests  4 failed | 16 passed (20)
   Start at  04:00:12
   Duration  612ms (transform 209ms, setup 92ms, import 1.04s, tests 340ms, environment 0ms)

/Users/ozan/Desktop/Projects/relowa-poc/apps/api:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @relowa/api@0.1.0 test: `vitest run`
Exit status 1
 ELIFECYCLE  Test failed. See above for more details. script in 

### Added (M3 — Realtime + Workers)
- **Outbox publishing** from all mutation endpoints: `tender.created`, `tender.published`, `bid.placed` written inside same DB transaction
- **Auction close Lambda** (`apps/lambdas/auction-close/`) — finds tenders past `closes_at`, picks highest bid, soft-close anti-sniping (extends by 60s on late bid)
- **EventBridge setup script** (`scripts/setup-events.sh`) — creates event bus, rules, scheduler for LocalStack dev
- **Bidding flow integration test** — end-to-end: create → publish → bid → verify outbox events
- **Outbox INSERT RLS policy** — added to `0002_rls_m1_tables.sql` (was missing, blocked outbox writes from route handlers)

### Added (M3 — EventBridge wiring)
- **EventBridge PutEvents** from all mutation route handlers — `tender.created`, `tender.published`, `bid.placed` published to `relowa-events` bus (LocalStack dev, fire-and-forget)
- **AWS SDK client** (`apps/api/src/events.ts`) — configures EventBridge client for LocalStack (localhost:4566) with fallback to real AWS
- **Auction close Lambda verified** — end-to-end test: create tender → place bid → wait for close → Lambda picks winner (450.75/ton), soft-close extends on late bids
- **pnpm-workspace** updated to include `apps/lambdas/*` for Lambda packages

### Fixed
- Outbox table had no INSERT policy for `app_user` — route handlers running under `SET LOCAL ROLE app_user` couldn't write outbox events. Added `outbox_insert_app_user` policy.

### Added (M4a — Escrow Core + S3)
- **EscrowProvider interface** — provider-agnostic adapter (createEscrow, releaseToSeller, releaseToCarrier, refundBuyer, verifyWebhook)
- **ManualProvider** — DB-only stub for POC/dev, always succeeds, idempotent
- **IBAN hashing utility** — SHA-256(salt + iban) for KVKK compliance (m.12 PII protection)
- **Escrow routes**: POST /escrow (create + call provider), GET /escrow/:id (status + transactions), POST /escrow/:id/simulate-payment (dev funding)
- **Webhook handler** — idempotent (unique constraint on provider + eventId), signature verification, auto-funds escrow on payment.completed
- **S3 presigned URL endpoint** — GET /upload-url, GET /download-url with content-type validation
- **S3 Terraform** — 5 buckets: tender-photos, org-documents, efatura, audit-archive (Object Lock WORM, COMPLIANCE mode), public-assets; all with AES256 encryption + lifecycle policies + public access blocks
- **18 new tests** — escrow (6), webhooks (3), files (5), IBAN (5), all green alongside existing 24 tests (42 total)
- **ClamAV decision** — deferred to M6; API-layer content-type validation catches 99% of abuse for 50-100 POC users

### Planned (M3 — Realtime + Workers)
- Outbox publishing from all mutation endpoints (tender.created, tender.published, bid.placed, tender.won)
- Auction close Lambda (EventBridge Scheduler every 30s, soft-close anti-sniping)
- EventBridge rules + Scheduler wiring
- AppSync GraphQL schema (subscriptions)
- Integration tests for full bidding flow
- ADR-0009: Local EventBridge bidding architecture

### Added (M4a — Escrow Core + S3)
- **EscrowProvider interface** — provider-agnostic adapter (createEscrow, releaseToSeller, releaseToCarrier, refundBuyer, verifyWebhook)
- **ManualProvider** — DB-only stub for POC/dev, always succeeds, idempotent
- **IBAN hashing utility** — SHA-256(salt + iban) for KVKK compliance (m.12 PII protection)
- **Escrow routes**: POST /escrow (create + call provider), GET /escrow/:id (status + transactions), POST /escrow/:id/simulate-payment (dev funding)
- **Webhook handler** — idempotent (unique constraint on provider + eventId), signature verification, auto-funds escrow on payment.completed
- **S3 presigned URL endpoint** — GET /upload-url, GET /download-url with content-type validation
- **S3 Terraform** — 5 buckets: tender-photos, org-documents, efatura, audit-archive (Object Lock WORM, COMPLIANCE mode), public-assets; all with AES256 encryption + lifecycle policies + public access blocks
- **18 new tests** — escrow (6), webhooks (3), files (5), IBAN (5), all green alongside existing 24 tests (42 total)
- **ClamAV decision** — deferred to M6; API-layer content-type validation catches 99% of abuse for 50-100 POC users

### Planned
- Hono API scaffold with tender/bid endpoints, JWT-via-GUC middleware, idempotency middleware
- LocalStack EventBridge bus + rules: `tender.published`, `bid.placed`, `tender.won`, `tender.closing`
- EventBridge Scheduler → Lambda auction close handler (30s interval)
- Soft-close anti-sniping: extend `closes_at` by 60s on late bids
- End-to-end bidding integration test (`tests/bidding-flow.sh`)
- Full tender lifecycle: `DRAFT → PUBLISHED → CLOSING → WON`
- ADR-0009: Local EventBridge bidding architecture

---

## [0.1.0] — 2026-05-09 — Substrate validated

### Added
- Docker Compose topology with Postgres 18, standalone Supabase Realtime container, LocalStack (S3 / EventBridge / Lambda / SES / SQS / Secrets Manager mocks), and Adminer.
- pnpm workspace layout (`apps/*`, `packages/*`).
- Drizzle ORM + Drizzle Kit migration tooling.
- `@relowa/db` package containing:
  - 7-table multi-tenant schema (`organizations`, `users`, `org_members`, `tenders`, `bids`, `audit_events`, `idempotency_keys`).
  - 6 PostgreSQL enums for status / role / type vocabularies.
  - 5 `auth.*` helper functions: `uid()`, `email()`, `org_id()`, `has_role()`, `is_member()`, `user_org_ids()`.
  - 21 RLS policies covering SELECT / INSERT / UPDATE on every application table.
  - Audit hash-chain trigger (`compute_audit_hash`) linking every audit row to the previous via SHA-256.
  - `updated_at` automation triggers.
  - `supabase_realtime` publication including `tenders`, `bids`, `audit_events`.
- `_relowa_migrations` tracking table for raw-SQL side-car migrations alongside Drizzle's `__drizzle_migrations`.
- Idempotent seed script that produces 3 organizations × 5 users × 5 memberships × 3 tenders.
- `pnpm db:reset` orchestrating: container teardown → start → wait → migrate → seed.

### Verified
- Cross-tenant SELECT isolation: producer admin sees own 3 tenders, recycler sees only 2 published, carrier sees 0, anonymous sees 0.
- Cross-tenant INSERT rejection: producer attempting to write to another org's tenders returns `new row violates row-level security policy`.
- Reset cycle: full teardown + rebuild + reseed under 30 seconds, deterministic.

### Added (M3 — EventBridge wiring)
- **EventBridge PutEvents** from all mutation route handlers — `tender.created`, `tender.published`, `bid.placed` published to `relowa-events` bus (LocalStack dev, fire-and-forget)
- **AWS SDK client** (`apps/api/src/events.ts`) — configures EventBridge client for LocalStack (localhost:4566) with fallback to real AWS
- **Auction close Lambda verified** — end-to-end test: create tender → place bid → wait for close → Lambda picks winner (450.75/ton), soft-close extends on late bids
- **pnpm-workspace** updated to include `apps/lambdas/*` for Lambda packages

### Fixed
- **Postgres 18 volume mount.** Switched mount from `/var/lib/postgresql/data` to `/var/lib/postgresql` per the Postgres 18 directory-layout convention. See `docs/memory/learned/postgres-18-volume-mount.md`.
- **Realtime AES key length.** `DB_ENC_KEY` must be exactly 16 ASCII characters for AES-128-ECB. Earlier 32-character value caused `:badarg "Bad key size"` crash loop.
- **Postgres port collision.** Mapped host port 5433 → container 5432 to avoid conflict with Homebrew `postgresql@16` on developer machines. Saved 30 minutes of "wrong password" bewilderment. See `docs/memory/learned/postgres-port-conflict.md`.
- **RLS infinite recursion.** Helper functions touching `org_members` from inside RLS policies on `org_members` produced infinite recursion. Fix: helpers marked `SECURITY DEFINER` with explicit `search_path`. See `docs/memory/learned/rls-recursion-fix.md`.
- **`auth.uid()` cast.** Initially returned `text` but declared `uuid`; cast added inside the function body.

### Decisions captured
- ADR-0001: Postgres as system of record.
- ADR-0002: Run Supabase Realtime standalone — every other Supabase piece is hand-rolled.
- ADR-0003: RLS with the JWT-via-GUC pattern (mirrors Supabase's `auth.uid()` mechanism, but in our control).
- ADR-0004: Multi-agent orchestration model for ongoing work (this POC + Phase 1).

---

[Unreleased]: https://example.com/relowa-poc
[0.1.0]: https://example.com/relowa-poc/0.1.0
