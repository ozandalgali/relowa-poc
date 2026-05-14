# Runbook — Local development

> Set up a working dev environment from a fresh clone. ~5 minutes.

## Prerequisites

- macOS or Linux. Windows untested.
- Docker Desktop (or compatible). Verified on Docker 29.x + Compose 2.40.x.
- Node 22+, pnpm 10+.
- (Optional) `psql` client for direct DB poking. macOS: `brew install libpq`.
- (Optional) TablePlus or DataGrip for a friendlier DB UI.

## First-time setup

```bash
git clone <repo>
cd relowa-poc
pnpm install
cp .env.example .env
pnpm infra:up
# wait ~10 seconds for healthchecks
pnpm db:migrate
pnpm db:seed
```

If everything went well:

```bash
./tests/rls-isolation.sh
# → ✓ all 5 RLS scenarios passed
```

## Daily workflow

```bash
# Start of the day
pnpm infra:up

# Make some schema changes in packages/db/src/schema.ts
pnpm db:generate
# Review the generated SQL in packages/db/src/migrations/
pnpm db:migrate

# Hack on apps/api or apps/web
pnpm api:dev       # in one terminal
pnpm web:dev       # in another (later, when web exists)

# End of the day
pnpm infra:down    # optional — leaving it running is fine, no data loss
```

## Resetting after schema chaos

```bash
pnpm db:reset
# tears down volumes, restarts containers, runs migrate + seed
# ~30 seconds
```

This is the nuke-from-orbit option. The seed script is idempotent (truncates first), so reseeding alone is also safe:

```bash
pnpm db:seed
```

## Inspecting the database

### Adminer (web)

<http://localhost:8080>

- System: PostgreSQL
- Server: `postgres`
- Username: `relowa`
- Password: `dev_password_change_me`
- Database: `relowa`

### `psql` (CLI)

```bash
PGPASSWORD=dev_password_change_me psql -h localhost -p 5433 -U relowa -d relowa
```

### Drizzle Studio (web, schema-aware)

```bash
pnpm db:studio
```

## When something fails

| Symptom | First check |
| --- | --- |
| `pnpm infra:up` hangs or fails | Docker Desktop running? Disk space? `docker system prune` if disk-pressed. |
| `password authentication failed` | Port 5432 collision with Homebrew Postgres → see [[../memory/learned/postgres-port-conflict]] |
| Postgres won't start, "unused mount/volume" | Postgres 18 layout → see [[../memory/learned/postgres-18-volume-mount]] |
| Realtime crash loops | `DB_ENC_KEY` wrong length → see [[../memory/learned/realtime-aes-key-length]] |
| RLS test prints "infinite recursion" | helper missing `SECURITY DEFINER` → see [[../memory/learned/rls-recursion-fix]] |
| LocalStack endpoint refuses connections | `docker compose logs localstack` and check container is healthy |

## Stopping cleanly

```bash
pnpm infra:down       # containers down, volumes preserved
docker compose down -v   # ⚠ wipes volumes too
```
