# M2 Plan — Core API & Business Logic

> **Agent:** endpoint-writer, event-bridge-wiring, tester, doc-keeper
> **Squad:** API & Workflow per ADR-0016
> **Target:** Weeks 7-10 per PRD-0003

## Status

| Step | Status |
|------|--------|
| 1. Hono API scaffold (apps/api/) | 🔨 Done |
| 2. JWT-via-GUC middleware | ⬜ Done |
| 3. Idempotency middleware | ⬜ Done |
| 4. Tender routes (POST/GET/PATCH) | ⬜ Done |
| 5. Bid routes (POST /tenders/:id/bids) | ⬜ Done |
| 6. Zod validation + OpenAPI spec | ⬜ Done |
| 7. Docker Compose API service | ⬜ Done |
| 8. Integration tests | ⬜ Done |
| 9. Docs | ⬜ Done |

## Dependency graph

```
[api scaffold] → [JWT middleware] → [idempotency middleware]
                                        ↓
                                  [tender routes] ←→ [bid routes]
                                        ↓
                                  [zod + OpenAPI]
                                        ↓
                                  [docker service]
                                        ↓
                                  [tests + docs]
```

## Architecture

```
apps/api/
├── package.json
├── tsconfig.json
├── Dockerfile
└── src/
    ├── index.ts              # Hono app, route registration
    ├── client.ts             # Drizzle + Postgres.js client
    ├── middleware/
    │   ├── auth.ts           # JWT → GUC set_config
    │   └── idempotency.ts    # Idempotency-Key check + cache
    └── routes/
        ├── tenders.ts        # CRUD
        └── bids.ts           # Place bid
```

## Endpoints

| Method | Path | Auth | Idempotency | Description |
|--------|------|------|-------------|-------------|
| GET | /health | None | No | Health check |
| POST | /tenders | JWT | Yes | Create tender |
| GET | /tenders | JWT | No | List tenders (RLS-scoped) |
| GET | /tenders/:id | JWT | No | Tender detail |
| PATCH | /tenders/:id/publish | JWT | Yes | Publish tender |
| POST | /tenders/:id/bids | JWT | Yes | Place bid |
| GET | /tenders/:id/bids | JWT | No | List bids for tender |

## JWT flow

```
Client (dev: curl with HMAC-signed JWT)
  → Authorization: Bearer <jwt>
  → auth middleware verifies HMAC, extracts claims
  → SET LOCAL request.jwt.claims = <claims JSON>
  → SET LOCAL ROLE app_user
  → route handler runs Drizzle query (RLS applies transparently)
```
## 🔴 Manual steps (human action required)

| # | When | Action | Why |
|---|------|--------|-----|
| 1 | After app scaffold | `pnpm install` in repo root | Resolve new `apps/api/` dependencies (hono, drizzle-orm, zod, vitest) |
| 2 | Before local API dev | Kill SSH tunnel if active: `kill $(lsof -ti:5433)` — then start Docker stack: `docker compose up -d` | SSH tunnel intercepts port 5433, API needs Docker Postgres |
| 3 | Before API tests | Ensure Docker Postgres is healthy + seeded: `docker compose ps postgres`, `pnpm db:reset` | Tests need seed data |
| 4 | To test bid endpoints | Generate JWT: use `apps/api/src/__tests__/helpers.ts` signJwt, or run tests: `pnpm test` | JWT required for all /tenders endpoints |
