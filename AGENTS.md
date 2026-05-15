# AGENTS.md

> Per-session context for AI agents working on this repo (opencode, Claude Code, Cursor).
> Read this first. It's the bridge between sessions.

## Project

**Relowa POC** — architecture validation for a 4-month Phase 1 build of a B2B "Waste Operating System" for Turkey. The POC's job is to prove that a Plan B+ Realtime Hybrid stack delivers Supabase-grade DX without Supabase Cloud.

**Status:** RLS substrate validated. Hono API + EventBridge bidding system in planning — see ADR-0009.
**See:** [`README.md`](./README.md), [`CHANGELOG.md`](./CHANGELOG.md), [`docs/prd/`](./docs/prd/).

## Operating principles for agents in this repo

These are non-negotiable. Violate them and the architecture loses meaning.

### 1. Postgres is the system of record. Everything else is derived.

When in doubt where state should live, the answer is Postgres. S3 is for blobs and audit mirrors. EventBridge is a derived stream. Frontend caches are throwaway. **Never** invent a second source-of-truth without writing an ADR.

### 2. RLS is the security boundary, not the application.

Application code does not check authorization. RLS policies do. If you find yourself writing `if (user.orgId !== row.orgId) throw` in API code, **stop** — that check belongs in a policy.

When adding a new table:
1. Add the schema to `packages/db/src/schema.ts`.
2. Run `pnpm db:generate`.
3. **In the same migration set**, write a raw SQL side-car that:
   - `ALTER TABLE … ENABLE ROW LEVEL SECURITY;`
   - Adds at least one policy per `cmd` (SELECT, INSERT, UPDATE) — DELETE policy only if deletion is genuinely allowed for this table.
   - Adds the table to `RAW_SQL_FILES` in `packages/db/src/migrate.ts`.
4. **In the same PR**, add an RLS isolation test asserting cross-tenant separation.

### 3. The audit log is append-only.

`audit_events` has no UPDATE or DELETE policy. The hash chain detects tampering even at the SQL level. **Never** add an UPDATE / DELETE policy "just for migrations" — fix the migration instead.

### 4. Idempotency on every mutation.

Mutation endpoints accept `Idempotency-Key`. Replay returns cached response. Without this, escrow flows in Phase 2 will double-charge users. The discipline starts now.

### 5. Server-authoritative state transitions.

Auctions close because the **server** decided so, never because a client said "auction closed." Time-bound transitions run via EventBridge Scheduler → Lambda every 30s. Tender lifecycle: `DRAFT → PUBLISHED → CLOSING → WON`. Soft-close extends `closes_at` by 60s on late bids. Daily audit Merkle roots are anchored to Arbitrum One — see ADR-0008 and ADR-0009.

### 6. Boring technology preferred.

Postgres extensions, not new databases. SQL functions, not microservices. shadcn, not custom UI primitives. New tooling enters only with an ADR explaining what existing tool was insufficient.

## Layout map

| Path | What lives there | Edit when |
| --- | --- | --- |
| `packages/db/src/schema.ts` | Drizzle schema | Adding/changing tables |
| `packages/db/src/migrations/*.sql` | Drizzle-generated + raw SQL migrations | After `pnpm db:generate`, plus hand-written side-cars |
| `packages/db/src/migrate.ts` | Two-phase migration runner (Drizzle + raw side-cars) | When adding a side-car; register it in `RAW_SQL_FILES` |
| `packages/db/src/seed/index.ts` | Sample data | Adjusting fixtures |
| `apps/api/` | Hono backend (planned) | API endpoints, JWT middleware, business logic, EventBridge publish |
| `apps/lambdas/` | Auction close Lambda (planned) | Tender state transitions (published→closing→won) |
| `apps/web/` | Next.js frontend (later) | UI |
| `docs/adr/` | Architecture Decision Records | Any architecture-level decision |
| `docs/prd/` | Product / scope docs | Scope changes |
| `docs/runbook/` | Operational how-tos | Repeatable procedures |
| `docs/memory/` | Obsidian-style knowledge graph | Lessons learned, concept explainers |
| `docs/testing/` | Test strategy | Test approach changes |
| `.opencode/skills/` | Skill definitions for opencode | Reusable agent capabilities |
| `tests/` | Shell-based regression tests | Behavioral assertions |

## Workflow expectations

1. **Read before writing.** Before editing any file, glance at recent changes (`git log -p --max-count=5 <file>`) and check the relevant ADR / memory note.
2. **Document as you discover.** New gotcha → `docs/memory/learned/<slug>.md`. New decision → `docs/adr/NNNN-<slug>.md`.
3. **Update CHANGELOG** under `[Unreleased]` for every notable change before committing.
4. **Tests run green** before claiming a task done. `./tests/rls-isolation.sh` is the bare minimum smoke check.
5. **Commit messages**: imperative mood, one concept per commit. `feat(db): add audit hash chain trigger`, not `update stuff`.
6. **Manual steps must be documented.** Every plan (`docs/plans/`) MUST include a `## Manual steps` section listing every non-automated action the human needs to take, with the exact trigger condition (e.g. "After first terraform apply, set GitHub secret X"). The `doc-keeper` agent enforces this.

## Constraints to remember

- **macOS dev environment.** Homebrew Postgres 16 likely on `5432`; we use `5433`.
- **Postgres 18.** Mount `/var/lib/postgresql`, not `/var/lib/postgresql/data`.
- **Realtime `DB_ENC_KEY`** must be exactly 16 ASCII characters.
- **JWT GUC name**: `request.jwt.claims`. JSON-encoded. Set per-transaction with `set_config(..., true)`.
- **`auth.*` helpers** are `SECURITY DEFINER` to escape RLS recursion. Always include explicit `SET search_path = public, pg_temp`.
- **Connection string**: `postgres://relowa:dev_password_change_me@localhost:5433/relowa` (POC only).

## Hand-off questions to ask before changing scope

If a session is asking you to do work outside of these, **stop and confirm with the user**:

- Adding a new top-level dependency (new database, new managed service)
- Changing the auth model (e.g. switching from Better-Auth to Cognito)
- Modifying the RLS policy pattern (e.g. moving authorization to application layer)
- Skipping tests "because it's just a POC"
- Introducing client-side time-of-day logic for state transitions
- Adding GraphQL, gRPC, or any RPC system other than REST/Hono

These all have implications captured in ADRs. Don't quietly cross them.

## Useful one-liners for diagnostics

```bash
# Are all containers up?
docker compose ps

# Recent Postgres logs
docker compose logs postgres --tail=50

# Is Realtime really listening?
curl -I http://localhost:4000/api/tenants/realtime-dev/health

# What's the current RLS policy footprint?
PGPASSWORD=dev_password_change_me psql -h localhost -p 5433 -U relowa -d relowa \
  -c "SELECT tablename, count(*) FROM pg_policies WHERE schemaname = 'public' GROUP BY tablename;"

# Smoke test substrate
./tests/rls-isolation.sh
```

## Communication preferences for the human collaborator

- Prefers short, scannable replies with concrete steps.
- Does **not** want code dumped without explanation; explain trade-offs.
- Surfacing risks early > shipping fast and patching.
- Turkish in conversational replies is fine; Turkish or English in docs/code is fine — pick one per file and stick with it.
- Hard "no" on: silently skipping tests, magic constants without comments, using `auth.uid()` in application code (use Drizzle + RLS).
