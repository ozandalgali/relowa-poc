# Test category — Migration Smoke

**Status:** 📋 P1, to build.
**Owner:** `migration-author` for smoke; `tester` for extensions.
**Runner:** Bash + psql.
**Location:** `tests/migration-smoke.sh`.

## Purpose

Assert that the full migration set applies cleanly to a fresh database and produces the expected schema state. This is the regression net for the migration runner itself.

## What this covers

- `pnpm db:reset` succeeds from an empty volume.
- Every Drizzle migration applies in order.
- Every raw SQL side-car applies in order (via `RAW_SQL_FILES` in `migrate.ts`).
- `_relowa_migrations` table records all side-cars.
- Re-running `pnpm db:migrate` after success is idempotent (no double-apply).
- Expected tables, enums, policies, triggers, and indexes exist post-migrate.

## What this does NOT cover

- Performance of migrations (slow migrations are a separate concern; P2).
- RLS behavior (`rls-isolation`).
- Audit-chain trigger correctness (`audit-chain`).

## Test shape

```bash
#!/usr/bin/env bash
set -euo pipefail

# Fresh DB
docker compose down -v
docker compose up -d postgres
wait_for_pg

# Apply
pnpm db:migrate

# Assert expected schema
PGPASSWORD=$PG_PASSWORD psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" <<EOF
\d+ tenders
\d+ audit_events
SELECT count(*) FROM pg_policies WHERE schemaname='public';   -- expected: 21+
SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime';
EOF

# Idempotency check
pnpm db:migrate  # second run, should be a no-op

echo "✓ migration smoke passed"
```

## Adding assertions

When `migration-author` introduces:

- A new table → assert the table + its policies count.
- A new trigger → assert the trigger by name on the table.
- A new extension → assert via `\dx` or `pg_available_extensions`.

Keep the assertions cheap and readable; this is smoke, not exhaustive.

## Running

```bash
./tests/migration-smoke.sh
```

Runs in <30s on a fresh machine. Slower than RLS isolation because it tears down and rebuilds the volume.

## Non-negotiables

- ❌ Never edit a previously-applied migration. Write a new one.
- ❌ Never make a migration that's not idempotent on the second run.
- ✅ Always verify the side-car is registered in `RAW_SQL_FILES`.

## See also

- `.opencode/skills/migration-author.md`
- `packages/db/src/migrate.ts`
