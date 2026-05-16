# M2 Plan — Core API & Business Logic

> **Agent:** endpoint-writer, event-bridge-wiring, tester, doc-keeper
> **Squad:** API & Workflow per ADR-0016
> **Target:** Weeks 7-10 per PRD-0003

## Status

| Step | Status |
|------|--------|
| 1. Hono API scaffold (apps/api/) | 🔨 In progress |
| 2. JWT-via-GUC middleware | ⬜ Pending |
| 3. Idempotency middleware | ⬜ Pending |
| 4. Tender routes (POST/GET/PATCH) | ⬜ Pending |
| 5. Bid routes (POST /tenders/:id/bids) | ⬜ Pending |
| 6. Zod validation + OpenAPI spec | ⬜ Pending |
| 7. Docker Compose API service | ⬜ Pending |
| 8. Integration tests | ⬜ Pending |
| 9. Docs | ⬜ Pending |

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

## Manual steps

| # | When | Action |
|---|------|--------|
| 1 | After app scaffold | `pnpm install` to resolve new dependencies |
| 2 | After Dockerfile | `docker compose up -d api` to verify container starts |
