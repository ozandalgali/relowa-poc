# Relowa POC — Handoff

> **Read this first** if you're picking up the project from any session boundary — agent, human, fresh laptop, new contributor.
> Last updated: 2026-05-16.

> **NEW (2026-05-16)** — third planning round complete. **5-layer architecture** + **substrate seats for IoT/AI/VRP** + **subscription tiers** + **orders separate from tenders** + **facilities** + **Phase 2/3/4 vision** locked. Six new ADRs (0024-0029), one new PRD (0010), two amendments (PRD-0008 with hybrid revenue, PRD-0004 with layer view), executive summary rewritten.
> The single master-plan dashboard lives at [`docs/_site/index.html`](docs/_site/index.html).
> The CTO-level overview lives at [`docs/HANDOFF-EXECUTIVE-SUMMARY.md`](docs/HANDOFF-EXECUTIVE-SUMMARY.md).
> See the "Three-pillar fusion + substrate seats — 2026-05-16" section below.

This document is the single source of truth for **where the project is right now** and **what the next session should do**. Everything else (README, ADRs, memory notes) is context; this file is the entry point.

---

## TL;DR for the impatient

- **POC substrate works.** 5/5 RLS isolation tests pass. Postgres 18 + Drizzle + 21 RLS policies + audit hash chain + idempotency table + Realtime publication all live.
- **Architecture has pivoted twice.** First to "Plan B+ Realtime Hybrid" (Supabase OSS Realtime + own everything else), then to "full AWS-native" (Cognito + AppSync + Step Functions + Arbitrum One anchoring).
- **The new contract is documented** in ADR-0008 (Arbitrum hash anchoring) and ADR-0009 (Local EventBridge bidding architecture). These supersede the original Plan B+ direction; ADR-0002 (Supabase Realtime standalone) is now **historical** — the production path goes through AppSync, not standalone Supabase Realtime.
- **Next session's job:** implement the Hono API skeleton + EventBridge wiring per ADR-0009. Detailed steps in [Next Session Entry Point](#next-session-entry-point) below.

---

## Project state at a glance

```
relowa-poc/
├── README.md                          ✓ written
├── CHANGELOG.md                       ✓ written (Unreleased + 0.1.0)
├── AGENTS.md                          ✓ written
├── HANDOFF.md                         ← you are here
├── docker-compose.yml                 ✓ Postgres 18 + Realtime + LocalStack + Adminer running healthy
├── .env / .env.example                ✓ both present, .env is git-ignored
├── docker/postgres/init.sql           ✓ extensions, supabase_realtime publication, supabase_realtime_admin role
├── package.json                       ✓ pnpm workspace, db:* scripts wired
├── pnpm-workspace.yaml                ✓ workspace declared
├── apps/                              ✗ NOT YET CREATED — see "Next session entry point"
├── packages/db/                       ✓ schema, migrations, seed, migrate runner, drizzle config all wired
│   ├── src/schema.ts                  ✓ 7 tables, 6 enums
│   ├── src/migrations/                ✓ 0000 (Drizzle-generated) + 0001_rls_helpers_and_policies.sql
│   ├── src/migrate.ts                 ✓ two-phase runner (Drizzle + raw SQL side-cars)
│   └── src/seed/index.ts              ✓ 3 orgs × 5 users × 3 tenders
├── docs/
│   ├── prd/                           ✓ 0001-vision.md, 0002-phase-1-scope.md
│   ├── adr/                           ✓ 0001, 0002 (historical), 0003, 0004, 0008, 0009
│   ├── runbook/                       ✓ local-development.md, rls-debugging.md, reset-and-seed.md
│   ├── memory/                        ✓ 5 concept notes, 4 learned notes, _index.md
│   └── testing/                       ✓ strategy.md
├── .opencode/skills/                  ✓ 6 skill files + README
└── tests/                             ✓ rls-isolation.sh (5/5 passing)
```

---

## What has been built (in priority order)

### 1. Infrastructure (working, healthy)

`docker-compose up -d` brings up:

| Service | Port | Image | Status |
|---|---|---|---|
| Postgres 18 | `5433` | `postgres:18-alpine` | healthy |
| Supabase Realtime | `4000` | `supabase/realtime:v2.30.34` | running (note: superseded by AppSync in production — see ADR-0008/0009) |
| LocalStack | `4566` | `localstack/localstack:3.7` | healthy — S3/EventBridge/Lambda/SES/SQS/Secrets Manager mocked |
| Adminer | `8080` | `adminer:latest` | running |

**Why port 5433** for Postgres: Homebrew `postgresql@16` typically holds 5432 on macOS dev machines. See `docs/memory/learned/postgres-port-conflict.md`.

**Critical environment quirks** discovered:
- Postgres 18 mount path is `/var/lib/postgresql`, not `/var/lib/postgresql/data` (see `docs/memory/learned/postgres-18-volume-mount.md`).
- Realtime `DB_ENC_KEY` must be **exactly 16 ASCII chars** for AES-128-ECB (see `docs/memory/learned/realtime-aes-key-length.md`).
- RLS helpers touching `org_members` must be `SECURITY DEFINER` to avoid recursion (see `docs/memory/learned/rls-recursion-fix.md`).

### 2. Database (working, validated)

**Schema** in `packages/db/src/schema.ts`:

- **7 tables:** `users`, `organizations`, `org_members`, `tenders`, `bids`, `audit_events`, `idempotency_keys`
- **6 enums:** `org_type`, `org_role`, `tender_status`, `material_type`
- **Multi-tenant model:** customer = organization, user belongs via `org_members`, JWT carries `active_org_id`

**RLS** in `packages/db/src/migrations/0001_rls_helpers_and_policies.sql`:

- **`auth.*` schema** with helper functions: `uid()`, `email()`, `org_id()`, `has_role()`, `is_member()`, `user_org_ids()`
- All `auth.*` helpers that touch tables are `SECURITY DEFINER` with explicit `search_path` — avoids RLS recursion
- **21 RLS policies** across 7 tables (cross-tenant + intra-org role)
- **Audit hash chain trigger** (`compute_audit_hash`) — SHA-256 chains every audit row to its predecessor
- **`updated_at` automation** on `users`, `tenders`
- `tenders`, `bids`, `audit_events` added to `supabase_realtime` publication (still present even though we'll swap to AppSync in production)

**Migration runner** in `packages/db/src/migrate.ts`:

- Two-phase: Drizzle-generated migrations first, then raw SQL side-cars from `RAW_SQL_FILES`
- Tracks applied side-cars in `_relowa_migrations` table — idempotent reruns
- Honors `.env` from monorepo root via explicit `dotenv` loading from `../../../.env`

**Seed** in `packages/db/src/seed/index.ts`:

- 3 organizations: Acme (producer), EkoMetal (recycler), Hızlı (carrier)
- 5 users with realistic Turkish names, distributed across roles
- 3 tenders (2 published, 1 draft)
- **Idempotent** — truncates and re-inserts; safe to rerun
- Never touches `audit_events` (append-only invariant)

**Available pnpm scripts** (defined in root `package.json`):

```bash
pnpm db:generate    # Generate Drizzle migration from schema.ts changes
pnpm db:migrate     # Apply pending migrations (both Drizzle and raw side-cars)
pnpm db:studio      # Open Drizzle Studio in browser
pnpm db:seed        # Idempotent reseed
pnpm db:reset       # docker compose down -v && up -d && wait && migrate && seed (~30s)
pnpm infra:up       # docker compose up -d
pnpm infra:down     # docker compose down
pnpm infra:logs     # tail logs
```

### 3. Tests (5/5 green)

`tests/rls-isolation.sh` — the canonical regression test. Runs 5 scenarios:

| # | Scenario | Expected | Status |
|---|---|---|---|
| 1 | Acme admin sees all 3 own-org tenders (incl. draft) | 3 rows | ✓ |
| 2 | EkoMetal recycler admin sees only published tenders | 2 rows | ✓ |
| 3 | Hızlı carrier sees 0 (no carrier policy yet) | 0 rows | ✓ |
| 4 | Anonymous user (no JWT) sees 0 | 0 rows | ✓ |
| 5 | Cross-tenant INSERT denied by RLS | RLS violation | ✓ |

This script is **load-bearing** — if it goes red, the substrate claim is broken. Run it after every schema or RLS change.

### 4. Documentation system

The project documents itself in four layers:

**Vision & scope** (`docs/prd/`):
- `0001-vision.md` — what Relowa is, who it's for
- `0002-phase-1-scope.md` — 3-4 month core flow, what's in, what's deferred, what we'd cut

**Architecture decisions** (`docs/adr/`):
- `0001-postgres-as-system-of-record.md` — SoR commitment
- `0002-supabase-realtime-standalone.md` — **HISTORICAL** — Supabase Realtime container approach, now superseded by ADR-0008 + ADR-0009 (production uses AppSync; current POC still has the Realtime container running but it's not the production path)
- `0003-rls-with-jwt-guc-pattern.md` — RLS pattern with JWT GUC
- `0004-multi-agent-orchestration.md` — the skills/memory system
- `0008-arbitrum-hash-anchoring.md` — daily Merkle root → Arbitrum One for regulatory timestamping (CSRD/ESPR/WSR)
- `0009-local-bidding-architecture.md` — local-first EventBridge bidding loop

**Runbooks** (`docs/runbook/`):
- `local-development.md` — first-time setup, daily workflow, troubleshooting
- `rls-debugging.md` — diagnosing RLS-related failures
- `reset-and-seed.md` — when to nuke and reseed

**Memory vault** (`docs/memory/`):
- Obsidian-style wikilinks
- `concepts/`:
  - `auth-uid-pattern.md` — how RLS works without Supabase
  - `multi-tenancy.md` — org / user / role model
  - `audit-hash-chain.md` — tamper-evident audit trail
  - `idempotency.md` — why every mutation needs a key
  - `server-authoritative-state.md` — why client clocks lie
  - `hash-anchoring.md` — daily Merkle root on Arbitrum One *(added by user, referenced from `_index.md`)*
- `learned/`:
  - `postgres-port-conflict.md` — the 5432 vs 5433 saga
  - `postgres-18-volume-mount.md` — directory layout change
  - `rls-recursion-fix.md` — SECURITY DEFINER as recursion-breaker
  - `realtime-aes-key-length.md` — `DB_ENC_KEY` must be exactly 16 chars

**Skills** (`.opencode/skills/`):
- `README.md` — how skills work
- `migration-author.md` — schema + RLS authoring
- `rls-test-runner.md` — verification protocol
- `audit-trail-verifier.md` — hash chain integrity
- `endpoint-writer.md` — Hono endpoint conventions
- `realtime-debugger.md` — Realtime/CDC diagnosis
- `doc-keeper.md` — memory graph maintenance

---

## What has *not* been built (and is intentional)

These are referenced in docs but **deliberately deferred** to keep the POC focused:

- **`apps/api/`** — Hono backend. Schema in `endpoint-writer.md` skill describes the pattern but no code yet. **This is the immediate next-session target.**
- **`apps/web/`** — Next.js frontend with Realtime subscription demo.
- **`apps/lambdas/`** — auction close Lambda + soft-close logic.
- **`tests/bidding-flow.sh`** — end-to-end integration test for the auction lifecycle.
- **AppSync wiring** — production realtime path; current POC still uses standalone Supabase Realtime container (works for now, but ADR-0009 specifies AppSync for production).
- **Cognito integration** — production auth; current POC uses bcrypt placeholders in seed data.
- **Step Functions for escrow** — escrow state machine; designed but not coded.
- **Arbitrum anchor contract + Lambda** — daily Merkle root publication.
- **Iyzico/Nilvera Turkish provider integrations.**
- **CI pipeline** — `.github/workflows/` will land alongside `apps/api/`.

---

## Architectural pivots — read this carefully

The architecture has evolved through three distinct phases. Future sessions need to know which is current.

### Phase A — "Plan A: Supabase OSS self-hosted" (early)

Initial plan was to self-host all Supabase OSS components (GoTrue, PostgREST, Realtime, Storage API) on AWS Fargate. Captured in original ADR-0002 and ADR-0003.

### Phase B — "Plan B+ Realtime Hybrid" (mid)

After concern about Supabase ecosystem footprint, plan shifted to:
- Drizzle + Hono + Better-Auth/Cognito
- **Only Supabase Realtime container** kept (for Postgres CDC magic)
- Everything else hand-rolled

This is what the **current POC code reflects** — Realtime container is running, no other Supabase pieces.

### Phase C — "Full AWS-native" (current, decided 2026-05-11)

Per stakeholder direction "go full AWS":
- **Cognito** for auth (Pre-Token-Generation Lambda for org/role claims)
- **AppSync GraphQL subscriptions** for realtime (with outbox pattern for CDC equivalent)
- **NestJS or Hono** on Fargate for API (memo says NestJS; pragmatic recommendation is Hono — see open decisions below)
- **Step Functions** for escrow state machine
- **EventBridge Scheduler** for tender close (replacing pg_cron usage)
- **ElastiCache Redis** for rate limit + bid cache + WS sessions
- **Arbitrum One** for daily audit Merkle root anchoring (ADR-0008)
- **Provider-agnostic escrow abstraction** with Iyzico Marketplace + Nilvera/Foriba e-fatura
- **Turkish provider integrations** — KPS partner, GİB, e-fatura

**What this means for the POC:**
- Current Supabase Realtime container is **a placeholder** for development convenience. Production uses AppSync.
- ADR-0009 introduces **local EventBridge bidding** as the development analogue of the production EventBridge → Lambda pattern. LocalStack EventBridge will replace `pg_cron` usage even in dev.
- The RLS substrate (Postgres + `auth.*` helpers + 21 policies) is **unchanged** across all three phases. JWT claims come from Cognito instead of bcrypt seed, but the GUC pattern is identical.

---

## Three-pillar fusion + substrate seats — 2026-05-16 (third planning round)

The CEO context (competitive matrix, pricing matrix, 4-phase roadmap, prior ERD) drove substantial planning. Key decisions:

- **Strategic positioning** — Relowa is the only platform unifying Rubicon (operations) × Sensoneo (IoT) × Greyparrot (AI). Captured in the **5-layer architecture** in PRD-0004 (amended) and detailed in PRD-0010 (new).
- **Hybrid revenue model** — SaaS subscriptions + tier-driven commission. Replaces "transaction fees only." 3 segments × 3 tiers from CEO pricing matrix. PRD-0008 amended; ADR-0024 (new) specifies subscription billing.
- **`facilities` separate from `organizations`** — Enterprise tier promises multi-facility management; substrate enables it. PostGIS for geo queries. ADR-0025 (new).
- **`orders` separate from `tenders`** — Tender is the auction event; order is the persistent fulfillment record. Enables partial-win tenders (P2) and gives quality_inspection / delivery_proof a home. ADR-0026 (new).
- **VRP substrate seat** — `vehicles`, `driver_profiles`, `route_optimizations` schema in P1. `RouteEngine` adapter with `ManualRouteEngine` for P1; Google OR-Tools for P2. ADR-0027 (new).
- **IoT substrate seat** — `devices`, `device_telemetry`, `telemetry_aggregations` schema in P1. AWS IoT Core + MQTT + LPWAN. `DeviceProvider` adapter with `MockDeviceProvider`; Sensoneo/custom for P2. ADR-0028 (new).
- **Edge AI substrate seat** — `ai_inference_units`, `inference_jobs`, `inference_results` schema in P1. Edge GPU at conveyor belts. `EdgeAIProvider` adapter with `MockEdgeAI`; Greyparrot/self-hosted for P2-P3. ADR-0029 (new).
- **PRD-0010** — Phase 2/3/4 vision and roadmap with revenue lines, scale targets, anticipated future ADRs.
- **PRD-0004 amended** — 9 icon buckets organized into 5 architectural layers. IoT and AI promoted from "deferred" to "substrate-seat-reserved in P1."
- **PRD-0008 amended** — Pricing engine resolves schedule via subscription tier. Default schedules match CEO matrix (Producer 7→5→3%, Recycler 3→2→2%, Carrier 10→7→5%).
- **HANDOFF-EXECUTIVE-SUMMARY.md** rewritten — added strategic vision section, 5-layer architecture, hybrid revenue model, substrate-seats table, expanded DB inventory (25 tables), substrate-vs-implementation map.

**The discipline:** ~20 extra tables ship in Phase 1 substrate. Zero migration cliffs when Phases 2-4 light up. Schema commits before implementation lands.

## Operational layer — 2026-05-14 (second planning round)

The "0→1 launch" gaps are closed. Key choices:

- **Business model: transaction fees only** (PRD-0008). No subscriptions in P1. Default 1.5% + 1.5% split with ₺2500 cap per side on waste tenders; 1.5% capped at ₺1000 on carrier ads.
- **Pricing engine is structural** — tiered + split + per-tenant overrides + effective-date versioning. Customizable per-tenant by `super_admin`. Schema lands in M4 alongside escrow.
- **Provider strategy: adapter + ManualProvider deep spec now**; real-provider ADRs (0027 Iyzico, 0028 Nilvera, 0029 Greyparrot) deferred until sandbox access lands.
- **Three escrow disbursement branches** — producer / carrier / platform fan-out in Step Function `ReleaseFunds`. ADR-0007 amended.
- **Notifications multi-channel** — email (SES) + SMS (Netgsm) + Web Push (VAPID) + in-app. ~30 canonical templates. KVKK-compliant.
- **5 S3 buckets** with presigned URL uploads + ClamAV scan + Object Lock on audit/e-fatura (legal evidence + 10-year retention).
- **EU-resident observability** — Sentry EU + PostHog EU + CloudWatch. PII scrubbed at source.
- **DR commitment: RPO 15 min, RTO 4 hours** — quarterly restore drills required. Cross-region snapshots for audit + docs + e-fatura.
- **Solo on-call honesty in SLA** — published "best-effort solo" for P1, escalation triggers when paying-customer count crosses 10.
- **KVKK m.13 rights have operational flows** — each right named, owner assigned, SLA, response template.

## Agent team & test framework — 2026-05-14 (first planning round)

- **16-agent team** organized into 5 squads + 1 lead. Plan-then-execute orchestration. See ADR-0016 + `docs/agents/`.
  - Squads: Data & RLS (4), API & Workflow (3), Frontend & UI (4), Cross-cutting (3: tester, doc-keeper, compliance-specialist), DevOps (1: ci-cd-engineer).
- **Multi-runtime support**: skills are byte-identical in `.opencode/skills/` and `.claude/agents/`. CI gate via `pnpm agents:check`. See `docs/agents/sync-strategy.md`.
- **Required-reading lists** in every skill file ensure agents consult ADRs/PRDs before writing code.
- **Compliance specialist** auto-invoked on PII/money/audit/ESG triggers; writes a dated review note before merge.
- **Test framework** (ADR-0017): hybrid pyramid (bash + Vitest + Playwright), 16 categories with explicit owners.
- **Coverage policy**: no global gate; targeted thresholds on escrow Lambdas, idempotency middleware, auth middleware. Reasoning in ADR-0017 §4.
- **CI on GitHub Actions + AWS OIDC**. No Coolify. Deploy targets stay AWS-native. See `docs/runbook/ci-pipeline.md`.

## Architectural plan — 2026-05-13

A planning pass landed before any UI/API code. Key choices recorded:

- **9-bucket module taxonomy** (PRD-0004) maps the icon poster → frontend modules → backend services → Figma screens. Use it whenever a new screen lands.
- **Unified login** — one `/giris` page; post-login role selection at `/rol-secimi` for multi-org users (ADR-0005, ADR-0012).
- **Two-app frontend** — `apps/web` (operators, public) and `apps/admin` (staff, private). Same `packages/ui` (ADR-0012).
- **Admin tooling is fully isolated** — `admin.relowa.local` private DNS, VPN-gated, SAML via IAM Identity Center, separate DB role with BYPASSRLS, `admin_audit_log` with mandatory reason (ADR-0014, ADR-0015).
- **5-role staff RBAC** — super_admin, account_manager, support_agent, compliance_officer, financial_analyst. Schema commits in M1, panel UI in M6 (ADR-0014).
- **Carrier sub-auction** — second auction loop (recycler → carriers) planned and schema-committed in M1 even if UI slips to P2 (ADR-0010).
- **Map provider** is pluggable — MapLibre + OSRM for POC ($0), AWS Location for production routing/geocoding (ADR-0013).
- **AppSync via outbox** — env-flagged Supabase Realtime (dev) ↔ AppSync (prod). Transactional outbox keeps consistency (ADR-0006).
- **Escrow as Step Functions** — provider-agnostic adapter (Manual / Iyzico / PayTR), state machine with manual super_admin override (ADR-0007).
- **TR-first, EN-second** — Turkish routes, English everywhere else in code (PRD-0005).
- **Canonical brand color** — `#00E676`; sidebar `#0A2E1F` (ADR-0011).
- **Schema additions committed in M1** to avoid future migrations: `internal_staff`, `staff_org_assignments`, `admin_audit_log`, `carrier_ads`, `carrier_bids`, `shipments`, `shipment_events`, `outbox`, `escrow_orders`, `escrow_transactions`, `provider_webhooks`.

## Open decisions (to resolve before/during next session)

Three architectural calls flagged but not yet answered:

### 1. Hono vs NestJS for the API

- **Memo says NestJS** (enterprise, opinionated, dependency injection).
- **Pragmatic recommendation: Hono** — less boilerplate, first-class Zod + OpenAPI, Drizzle-friendly, faster for solo lead.
- **Decision needed before `apps/api/` is created.** The skill file `.opencode/skills/endpoint-writer.md` currently documents Hono conventions.

### 2. Step Functions scope

- **Escrow state machine in Step Functions:** consensus — yes (long-running, multi-provider, multi-day flows).
- **Auction lifecycle in Step Functions or DB + EventBridge Scheduler?** Recommendation: keep auction in DB state column + Scheduler (short-lived, simple). Step Functions for escrow only.
- ADR-0007 (planned) will codify this.

### 3. POC scope for AWS swap

Two paths:
- **(a) Aggressive:** rip out Supabase Realtime container now, wire LocalStack AppSync + Cognito, full AWS-native dev parity. Higher upfront cost (~1 week).
- **(b) Pragmatic:** keep current dev stack as a local-friendly approximation, build production AWS-native incrementally. Lower upfront cost, defer cognito/appsync wiring until first cloud deploy.

Recommendation: **(b)** — the RLS substrate is the load-bearing piece and it's identical either way. AppSync/Cognito wiring is mechanical when we deploy; doing it locally adds friction (LocalStack AppSync is Pro-tier) without proving anything new.

---

## Next session entry point

**The single most useful next step**, per ADR-0009 (Local Bidding Architecture):

### Phase 1: Hono API skeleton (1-2 hours)

```bash
cd ~/Desktop/Projects/relowa-poc

# Create the API package
mkdir -p apps/api/src/{routes,middleware,lib}
cd apps/api
pnpm init
```

Files to create (with the patterns documented in `.opencode/skills/endpoint-writer.md`):

1. **`apps/api/src/index.ts`** — Hono app bootstrap, port 3000
2. **`apps/api/src/middleware/auth.ts`** — JWT validation + `SET LOCAL request.jwt.claims` GUC (the bridge documented in `docs/memory/concepts/auth-uid-pattern.md`)
3. **`apps/api/src/middleware/idempotency.ts`** — `Idempotency-Key` header + `idempotency_keys` table replay
4. **`apps/api/src/middleware/events.ts`** — EventBridge publish wrapper (LocalStack endpoint from `.env`)
5. **`apps/api/src/routes/auth.ts`** — `POST /auth/login` (seed-data-aware: matches `users.email`, returns JWT with `sub`, `active_org_id`, `email` claims)
6. **`apps/api/src/routes/tenders.ts`** — `POST /tenders`, `PATCH /tenders/:id/publish`, `GET /tenders`, `GET /tenders/:id`
7. **`apps/api/src/routes/bids.ts`** — `POST /tenders/:id/bids`

Each mutation route follows the pattern:
```typescript
.post('/', zValidator('json', InputSchema), async (c) => {
  // ... validated input + JWT claims
  await db.transaction(async (tx) => {
    const [row] = await tx.insert(table).values(...).returning();
    await tx.insert(auditEvents).values({...});
    return row;
  });
  await publishEvent('tender.created', payload);
  return c.json(row, 201);
});
```

### Phase 2: EventBridge wiring (1 hour)

Create `scripts/setup-events.sh` that uses `awslocal` to provision in LocalStack:

```bash
awslocal events create-event-bus --name relowa-bus
awslocal events put-rule --name auction-close-tick \
  --schedule-expression 'rate(30 seconds)' \
  --event-bus-name relowa-bus
awslocal events put-rule --name on-bid-placed \
  --event-pattern '{"detail-type":["bid.placed"]}' \
  --event-bus-name relowa-bus
# ... + Lambda targets
```

### Phase 3: Auction close Lambda (1 hour)

`apps/lambdas/auction-close/index.ts`:
- Triggered every 30s by EventBridge Scheduler
- Query: `UPDATE tenders SET status='closing' WHERE status='published' AND closes_at < now() RETURNING *`
- For each closed: publish `tender.closing` event
- Soft-close handler (separate Lambda on `bid.placed`): extend `closes_at` by 60s if bid arrives in last 60s

### Phase 4: End-to-end integration test

`tests/bidding-flow.sh`:
1. Log in as Acme admin → get JWT
2. POST tender → 201
3. PATCH publish → status becomes `published`, event fires
4. Log in as EkoMetal admin → get JWT
5. GET /tenders → sees the published tender
6. POST bid → 201, event fires
7. Wait 60s, soft-close triggered, then wait `closes_at`, scheduler closes auction
8. Verify audit_events chain intact, no orphan idempotency keys, RLS still enforced

### Phase 5: Commit and update CHANGELOG

Commit message:
```
feat: hono api scaffold with eventbridge bidding loop

- apps/api/: Hono routes for tenders + bids, JWT-via-GUC middleware,
  idempotency middleware, eventbridge publish wrapper
- apps/lambdas/auction-close/: EventBridge Scheduler-triggered closer
- scripts/setup-events.sh: LocalStack EventBridge provisioning
- tests/bidding-flow.sh: end-to-end integration test (8 stages)

Implements ADR-0009.
```

Move the planned items in `CHANGELOG.md` `[Unreleased]` into a new `[0.2.0]` section dated when shipped.

---

## How to verify the POC is still healthy

Run these in order:

```bash
docker compose ps
# expect: all four services Up, postgres + localstack healthy

./tests/rls-isolation.sh
# expect: ✓ all 5 RLS scenarios passed

pnpm db:reset
# expect: 30-second rebuild, ends with seed summary

./tests/rls-isolation.sh
# expect: still 5/5 after reset
```

If any of these are red, **fix that before doing new work.** The substrate claim depends on them.

---

## Critical context for any next agent

- **Read `AGENTS.md` first.** It encodes the operating principles. The most important: Postgres is SoR, RLS is the boundary, audit is append-only, idempotency on every mutation, server-authoritative transitions.
- **The current Realtime container is provisional.** Don't build on it as if it were the production realtime layer. Production goes through AppSync (ADR-0009).
- **The original ADR-0002 (Supabase Realtime standalone)** is now historical. It documents a path we walked away from. Don't revert to it without explicit user direction.
- **Wikilinks throughout `docs/memory/`** assume Obsidian-compatible rendering. They render as plain text in other Markdown editors; that's intentional.
- **Skills are loadable, not auto-applied.** Paste the relevant skill file into context when starting role-specific work.
- **Tests are the contract.** `tests/rls-isolation.sh` failing is not a "we'll fix it later" issue — fix immediately.

---

## Key file inventory (don't delete these)

```
README.md                                  ← project entry
CHANGELOG.md                               ← user-maintained, current state in [Unreleased]
AGENTS.md                                  ← user-edited, encodes operating principles
HANDOFF.md                                 ← this file
docker-compose.yml                         ← infra topology, do not modify without ADR
.env / .env.example                        ← .env is git-ignored
docker/postgres/init.sql                   ← bootstrap (extensions, publication, replication role)
package.json + pnpm-workspace.yaml         ← workspace setup
packages/db/                               ← all DB logic; this is the load-bearing package
  src/schema.ts                            ← Drizzle schema
  src/migrations/0000_*.sql                ← Drizzle-generated (don't edit)
  src/migrations/0001_rls_helpers_*.sql    ← raw side-car, RLS lives here
  src/migrate.ts                           ← runner
  src/seed/index.ts                        ← idempotent seed
  drizzle.config.ts                        ← Drizzle Kit config
tests/rls-isolation.sh                     ← canonical regression
docs/adr/0001..0004, 0008, 0009            ← architecture decisions (no 0005, 0006, 0007 yet)
docs/prd/0001-vision.md, 0002-phase-1...   ← scope
docs/runbook/                              ← how-tos
docs/memory/_index.md + concepts/ + learned/  ← memory vault
docs/testing/strategy.md                   ← test strategy
.opencode/skills/                          ← agent specializations
```

**ADRs written 2026-05-13** (planning round before any UI/API code lands):
- `0005-cognito-authentication.md` — Cognito + API-signed session JWT
- `0006-outbox-pattern-for-appsync.md` — transactional outbox → AppSync, env-flagged for dev
- `0007-step-functions-escrow.md` — multi-day escrow state machine with provider adapter
- `0010-carrier-sub-auction.md` — recycler→carrier sub-auction (Logistics module)
- `0011-ui-kit-design-tokens.md` — canonical tokens, three-layer component model
- `0012-frontend-app-architecture.md` — `apps/web` + `apps/admin` split, Turkish routes
- `0013-map-provider-abstraction.md` — pluggable MapLibre / Mapbox / AWS Location
- `0014-internal-staff-rbac.md` — 5-role staff taxonomy, app-layer RBAC, dual-audit impersonation
- `0015-admin-tooling-isolation.md` — VPN + SAML + private DNS (`admin.relowa.local`)

**ADRs written 2026-05-14** (agent team + test framework):
- `0016-agent-team-and-orchestration.md` — 16-agent team, 5 squads + lead orchestrator, plan-then-execute, multi-runtime support (opencode + Claude Code)
- `0017-test-strategy.md` — hybrid pyramid, 16 test categories, targeted coverage thresholds on critical paths

**ADRs written 2026-05-14** (platform services — operational floor):
- `0018-notifications.md` — multi-channel (email/SMS/Web Push/in-app), ~30 templates, per-user preferences, EU-resident
- `0019-file-storage.md` — 5 S3 buckets with presigned URLs + ClamAV virus scan + Object Lock for legal evidence
- `0020-observability.md` — Sentry EU + PostHog EU + CloudWatch, 30-event analytics taxonomy, PII scrubbed at source
- `0021-backup-and-dr.md` — RPO 15min / RTO 4h, Multi-AZ + cross-region snapshots, quarterly restore drills
- `0022-rate-limiting-and-abuse.md` — AWS WAF + Redis sliding window, CAPTCHA escalation, bid manipulation defenses
- `0023-secrets-management.md` — Secrets Manager + KMS, 30+ secret inventory, rotation cadences, compromise runbooks

**ADR-0007 amended 2026-05-14** — `ReleaseFunds` Parallel state fans out into 3 branches (producer / carrier / platform) driven by the PRD-0008 pricing engine.

**PRDs written 2026-05-13:**
- `0004-module-map.md` — 9-bucket taxonomy, screen-to-module bridge
- `0005-i18n-and-content.md` — TR-first, EN second, Turkish routes / English code

**PRDs written 2026-05-14** (operational layer):
- `0006-provider-integration-specs.md` — Adapter interfaces + ManualProvider for escrow/e-fatura/AI scan (real-provider specs deferred to ADRs 0027–0029 after sandbox)
- `0007-operations-and-support.md` — SLA tiers, escalation, solo-on-call honesty, KVKK request flow, incident response, customer-facing comms
- `0008-pricing-engine.md` — Tiered + split + per-tenant override fee engine. Customizable per tenant via super_admin. Schema deferred to M4
- `0009-onboarding-and-verification.md` — 3-stage pipeline (registration → verification 24h SLA → activation + first-tender wizard), Çevre Lisansı + K1 first-class

**Frontend guides written 2026-05-13:**
- `docs/frontend/component-inventory.md` — every Figma screen → composition
- `docs/frontend/status-taxonomy.md` — canonical status codes across DB / audit / UI

**Agent team docs written 2026-05-14:**
- `docs/agents/README.md` — agent index + quick-pick decision tree
- `docs/agents/team-handbook.md` — feature-flow walkthroughs A–F
- `docs/agents/sync-strategy.md` — opencode ↔ Claude Code byte-identical duplication
- 16 skill files in `.opencode/skills/` (canonical) and `.claude/agents/` (mirror), drift-checked

**Test framework docs written 2026-05-14:**
- `docs/testing/conventions.md` — naming, factories, transaction rollback, assertions
- `docs/testing/categories/` × 15 — one doc per category with patterns and non-negotiables
- `tests/README.md` — local bootstrap, quick map, watch mode
- `docs/runbook/ci-pipeline.md` — GH Actions + AWS OIDC + deploy targets + recovery

**Master plan dashboard:** [`docs/_site/index.html`](docs/_site/index.html) — single source of truth for everything planned, now with Agents and Testing sections.

---

## Communication preferences carried over

From `AGENTS.md`:
- Prefers short, scannable replies with concrete steps
- Does not want code dumped without explanation
- Surface risks early > shipping fast and patching
- Turkish in conversation OK; Turkish or English in docs/code (pick one per file)
- Hard "no" on: silently skipping tests, magic constants without comments, `auth.uid()` in app code

---

## Final note for the next session

The POC is in an **excellent stopping point**. The substrate is proven, the documentation system is dense and self-referential, every architectural decision has either an ADR or a memory note backing it. The next step (`apps/api/`) has a clear blueprint in ADR-0009 and `.opencode/skills/endpoint-writer.md`.

If you're picking this up cold, the minimum reading list is:

1. This file (HANDOFF.md)
2. AGENTS.md
3. **`docs/HANDOFF-EXECUTIVE-SUMMARY.md`** — CTO-level overview with strategic vision + DB inventory + flows
4. **`docs/_site/index.html`** — master plan dashboard, links every ADR/PRD/skill/test category with status
5. PRD-0010 (Phase 2/3/4 vision — the 4-phase roadmap)
6. PRD-0004 amended (module map — 5-layer architecture)
7. PRD-0008 amended (pricing engine — hybrid SaaS + commission)
8. ADR-0024 (subscription tiers)
9. ADR-0025 + ADR-0026 (facilities + orders — the model changes)
10. ADR-0027 + ADR-0028 + ADR-0029 (substrate seats: VRP + IoT + Edge AI)
11. ADR-0016 (agent team — how work flows through the 16 agents)
12. ADR-0017 (test strategy)
13. ADR-0009 (tender auction)
14. ADR-0011 + ADR-0012 (UI kit + frontend architecture)
15. ADR-0014 + ADR-0015 (staff RBAC + admin isolation)
16. `docs/memory/concepts/auth-uid-pattern.md` (the load-bearing pattern)
17. `docs/agents/team-handbook.md` (worked feature flows)
18. `.opencode/skills/lead-orchestrator.md` (start every multi-step session here)

Total time: ~75 minutes. After that you have full context.

Good luck. Don't break the RLS tests.
