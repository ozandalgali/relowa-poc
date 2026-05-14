---
skill: rls-test-runner
purpose: Verify RLS isolation across tenants and roles. Surface failures clearly.
squad: data-rls
required_reading:
  - AGENTS.md
  - tests/rls-isolation.sh
  - packages/db/src/seed/index.ts
  - docs/runbook/rls-debugging.md
  - docs/adr/0003-rls-with-jwt-guc-pattern.md
---

# Skill: rls-test-runner

## When to invoke

- After any schema change (auto-invoked after `migration-author`).
- After any RLS policy change.
- After any change to `auth.*` helper functions.
- Before declaring any DB-related task complete.
- As a periodic regression check in CI.

## Required reading

- `AGENTS.md`
- `tests/rls-isolation.sh` — the canonical smoke suite
- `packages/db/src/seed/index.ts` — seed data the tests rely on
- `docs/runbook/rls-debugging.md`
- `docs/adr/0003-rls-with-jwt-guc-pattern.md`
- For new tables: the relevant ADR (e.g. ADR-0010, ADR-0014)

## Inputs

- The schema change or RLS change being validated.
- The expected isolation invariants (read carefully from the ADR).

## Outputs

A clean run prints something like:

```
────────── TEST 1: Acme admin (Ahmet) — should see ALL 3 ──────────
3
────────── TEST 2: EkoMetal admin (Mehmet) — should see only PUBLISHED (2) ──────────
2
────────── TEST 3: Hızlı carrier (Kadir) — should see 0 ──────────
0
────────── TEST 4: Anonymous (no JWT) — should see 0 ──────────
0
────────── TEST 5: Cross-tenant INSERT — should FAIL ──────────
ERROR: new row violates row-level security policy for table "tenders"
✓ all 5 RLS scenarios passed
```

A failing run should clearly identify which scenario failed and produce a minimal SQL reproduction.

## Workflow

1. Ensure infra is up: `pnpm infra:up`.
2. Ensure seed is fresh: `pnpm db:seed` (or `pnpm db:reset` if schema also changed).
3. Run: `./tests/rls-isolation.sh`.
4. If output is unexpected:
   - Identify the failing scenario number.
   - Read `docs/runbook/rls-debugging.md` for that pattern.
   - Reproduce in `psql` directly:
     ```bash
     PGPASSWORD=dev_password_change_me psql -h localhost -p 5433 -U relowa -d relowa
     ```
     ```sql
     BEGIN;
     SET LOCAL ROLE app_user;
     SELECT set_config('request.jwt.claims', '{"sub":"...","active_org_id":"..."}', true);
     -- the offending query
     COMMIT;
     ```
5. **Do not** "fix" the test by relaxing assertions. The failing assertion is correct; the implementation is wrong. Fix the implementation.

## Non-negotiables

- ❌ **Never** modify the test to make it pass. The test encodes a security invariant.
- ❌ **Never** declare RLS work done with the test script red.
- ✅ **Always** add a new scenario to the test when adding new RLS policies.
- ✅ **Always** prefer reproducing in `psql` over guessing — it's the fastest diagnosis path.

## Common failure modes

| Symptom | Cause | See |
| --- | --- | --- |
| "infinite recursion detected" | Helper missing `SECURITY DEFINER` | `docs/memory/learned/rls-recursion-fix.md` |
| Producer admin sees 0 rows | JWT claims not set in transaction | `docs/runbook/rls-debugging.md` step 3 |
| Cross-tenant INSERT succeeds | Policy missing `WITH CHECK` (only `USING`) | Review policy |
| All queries return 0 | Querying as the owner role, RLS bypassed | `SET ROLE app_user` |
