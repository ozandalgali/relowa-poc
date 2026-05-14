# Relowa POC

> Architecture validation for Relowa — a B2B "Waste Operating System" for Turkey.
>
> This repo proves that a **Plan B+ Realtime Hybrid stack** delivers Supabase's developer experience without Supabase Cloud, on top of fully self-controlled infrastructure (RDS-style Postgres + standalone Supabase Realtime container + Drizzle + Hono + LocalStack-mocked AWS).

**Status:** RLS proof validated end-to-end · Hono API + Next.js UI in progress
**License:** Private
**Dev environment:** macOS (verified) · Linux should work · Windows untested
**Required tools:** Docker Desktop · pnpm 10+ · Node 22+ · `psql` (optional, for direct DB poking)

---

## Why this POC exists

Relowa is committing to a 4-month Phase 1 build. Before doing so, we need to **de-risk one architectural question with a concrete answer**:

> Can we get Supabase-Cloud-grade developer experience (RLS, Realtime, Auth, Storage) **without** the full Supabase stack — by combining best-of-breed pieces (Drizzle + Hono + Better-Auth + standalone Realtime container)?

This POC's deliverable is not a product. It's a **yes/no decision support artifact**, with the working code that makes the answer believable.

The first proof point (RLS isolation across tenants) is **already passing**. See [Verification](#verification).

---

## Architecture in one breath

```
Browser (Next.js PWA)
        ↓ HTTPS + WebSocket
Hono API (Fargate-target, Node)
        ↓ JWT claims set as Postgres GUC ('request.jwt.claims')
Postgres 18 (RDS-target)
        ├── 7 RLS-protected tables (multi-tenant)
        ├── auth.* helper functions (uid, org_id, has_role, ...)
        ├── audit_events with hash chain (tamper-evident)
        ├── pg_cron for scheduled jobs (Phase 1+)
        └── logical replication → Supabase Realtime container → WebSocket
S3 + EventBridge + SES + Lambda
        all mocked locally via LocalStack; production swaps endpoint env var.
```

Two principles that drive everything:

1. **Postgres is the system of record.** Everything else is derived data. (DDIA Ch. 12)
2. **RLS is the security boundary, not the application.** Application bugs cannot escape RLS. (Postgres invariant)

---

## Quick start

```bash
# 1. Clone, install deps
git clone <this repo>
cd relowa-poc
pnpm install

# 2. Configure env
cp .env.example .env

# 3. Bring up infrastructure
pnpm infra:up         # docker compose up -d
# wait ~10 seconds for Postgres healthcheck

# 4. Migrate + seed
pnpm db:migrate       # drizzle-generated SQL + raw RLS migrations
pnpm db:seed          # 3 fake orgs, 5 users, 3 tenders

# 5. Verify everything works
./tests/rls-isolation.sh
```

If the RLS test passes, you have a working substrate. **The architectural question is answered "yes."**

---

## What's running

| Component | Port | Image | Purpose |
| --- | --- | --- | --- |
| Postgres 18 | `5433` | `postgres:18-alpine` | System of record. RLS-protected. |
| Supabase Realtime | `4000` | `supabase/realtime:v2.30.34` | Standalone — only Supabase piece used. |
| LocalStack | `4566` | `localstack/localstack:3.7` | Mocks S3, EventBridge, Lambda, SES, SQS, Secrets Manager. |
| Adminer | `8080` | `adminer:latest` | Web UI for poking at Postgres. |

**Why port `5433` for Postgres**: many dev machines have Homebrew `postgresql@16` on `5432`. Avoiding the collision saves 30 minutes of confused debugging. See `docs/memory/learned/postgres-port-conflict.md`.

---

## What's been proven so far

| Capability | How it's proven | Where |
| --- | --- | --- |
| Multi-tenant org/user/role model | Schema in Drizzle + seed creates 3 orgs × 5 users × 5 memberships | `packages/db/src/schema.ts` |
| RLS using JWT claims | `auth.uid()`, `auth.org_id()`, `auth.has_role()`, `auth.user_org_ids()` helpers | `packages/db/src/migrations/0001_rls_helpers_and_policies.sql` |
| Cross-tenant SELECT isolation | Producer admin sees own 3 tenders; recycler sees only 2 published; carrier sees 0; anon sees 0 | `tests/rls-isolation.sh` |
| Cross-tenant INSERT rejection | Acme admin trying to insert into EkoMetal's org → `new row violates row-level security policy` | same |
| Audit hash chain | `compute_audit_hash` trigger links every audit row to the previous via SHA-256 | migration file |
| Realtime via logical replication | `supabase_realtime` publication includes `tenders`, `bids`, `audit_events` | migration file |
| Idempotent reset/seed | `pnpm db:reset` tears everything down and rebuilds in ~30 seconds | `package.json` |

---

## Repository layout

```
relowa-poc/
├── apps/
│   ├── api/                    Hono backend (in progress)
│   └── web/                    Next.js frontend (later)
├── packages/
│   └── db/                     Drizzle schema, migrations, seed, RLS policies
├── docker/postgres/init.sql    Bootstrap publication + extensions on first boot
├── docs/
│   ├── prd/                    Product requirement docs
│   ├── adr/                    Architecture Decision Records
│   ├── runbook/                Operational how-tos
│   ├── memory/                 Obsidian-style knowledge graph
│   └── testing/                Test strategy
├── .opencode/skills/           Reusable skill files for opencode
├── tests/                      Shell-based regression tests
├── docker-compose.yml          Infra topology
├── AGENTS.md                   Per-session context for AI agents
├── CHANGELOG.md                Project changelog
└── README.md                   You are here
```

---

## Verification

### Smoke test — does the substrate work?

```bash
./tests/rls-isolation.sh
```

Expected output ends with:

```
✓ all 5 RLS scenarios passed
✓ substrate is sound — Plan B+ Realtime Hybrid stack validated
```

### Direct DB inspection

```bash
PGPASSWORD=dev_password_change_me psql -h localhost -p 5433 -U relowa -d relowa
```

Useful queries:

```sql
-- All RLS policies
SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename;

-- All auth helpers
SELECT n.nspname || '.' || p.proname || '() → ' || pg_get_function_result(p.oid)
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'auth';

-- Tables in the realtime publication
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

-- Audit hash chain (after some activity)
SELECT id, action, prev_hash, hash, created_at FROM audit_events ORDER BY created_at;
```

### Adminer UI

Open <http://localhost:8080>:

* System: PostgreSQL
* Server: `postgres`
* Username: `relowa`
* Password: `dev_password_change_me`
* Database: `relowa`

---

## Common operations

| Command | Effect |
| --- | --- |
| `pnpm infra:up` | Start all containers in background. |
| `pnpm infra:down` | Stop containers (volumes preserved). |
| `pnpm infra:logs` | Tail logs from all services. |
| `pnpm db:generate` | Generate a new Drizzle migration from `schema.ts` changes. |
| `pnpm db:migrate` | Apply pending migrations (Drizzle + raw SQL side-cars). |
| `pnpm db:seed` | Repopulate sample data. **Truncates first.** |
| `pnpm db:reset` | Nuke volumes, restart, migrate, seed. ~30 seconds. |
| `pnpm db:studio` | Open Drizzle Studio (web UI for the schema). |

---

## What's next

The substrate is proven. Remaining POC scope:

1. **Hono API layer** with JWT middleware that writes claims to GUC — proves the round-trip from HTTP request to RLS-filtered query.
2. **Realtime client demo** — Next.js page subscribing via `@supabase/realtime-js` to `tenders`, observing live inserts.
3. **Idempotency middleware** — every mutation accepts `Idempotency-Key`, replays first response on duplicate.
4. **Auction lifecycle scheduler** — `pg_cron` job transitions PUBLISHED → CLOSING when `closes_at` hits.
5. **End-to-end integration test** — single shell script that exercises producer login → tender create → recycler websocket sees it → bid → close → audit chain intact.

See [`CHANGELOG.md`](./CHANGELOG.md) for what's done, [`docs/prd/0002-phase-1-scope.md`](./docs/prd/0002-phase-1-scope.md) for what's planned.

---

## For AI agents

This repo is built collaboratively with opencode + Claude. See [`AGENTS.md`](./AGENTS.md) for per-session context, and `.opencode/skills/` for reusable skill definitions. The memory system in `docs/memory/` is intended to be browsed by both humans and agents.
