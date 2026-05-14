# ADR-0009 — Local EventBridge Bidding Architecture

**Status:** Accepted  
**Date:** 2026-05-11  
**Decision-makers:** Ozan (lead)

## Context

The Relowa platform's core business loop is a tender-auction cycle: producers post waste tenders, recyclers bid, and the server closes auctions on a fixed schedule with soft-close anti-sniping. This loop must:

1. **Run locally during development** — no AWS account required, no cloud dependency.
2. **Mirror the production architecture** — the same event-driven pattern (EventBridge → SQS → Lambda) used in production must be testable locally via LocalStack.
3. **Enforce server-authoritative state transitions** — no client ever triggers a tender close.
4. **Integrate with the existing RLS substrate** — the API never checks authorization; Postgres RLS policies handle cross-tenant isolation transparently.

## Decision

We adopt a **local-first, event-driven bidding architecture** with the following components:

### 1. Hono API (`apps/api/`)

A lightweight Hono backend providing REST endpoints for the core domain:

| Endpoint | RLS enforcement | Event published |
|---|---|---|
| `POST /tenders` | INSERT: own org + admin | `tender.created` |
| `PATCH /tenders/:id/publish` | UPDATE: own org + admin | `tender.published` |
| `GET /tenders` | SELECT: own org OR recycler + published/closing | — |
| `GET /tenders/:id` | SELECT: owner OR recycler if published | — |
| `POST /tenders/:id/bids` | INSERT: recycler org + admin/ops, tender is published | `bid.placed` |

All endpoints use Hono middleware:
- **`auth.ts`** — validates JWT, calls `SET LOCAL request.jwt.claims = '{...}'` on the Postgres session. RLS takes over from there.
- **`idempotency.ts`** — checks `Idempotency-Key` against `idempotency_keys` table, replays cached response on match, returns 409 on mismatch.

After each successful mutation, the route handler publishes a structured event to LocalStack EventBridge.

### 2. EventBridge (`scripts/setup-events.sh`)

A single shell script provisions the full local event infrastructure:

- **EventBus** `relowa-events`
- **Rules** for `tender.published`, `bid.placed`, `tender.won`, `tender.closing`
- **SQS queues** as targets for each rule
- **EventBridge Scheduler** `tender-close-check` — runs every 30 seconds, invokes `tender-close-handler` Lambda

### 3. Auction Close Lambda (`apps/lambdas/tender-close-handler/`)

A standalone TypeScript function invoked every 30s by EventBridge Scheduler:

```
Every 30s, runs a DB transaction:

1. published → closing:
   UPDATE tenders SET status = 'closing'
   WHERE status = 'published' AND closes_at < NOW()
   → publish tender.closing event for each

2. closing → won:
   For each tender WHERE status = 'closing'
     AND closes_at < NOW() - INTERVAL '60 seconds':
     - Find highest bid (ORDER BY price_per_ton DESC)
     - UPDATE status = 'won', winner_bid_id = winner.id, closed_at = NOW()
     - publish tender.won event
```

The 60-second buffer after `closes_at` implements the soft-close window: if a bid arrives within 60s of close, the auction extends. When no bids have arrived for 60 full seconds after `closes_at`, the auction is truly closed and the winner determined.

### 4. Soft-close on bid placement

In the same DB transaction as the bid INSERT:

```sql
UPDATE tenders
SET closes_at = GREATEST(closes_at, NOW() + INTERVAL '60 seconds')
WHERE id = $1
  AND status = 'published'
  AND closes_at - NOW() < INTERVAL '60 seconds';
```

This extends the auction deadline by 60s whenever a bid lands in the final 60 seconds — preventing last-second sniping.

### 5. LocalStack integration

All AWS service calls (EventBridge `PutEvents`, SQS, Lambda) point to `http://localstack:4566` via environment variable `AWS_ENDPOINT`. In production, the same code works against real AWS services — only the endpoint changes.

### 6. Integration test

`tests/bidding-flow.sh` exercises the full lifecycle:
1. Retrieve dev JWTs for each seed organization
2. Create tender as producer
3. Publish tender
4. Verify recycler sees it, carrier does not
5. Place bid as recycler
6. Verify bid appears in tender detail
7. Verify cross-tenant isolation (carrier sees no bids)
8. Verify audit hash chain integrity

## Consequences

### Positive

- **No cloud account needed for development.** Every piece runs in Docker: Postgres, LocalStack, API.
- **One-command startup:** `docker compose up -d && ./scripts/setup-events.sh`
- **Event-driven architecture is testable locally.** The same event bus, rules, and scheduler patterns that run in production are exercised in every integration test.
- **Hono is lightweight.** ~280 lines of route logic, ~100 lines of middleware/lib. No DI container, no decorator boilerplate. Functions + middleware chaining.
- **RLS is the sole authorization layer.** API code contains zero `if (user.orgId !== row.orgId)` checks. The JWT-via-GUC pattern makes Drizzle queries automatically tenant-scoped.
- **Audit trail is automatic.** Every mutation produces an `audit_events` row with SHA-256 hash chaining.

### Negative

- **LocalStack Scheduler→Lambda has bugs.** In LocalStack 3.7, the Scheduler's Lambda invocation is unreliable. Mitigation: the Lambda can also be invoked as a simple HTTP endpoint (`POST /internal/close-auctions`) that the scheduler hits.
- **JWT is dev-only HMAC.** Production will swap the `jwt.ts` helper for Cognito token verification. The middleware interface doesn't change — only the `verifyJwt()` implementation.
- **EventBridge events are fire-and-forget locally.** No dead-letter queue retry logic in local dev; production SQS→Lambda would handle retries.

## Alternatives considered

- **NestJS**: Rejected. Decorator-heavy, Angular-style DI adds ~50% more files and ~60% more code per endpoint. Not justified for a solo lead with 4-month timeline. See PR conversation.
- **Hono (confirmed)**: Chosen. Middleware pattern maps to RLS + idempotency cleanly. `@hono/zod-openapi` provides equivalent OpenAPI generation to NestJS `@nestjs/swagger` with less ceremony.
- **pg_cron for auction close**: Rejected for this architecture. EventBridge Scheduler + Lambda is the production pattern; using pg_cron locally would mean different code paths in dev vs prod. The Lambda pattern works in LocalStack and production identically.
- **Application-level authorization**: Rejected per ADR-0003. RLS is the security boundary.

## Reference

- ADR-0001: Postgres as system of record
- ADR-0003: RLS with the JWT-via-GUC pattern
- ADR-0008: Arbitrum One hash anchoring
- Design spec: `docs/figma/design-spec.md` (60-screen extraction)
- Milestones: `docs/prd/0003-phase1-milestones.md`
