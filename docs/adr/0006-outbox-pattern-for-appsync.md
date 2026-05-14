# ADR-0006 — Outbox Pattern for AppSync Subscriptions

**Status:** Accepted
**Date:** 2026-05-13
**Decision-makers:** Ozan (lead)

## Context

The POC uses **Supabase Realtime** standalone (ADR-0002, now historical) — a container that consumes Postgres logical replication (CDC) and broadcasts row changes to WebSocket subscribers. This works locally. Production has moved to AWS-native (HANDOFF "Phase C"), and the production realtime provider is **AppSync GraphQL subscriptions**.

AppSync does not consume Postgres CDC. It expects publishers to call `mutation` resolvers that emit subscription events. So we need a **bridge** between mutations and AppSync publishes that:

1. Stays **transactionally consistent** with the mutation — no "DB committed but subscriber missed it" or "subscriber notified but DB rolled back."
2. Has **at-least-once delivery** with a way to dedupe at the consumer.
3. Doesn't push WebSocket coupling into Hono route handlers (which already do auth, RLS GUC, idempotency, DB writes, and EventBridge publishes).
4. Survives AppSync transient errors without losing events.
5. Works in **dev** against Supabase Realtime container (per Q7: env-var flag) and in **prod** against AppSync, behind the same `useRealtimeChannel` hook.

The classic pattern for this is the **transactional outbox**. We adopt it.

## Decision

We adopt the **outbox pattern** with a Postgres trigger writing to an `outbox` table inside each mutation transaction, and a **relay worker** that ships outbox rows to AppSync (production) or to a no-op (dev, since Supabase Realtime handles CDC natively).

### 1. The outbox table

```sql
CREATE TABLE outbox (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type  text NOT NULL,           -- 'tender', 'bid', 'carrier_ad', 'shipment'
  aggregate_id    uuid NOT NULL,
  event_type      text NOT NULL,           -- 'tender.created', 'bid.placed', ...
  org_id          uuid,                    -- for fan-out scoping (null = global)
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,             -- relay sets this on successful publish
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text
);

CREATE INDEX outbox_unpublished_idx ON outbox(created_at)
  WHERE published_at IS NULL;
CREATE INDEX outbox_aggregate_idx ON outbox(aggregate_type, aggregate_id, created_at);
```

The partial index `outbox_unpublished_idx` keeps the relay's scan fast even as the table grows. Old published rows are archived to S3 monthly (audit-mirror job) and pruned from Postgres after 7 days.

### 2. Writing to the outbox

Every mutation that needs realtime push writes to `outbox` **inside the same transaction** as the business write:

```ts
// In a Hono route handler
await db.transaction(async (tx) => {
  const [tender] = await tx.insert(tenders).values({ ... }).returning();

  await tx.insert(auditEvents).values({ ... });

  await tx.insert(outbox).values({
    aggregate_type: 'tender',
    aggregate_id: tender.id,
    event_type: 'tender.published',
    org_id: tender.org_id,
    payload: serializeTender(tender),
  });

  return tender;
});
```

If anything in the transaction fails, the outbox row never exists. If the transaction commits, the outbox row is durably committed alongside the audit and business rows.

### 3. The relay worker

A standalone process that polls `outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 100` and publishes each row.

```
loop:
  rows = SELECT FROM outbox WHERE published_at IS NULL
         ORDER BY created_at LIMIT 100
         FOR UPDATE SKIP LOCKED          -- multi-relay safe
  for each row:
    try:
      publish_to_target(row)             // AppSync or Supabase Realtime no-op
      UPDATE outbox SET published_at = now(), attempts = attempts + 1
        WHERE id = row.id
    catch err:
      UPDATE outbox SET attempts = attempts + 1, last_error = err.message
        WHERE id = row.id
      if attempts > 10: send_alert(row)
  sleep 1s
```

`FOR UPDATE SKIP LOCKED` means we can run multiple relay instances safely; each picks a disjoint subset.

### 4. Publication targets and the env flag

```
REALTIME_BACKEND=supabase|appsync|none

dev (POC)              REALTIME_BACKEND=supabase
                       Relay runs as no-op (Supabase Realtime container
                       reads logical replication directly).

production (P1+)       REALTIME_BACKEND=appsync
                       Relay publishes each outbox row to AppSync
                       via Lambda → mutation resolver.

testing/CI             REALTIME_BACKEND=none
                       Relay disabled; tests inspect outbox table directly.
```

**Why a no-op in dev?** Supabase Realtime reads logical replication directly from Postgres — it doesn't need the outbox; the WAL is its outbox. Our consumer code (`useRealtimeChannel` hook) abstracts both. Keeping the outbox table populated even in dev means tests can assert "this mutation should emit X events" without needing a Realtime subscriber.

### 5. AppSync publish mechanics

The production relay publishes to AppSync by calling a Lambda that invokes AppSync's `mutation` resolver:

```
relay process → SQS (outbox-publish-queue) → Lambda → AppSync mutation
                                                        ↓
                                                  subscription event
                                                        ↓
                                                  WS clients
```

Why through SQS:
- Decouples relay from AppSync API quota and 5xx errors.
- Built-in retry, DLQ, exponential backoff.
- Lambda can batch (up to 10 events per invocation), reducing AppSync API calls.
- SQS message dedup ID = `outbox.id`, so duplicates are quashed at the queue level.

The Lambda is idempotent: if the AppSync mutation has already been published (checked by `outbox.id` in DynamoDB dedup table with 24h TTL), it's skipped. If publish succeeds, the Lambda calls back to the relay (or the relay observes the SQS success) and marks `published_at` in Postgres.

### 6. AppSync schema (extract)

```graphql
type TenderEvent {
  id: ID!
  event_type: String!
  aggregate_id: ID!
  payload: AWSJSON!
  org_id: ID
  created_at: AWSDateTime!
}

type Subscription {
  onTenderUpdated(tender_id: ID!): TenderEvent
    @aws_subscribe(mutations: ["publishTenderEvent"])
  onBidPlaced(tender_id: ID!): BidEvent
    @aws_subscribe(mutations: ["publishBidEvent"])
  onCarrierBidPlaced(carrier_ad_id: ID!): CarrierBidEvent
    @aws_subscribe(mutations: ["publishCarrierBidEvent"])
  onShipmentEvent(shipment_id: ID!): ShipmentEvent
    @aws_subscribe(mutations: ["publishShipmentEvent"])
  onAuditEvent(org_id: ID!): AuditEvent
    @aws_subscribe(mutations: ["publishAuditEvent"])
}
```

Subscribers authenticate via the API-signed JWT (ADR-0005) — AppSync uses the same Cognito + API JWT setup, with a resolver-level check that the subscriber's `org_id` claim matches the requested filter argument. Cross-tenant subscription is rejected at the AppSync resolver layer (defense-in-depth alongside outbox `org_id` filtering).

### 7. The frontend hook

```ts
const { events, status } = useRealtimeChannel({
  channel: `tender:${tenderId}:bids`,
  topic: 'bid.placed',
});
```

The hook's implementation switches by `REALTIME_BACKEND`:

- `supabase`: subscribes to Supabase Realtime channel for the table+filter.
- `appsync`: opens an AppSync GraphQL subscription with the matching mutation filter.
- `none`: returns empty events; useful in unit tests.

UI components never see the difference.

### 8. Ordering guarantees

Outbox rows are inserted in transaction-commit order. The relay processes in `created_at ASC` order. AppSync delivers in publish order to a single subscriber. Two practical implications:

- **Per-aggregate ordering is preserved.** A `bid.placed` for tender X always arrives before a `tender.won` for the same X.
- **Cross-aggregate ordering is NOT guaranteed.** Two bids on different tenders may interleave between subscribers in different orders. Acceptable; per-aggregate ordering is what matters for our flows.

### 9. Failure modes and replay

If the relay falls behind (e.g. AppSync outage for 30 min), outbox rows accumulate. When AppSync recovers, the relay drains in order. WebSocket subscribers who were connected during the outage **miss** the outage's events — AppSync subscriptions are at-most-once on delivery to a single connection. We mitigate by:

- Subscribers reconnecting on disconnect.
- On reconnect, subscribers fetch the last N events via REST (`GET /tenders/:id/events?since=`) and *then* re-subscribe. The REST endpoint reads from `outbox` (or a query over the actual aggregate tables).
- New events that arrived between fetch-completion and subscription-start are bridged by overlap window in the REST query.

This is the standard "reconnect-and-replay" pattern. Documented in the frontend implementation, not in the ADR scope.

## Consequences

### Positive

- **Transactional consistency:** never "committed but unannounced" or "announced but rolled back."
- **Backend-agnostic API:** the frontend hook hides Supabase vs AppSync vs none.
- **Replayable:** outbox is queryable; missed events can be reconstructed.
- **Multi-tenant safe:** `org_id` filtered at the relay and again at AppSync.
- **Testable:** unit tests inspect outbox without needing a WS subscriber.
- **No CDC required in production:** AppSync doesn't read Postgres logical replication, so we don't need Debezium / pg_replicate / similar.

### Negative

- **One more table** (`outbox`) on the hot mutation path. Insert cost is ~0.5ms; negligible compared to the audit insert that already runs.
- **Relay is a new long-running process** to monitor. Mitigated by running it as an ECS service with autoscaling and a CloudWatch alarm on `outbox` lag.
- **Two delivery paths in dev vs prod** (Supabase WAL vs outbox→AppSync). Outbox stays consistent in both, but the actual subscriber data path differs. Integration tests cover both via env switch.
- **AppSync per-million pricing** can surprise at scale. The cost model: ~$4/million subscription updates + $0.08/connection-minute. At 50–100 producers, ~1M events/month is ~$5/mo. Acceptable.

## Future plans

- **Single backend in P1+** — once AppSync is in production, drop Supabase Realtime container from the dev stack. Until then, the env switch supports both.
- **Per-org delivery preferences** — webhooks for enterprise tenants who want events pushed to their own systems. Relay grows a "deliver to org webhook URL" branch.
- **Outbox compaction** — for high-volume aggregates (a tender with 1000s of bids), collapse redundant events (only deliver the latest `tender.live_update`). Defer until volume justifies.
- **GrowthBook-style runtime flag** — per-org gradual rollout of AppSync vs Supabase Realtime during the cutover. Not needed if we cut over cleanly during a maintenance window; spec it if rollout requires per-tenant control.
- **Cross-region replication** — outbox replicates to a DR region's queue for disaster recovery of in-flight events. Phase 3.
- **Event archive in S3** — daily Glue job exports outbox rows to S3 Parquet, partitioned by date and aggregate_type. Enables historical analytics without hammering the production DB.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Direct AppSync publish from Hono route handlers | Couples mutation latency to AppSync availability. Lose transactional consistency: AppSync publish may succeed and DB rollback. |
| Postgres `LISTEN/NOTIFY` to a relay | Works in single-region small-scale but doesn't survive replica failover; payload size limited to 8KB; not a real production pattern. |
| Debezium / pg_replicate to Kinesis to AppSync | Adds two infrastructure components (Debezium operator + Kinesis stream) for the same result. Justify it when we need cross-database CDC, not just our own outbox. |
| AWS DMS for CDC | Same as Debezium criticism; managed but expensive ($0.50/hr base) and overkill for our event volume. |
| Skip realtime, polling only | UX regression vs. the live-bid demo. Polling at 5s intervals is expensive and feels stale. |
| Two outboxes (one for AppSync, one for EventBridge) | Confuses the audit story; events should have one canonical source. EventBridge is for inter-service workflow (bidding loop, ADR-0009), outbox is for UI push. Different consumers, different durability properties — keeping them separate is right. |

## Reference

- ADR-0001 — Postgres as system of record (outbox is just another derived stream)
- ADR-0002 — Supabase Realtime standalone (now historical; superseded for production by this ADR)
- ADR-0003 — RLS with JWT-GUC pattern (AppSync resolvers validate the same JWT)
- ADR-0005 — Cognito authentication (subscribers use the API-signed JWT)
- ADR-0009 — Local bidding architecture (EventBridge complements the outbox; different consumer surfaces)
- ADR-0010 — Carrier sub-auction (consumer of `onCarrierBidPlaced`, `onShipmentEvent`)
- AWS AppSync subscriptions: https://docs.aws.amazon.com/appsync/latest/devguide/real-time-data.html
