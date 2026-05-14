# Postgres 18 volume mount

> Symptom: container refuses to start, complains about "PostgreSQL data in `/var/lib/postgresql/data` (unused mount/volume)".
> Root cause: Postgres 18 changed the on-disk directory layout to support `pg_upgrade --link`.

## What happened

Compose file inherited from a Postgres 16 setup mounted:

```yaml
volumes:
  - postgres_data:/var/lib/postgresql/data
```

After bumping to `postgres:18-alpine`, the container refused to start with:

```
Error: in 18+, these Docker images are configured to store database data
in a format which is compatible with "pg_ctlcluster" (specifically, using
major-version-specific directory names)...
The suggested container configuration for 18+ is to place a single mount
at /var/lib/postgresql which will then place PostgreSQL data in a
subdirectory, allowing usage of "pg_upgrade --link" without mount point
boundary issues.
```

## Why this happens

Postgres 18 introduced first-class support for in-place major version upgrades via `pg_upgrade --link`. To make that work, the data directory layout changed:

- Postgres 16: `/var/lib/postgresql/data/<all the files>`
- Postgres 18: `/var/lib/postgresql/18/docker/<all the files>`

When you mount at `/var/lib/postgresql/data`, you create a "boundary" that breaks the new layout's assumptions.

## The fix

Mount one directory higher:

```yaml
volumes:
  - postgres_data:/var/lib/postgresql
```

Postgres 18 will create `18/docker/` inside automatically. Future upgrades to 19 / 20 will be `pg_upgrade --link`-able from this layout.

## Caveat: existing data

If you had Postgres 16 data in the volume already (`/var/lib/postgresql/data/PG_VERSION` etc.) and switch to Postgres 18 with the new mount, Postgres 18 sees the old data and refuses to start.

For development, just nuke the volume:

```bash
docker compose down -v   # the -v removes named volumes
```

For production, use `pg_upgrade` or `pg_dump | pg_restore`. **Do not** simply nuke a production volume.

## How we encountered it

Followed the "switch to Postgres 18" instruction without checking the official image's CHANGELOG. The error message itself is helpful (rare for Postgres errors) and points to the right GitHub issue.

## See also

- [[postgres-port-conflict]] — the other Postgres setup gotcha
- [Official Postgres image PR #1259](https://github.com/docker-library/postgres/pull/1259) — describes the layout change
