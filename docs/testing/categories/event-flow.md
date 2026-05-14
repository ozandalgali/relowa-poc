# Test category — Event Flow

**Status:** 📋 P1, to build.
**Owner:** `tester`.
**Runner:** Vitest + Postgres + LocalStack (EventBridge / SQS).
**Location:** `tests/event-flow/`.

## Purpose

Verify the outbox → relay → AppSync (or LocalStack proxy) path for every event type. Closes the loop on the realtime architecture (ADR-0006).

## Pipeline tested

```
Mutation in apps/api
    ↓ (same transaction)
INSERT INTO outbox
    ↓ (relay polls FOR UPDATE SKIP LOCKED)
SQS message
    ↓ (publisher Lambda)
AppSync mutation (prod) / mock receiver (dev)
    ↓
Subscriber receives event
```

## Test shape

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTender } from '../factories/tenders';
import { runRelayOnce } from '../helpers/relay';
import { collectAppSyncMessages } from '../helpers/appsync-mock';

describe('event flow: tender.published', () => {
  it('outbox row materializes within the same transaction', async () => {
    const tender = await createTender({ forOrg: 'acme', status: 'draft' });

    await publishTender(tender.id, {});

    const outbox = await db.query.outbox.findFirst({
      where: (o, { eq, and }) => and(eq(o.aggregateId, tender.id), eq(o.eventType, 'tender.published')),
    });
    expect(outbox).toBeDefined();
    expect(outbox?.publishedAt).toBeNull();   // relay hasn't run yet
  });

  it('relay marks outbox row published_at after processing', async () => {
    // arrange: insert outbox row manually
    // act
    await runRelayOnce();
    // assert
    const outbox = await db.query.outbox.findFirst({ ... });
    expect(outbox?.publishedAt).not.toBeNull();
  });

  it('AppSync mock receives the event payload with correct shape', async () => {
    await publishTender(tender.id, {});
    await runRelayOnce();

    const messages = await collectAppSyncMessages({ channel: `tender:${tender.id}` });
    expect(messages).toHaveLength(1);
    expect(messages[0].eventType).toBe('tender.published');
  });

  it('relay is idempotent — running twice does not duplicate', async () => {
    await publishTender(tender.id, {});
    await runRelayOnce();
    await runRelayOnce();
    const messages = await collectAppSyncMessages({ channel: `tender:${tender.id}` });
    expect(messages).toHaveLength(1);    // not 2
  });
});
```

## What this category covers

- Outbox INSERT lands in the same transaction as the business write.
- Relay polls + processes in order.
- Relay handles `SELECT ... FOR UPDATE SKIP LOCKED` correctly under parallel run.
- AppSync (or mock) receives the event.
- Idempotency: replay doesn't double-publish.
- Failure: AppSync 5xx → relay retries, eventually DLQs.

## What this category does NOT cover

- The actual AppSync subscription protocol (that's E2E).
- The UI re-rendering from subscription messages (that's frontend / E2E).
- Production EventBridge bus internals (those are AWS, not our code).

## Failure modes to test

- Outbox INSERT throws → mutation rolls back, outbox row never exists.
- AppSync 500 → relay retries; `attempts` increments; `last_error` populated.
- AppSync persistent failure → DLQ after N attempts; alarm fires (verified via Lambda log assertions).
- Concurrent relay instances → no double-publish, no skip.

## Non-negotiables

- ❌ Never test by relying on real AppSync in dev. Use the mock collector.
- ❌ Never use `setTimeout` to wait for relay completion — use `runRelayOnce()` synchronously or poll for `publishedAt`.
- ✅ Always assert the publisher's payload shape against the TypeScript type from `apps/api/src/events/types.ts`.

## See also

- ADR-0006 — Outbox pattern
- `.opencode/skills/event-bridge-wiring.md`
- `.opencode/skills/realtime-debugger.md`
