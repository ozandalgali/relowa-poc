---
skill: db-operator
purpose: Investigate Postgres performance, manage indexes, RDS parameters, extensions, partition strategy, connection pooling.
squad: data-rls
required_reading:
  - AGENTS.md
  - packages/db/src/schema.ts
  - docs/adr/0001-postgres-as-system-of-record.md
  - docs/runbook/rls-debugging.md
---

# Skill: db-operator

## When to invoke

- Query is slow; investigate with EXPLAIN.
- An index is missing or wrong.
- RDS parameter tuning (work_mem, effective_cache_size, etc.).
- Postgres extension decisions (TimescaleDB, pgvector, PostGIS, pg_partman, pg_cron).
- Partition strategy for large tables.
- Connection pool sizing (PgBouncer / RDS Proxy).
- VACUUM / autovacuum tuning.
- Read replica routing strategy.

**Do NOT invoke this skill for:** schema authoring (`migration-author`), application code, or RLS policy logic. This skill is for *operating* the data layer, not designing it.

## Required reading

- `AGENTS.md`
- `packages/db/src/schema.ts` — what tables exist and their column types
- `docs/adr/0001-postgres-as-system-of-record.md`
- The runbook for the specific issue if one exists
- Output of `\d+ <table>` for any table being investigated
- Output of `EXPLAIN (ANALYZE, BUFFERS) <query>` for the slow query
- `pg_stat_statements` extract for the top time consumers

## Inputs

- The slow query, or a description of the symptom.
- Production query stats if available (CloudWatch RDS metrics, pg_stat_statements).
- Current index list (`SELECT * FROM pg_indexes WHERE schemaname = 'public'`).

## Outputs

Depending on the task:

**For perf investigation:**

1. A diagnosis: what's slow, why (sequential scan, missing index, bad plan, bloated table, etc.).
2. A proposed fix (index, query rewrite, schema change, parameter tune).
3. A measurement: before/after EXPLAIN ANALYZE timings.
4. If the fix is a schema change → hand to `migration-author`.
5. If the fix is an index → write a side-car migration adding it (this skill *may* write a migration when the change is purely a perf index, not a schema change).
6. A `docs/memory/learned/` note documenting the issue and resolution.

**For RDS parameter changes:**

1. The proposed parameter group change.
2. The reasoning (workload type, current bottleneck).
3. The rollback procedure.
4. A pre-deploy / post-deploy benchmark.

**For partition strategy:**

1. Proposal in an ADR (or amendment to ADR-0001) if non-trivial.
2. Schema migration via `migration-author` after approval.

## Index hygiene

When proposing an index:

- Always check whether an existing index already covers (or *partially* covers) the predicate.
- Prefer composite indexes for predicates with stable column order.
- Use partial indexes (`WHERE status = 'published'`) when the workload skews to a fraction of rows.
- Use `INCLUDE` (covering indexes) for index-only scans on read-heavy queries.
- Reject "just add an index" when the real fix is denormalization, a materialized view, or a query rewrite.

## Non-negotiables

- ❌ **Never** add an index "just in case" without an EXPLAIN that justifies it. Index bloat is real.
- ❌ **Never** turn off autovacuum on a high-write table.
- ❌ **Never** raise `work_mem` globally to fix a one-off query — set it per session/transaction.
- ❌ **Never** ignore a sequential scan on a hot table without a documented reason.
- ✅ **Always** measure before and after. Numbers in the memory note.
- ✅ **Always** consider connection-pool effects of statement-level parameter changes.
- ✅ **Always** verify the change works under RLS context (`SET LOCAL request.jwt.claims = ...`), not as superuser.

## Verification

For index/parameter changes:

```bash
# Before
psql -c "EXPLAIN (ANALYZE, BUFFERS) <query>;" > before.txt

# Apply change

# After
psql -c "EXPLAIN (ANALYZE, BUFFERS) <query>;" > after.txt

# Compare
diff before.txt after.txt
```

For substrate health:

```bash
./tests/rls-isolation.sh   # must still pass
pnpm db:reset              # must still complete in <60s
```

## See also

- `.opencode/skills/migration-author.md` — for schema work
- `docs/runbook/rls-debugging.md`
- `docs/memory/learned/` — file new findings here
