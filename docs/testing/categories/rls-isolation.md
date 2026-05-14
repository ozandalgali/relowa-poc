# Test category — RLS Isolation

**Status:** ✅ P1, exists today (5/5 passing).
**Owner:** `rls-test-runner`.
**Runner:** Bash + psql.
**Location:** `tests/rls-isolation.sh`.

## Purpose

Assert that RLS policies enforce cross-tenant isolation and intra-org role boundaries on every table that holds tenant data. This is the load-bearing substrate test. **If it goes red, all other claims are suspect.**

## What this category covers

- SELECT isolation: org A cannot see org B's rows.
- INSERT isolation: cross-tenant insert with `WITH CHECK` fails.
- UPDATE isolation: same.
- Role boundaries: `accounting` cannot do what `admin` can.
- Anonymous (no JWT GUC) sees zero rows on every protected table.

## What this category does NOT cover

- Application-layer permission checks — RLS is the only authorization layer (ADR-0003).
- API endpoint behavior — that's `api-integration`.
- Performance of policies under load — that's `perf` (P2).

## Test shape

Each scenario is a numbered block in `tests/rls-isolation.sh`:

```bash
echo "────────── TEST N: <description> — should <expected> ──────────"
PGPASSWORD=$PG_PASSWORD psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" <<EOF
BEGIN;
SET LOCAL ROLE app_user;
SELECT set_config('request.jwt.claims', '<JWT JSON for the actor>', true);
<the query under test>;
COMMIT;
EOF
```

The script asserts row counts via `grep -c` against the output.

## Adding scenarios for new tables

When `migration-author` adds a table with RLS policies, `rls-test-runner` extends this script with:

1. **One positive case per policy.** Actor allowed → expected rows.
2. **One negative case per policy.** Actor denied → 0 rows or error.
3. **A cross-tenant violation case.** Another org's user → 0 rows.
4. **An anonymous case.** No JWT GUC → 0 rows.

Don't add scenarios that overlap with existing ones. The script is a regression net, not exhaustive coverage.

## Running

```bash
pnpm infra:up          # ensure Postgres is up
pnpm db:reset          # fresh seed
./tests/rls-isolation.sh
```

Expected output:

```
────────── TEST 1: Acme admin (Ahmet) — should see ALL 3 ──────────
3
...
✓ all 5 RLS scenarios passed
```

## Failure modes

| Symptom | Likely cause | See |
|---|---|---|
| `infinite recursion detected in policy` | Helper missing `SECURITY DEFINER` | `docs/memory/learned/rls-recursion-fix.md` |
| Producer admin sees 0 rows | JWT claims not set in transaction | `docs/runbook/rls-debugging.md` |
| Cross-tenant INSERT succeeds | Policy has `USING` but no `WITH CHECK` | review policy |
| All queries return 0 | Querying as superuser, RLS bypassed | `SET LOCAL ROLE app_user;` |

## Non-negotiables

- ❌ Never weaken an assertion to make a test pass. The test encodes a security invariant; if it fails, the implementation is wrong.
- ❌ Never run as a superuser role (RLS is bypassed for `BYPASSRLS` roles).
- ✅ Every new table with tenant data gets new scenarios in the same PR.

## See also

- ADR-0003 — RLS with JWT-GUC pattern
- `.opencode/skills/rls-test-runner.md`
- `docs/runbook/rls-debugging.md`
