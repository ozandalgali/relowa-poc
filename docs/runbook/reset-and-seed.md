# Runbook — Reset and seed

> When you've made a mess and want to start fresh.

## The full nuke

```bash
pnpm db:reset
```

This composes three operations:

1. `docker compose down -v` — stop containers, **delete volumes**
2. `docker compose up -d` — fresh containers, fresh data dirs
3. `sleep 10` — wait for healthchecks
4. `pnpm db:migrate` — Drizzle migrations + raw SQL side-cars
5. `pnpm db:seed` — sample data

End state: containers healthy, schema applied, 3 orgs × 5 users × 3 tenders. Same baseline as a fresh clone after `infra:up + db:migrate + db:seed`.

## Reseeding without nuking

If schema is fine but data is messy:

```bash
pnpm db:seed
```

The seed script is **idempotent** — it `DELETE`s existing rows from `bids`, `tenders`, `org_members`, `organizations`, `users` first, then re-inserts.

Note: `audit_events` is **never** truncated by the seed script. Its append-only invariant is sacred. Even seed runs append rather than wipe.

## When to reset

| Situation | Action |
| --- | --- |
| Editing a migration file (changing what it does) | `pnpm db:reset` — Drizzle journal won't rerun applied migrations otherwise |
| Schema looks corrupted | `pnpm db:reset` |
| You want fresh test data | `pnpm db:seed` |
| RLS policies not applying | `pnpm db:reset` to ensure side-car SQL ran with latest content |
| Container won't start at all | `docker compose down -v` then `docker compose up -d` |

## When **not** to reset

- In production. Obviously.
- When you have local data you want to keep. (There's no "preserve only specific tables" path — write a query and `pg_dump` what you want first.)

## Recovering specific tables

```bash
# dump just the tenders table from current state
PGPASSWORD=dev_password_change_me pg_dump \
  -h localhost -p 5433 -U relowa \
  --table=tenders --data-only \
  > /tmp/tenders-backup.sql

# do the reset
pnpm db:reset

# restore
PGPASSWORD=dev_password_change_me psql \
  -h localhost -p 5433 -U relowa -d relowa \
  -f /tmp/tenders-backup.sql
```

## See also

- [[local-development]]
- [[../memory/concepts/audit-hash-chain]] — why audit_events isn't reset
