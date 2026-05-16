# M3 Plan — Realtime Push + Background Workers

> **Agent:** endpoint-writer, event-bridge-wiring, state-machine-author, tester, doc-keeper
> **Squad:** API & Workflow per ADR-0016
> **Target:** Weeks 11-13 per PRD-0003

## Status

| Step | Status |
|------|--------|
| 1. Outbox publishing from route handlers | ⬜ Pending |
| 2. Auction close Lambda (t4g.nano, EventBridge scheduler every 30s) | ⬜ Pending |
| 3. EventBridge rules + Scheduler wiring | ⬜ Pending |
| 4. AppSync GraphQL schema (subscriptions) | ⬜ Pending |
| 5. Integration tests (bidding flow end-to-end) | ⬜ Pending |
| 6. Docs | ⬜ Pending |

## Dependency graph

```
[endpoint-writer: outbox] → [event-bridge-wiring: EventBridge rules]
                                                         ↓
                                             [auction close Lambda]
                                                         ↓
                                            [integration tests]
                                                         ↓
                                                   [docs]
```

## Architecture

### 1. Outbox publishing

Every mutation (POST /tenders, PATCH /tenders/:id/publish, POST /tenders/:id/bids) writes to `outbox` table inside the same transaction as the business write. This ensures transactional consistency — no "DB committed but event missed" scenarios.

```ts
// Inside the existing runInGucTx transaction
await tx.insert(schema.outbox).values({
  aggregateType: 'tender',
  aggregateId: tender.id,
  eventType: 'tender.created',
  orgId: claims.active_org_id,
  payload: tender,
});
```

Events published:
- `tender.created` — new tender created
- `tender.published` — tender moved to published
- `bid.placed` — new bid submitted

### 2. Auction close Lambda

A Lambda function (t4g.nano or equivalent) triggered by EventBridge Scheduler every 30 seconds. It checks for tenders where `status = 'published' AND closes_at <= now()` and transitions them to `closing` or `won`.

Soft-close logic: if a bid was placed in the last 60 seconds before `closes_at`, extend `closes_at` by 60 seconds. This prevents sniping.

```
Loop every 30s:
  1. SELECT tenders WHERE status = 'published' AND closes_at <= now()
  2. For each tender:
     a. Check if any bids were placed in last 60s
     b. If yes → UPDATE closes_at += 60s (soft-close)
     c. If no → find winner bid (highest pricePerTon)
     d. UPDATE tender: status='won', winner_bid_id=<winner>
     e. INSERT into outbox: event_type='tender.won'
```

### 3. EventBridge wiring

- **Rule:** `tender.created` → target: none (logged only, used by future notifications)
- **Rule:** `tender.published` → target: SQS → email notifier
- **Rule:** `bid.placed` → target: SQS → email notifier
- **Scheduler:** every 30s → target: auction close Lambda

All EventBridge config lives in scripts/setup-events.sh (for LocalStack dev).

### 4. AppSync schema

GraphQL SDL for subscriptions:

```graphql
type Subscription {
  onBidPlaced(tenderId: ID!): BidEvent @aws_subscribe(mutations: ["publishBidEvent"])
  onTenderUpdated(orgId: ID!): TenderEvent @aws_subscribe(mutations: ["publishTenderEvent"])
}
```

## Endpoints (new)

| Method | Path | Description |
|--------|------|-------------|
| GET | /tenders/:id/events | Last N events for replay-on-reconnect |

## Manual steps

| # | When | Action | Why |
|---|------|--------|-----|
| 1 | After Lambda code written | Create Lambda package + deploy checklist | Lambda needs zip/container, IAM role, env vars |
| 2 | After EventBridge wiring | Run `./scripts/setup-events.sh` against LocalStack | Dev parity with LocalStack EventBridge |

## Out of scope (M4+)

- SQS → Lambda workers (email, webhook) — M4
- AppSync deployment (real AWS) — M4
- S3 audit mirror daily job — M4
- Arbitrum One anchor Lambda — M4
