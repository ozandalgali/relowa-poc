# Test category — API Integration

**Status:** 📋 P1, to build.
**Owner:** `tester` (paired with `endpoint-writer` on every endpoint shipped).
**Runner:** Vitest + real Postgres + real Hono.
**Location:** `tests/api-integration/`.

## Purpose

Verify end-to-end behavior of API endpoints with a real database, real RLS, real audit, real outbox. The "this endpoint actually works as a black box" layer.

## Test shape

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApiClient } from '../helpers/api-client';
import { createTender } from '../factories/tenders';
import { loginAs } from '../helpers/auth';
import { getTestDb } from '../helpers/db-test';

describe('POST /tenders/:id/publish', () => {
  it('transitions draft → published and emits tender.published event', async () => {
    // arrange
    const { token, orgId, userId } = await loginAs('acme-admin');
    const tender = await createTender({ forOrg: orgId, createdBy: userId, status: 'draft' });
    const api = createApiClient(token);

    // act
    const res = await api.patch(`/tenders/${tender.id}/publish`, {}, {
      headers: { 'Idempotency-Key': crypto.randomUUID() }
    });

    // assert
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('published');
    expect(res.body.publishedAt).toBeTruthy();

    // verify audit row
    const audit = await getTestDb().query.auditEvents.findFirst({
      where: (a, { eq, and }) => and(eq(a.action, 'tender.published'), eq(a.entityId, tender.id)),
    });
    expect(audit).toBeDefined();

    // verify outbox row
    const outbox = await getTestDb().query.outbox.findFirst({
      where: (o, { eq }) => eq(o.aggregateId, tender.id),
    });
    expect(outbox?.eventType).toBe('tender.published');
  });

  it('returns 409 when status is already published', async () => {
    // ...
  });

  it('rejects cross-tenant publish via RLS', async () => {
    // ...
  });

  it('replays the original response on idempotency-key match', async () => {
    // ...
  });

  it('returns 409 on idempotency-key match with different body', async () => {
    // ...
  });
});
```

## What every mutation endpoint test should assert

1. **Happy path** — correct response shape, status, body.
2. **State conflict** — 409 if state precondition violated.
3. **Cross-tenant** — actor from another org gets 404/403 via RLS.
4. **Role boundary** — wrong role within same org gets 403 via RLS.
5. **Audit row materialized** — same transaction.
6. **Outbox row materialized** — for events that should push to UI.
7. **Idempotency replay** — same key, same body → cached response.
8. **Idempotency conflict** — same key, different body → 409.
9. **Validation rejection** — Zod-failing body → 400.

For read endpoints, points 1, 3, 4 plus pagination & filter checks.

## Isolation

Tests run in transactions that roll back (see `tests/helpers/db-test.ts`). Each test sees seed data + its own factory-created data, and leaves no trace.

E2E tests (Playwright) don't roll back — they exercise the full system with real commits. That's a different category.

## Non-negotiables

- ❌ Never trust the JSON response alone. Verify the DB state (audit row, outbox row, state column).
- ❌ Never share state between tests. Use factories.
- ❌ Never `setTimeout` to wait for async outcomes — poll via the `waitFor` helper.
- ✅ Always include the idempotency replay test.
- ✅ Always include at least one cross-tenant negative case.

## See also

- `docs/testing/conventions.md`
- `tests/factories/`
- `.opencode/skills/endpoint-writer.md` (paired with the unit test)
- `.opencode/skills/tester.md`
