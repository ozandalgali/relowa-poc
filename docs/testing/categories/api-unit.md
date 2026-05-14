# Test category — API Unit

**Status:** 📋 P1, to build.
**Owner:** The specialist who wrote the code (`endpoint-writer`, `state-machine-author`, etc.).
**Runner:** Vitest.
**Location:** Co-located with source (`*.test.ts` next to `*.ts`).

## Purpose

Verify single-unit behavior in isolation: a middleware, a service function, a route handler's logic stripped of HTTP plumbing, a parser, a validator. The fast feedback loop during implementation.

## Examples

- `apps/api/src/middleware/idempotency.test.ts` — feed the middleware different inputs, verify cache hits, mismatches, expiry.
- `apps/api/src/services/auction-close.test.ts` — given a tender state, verify the transition logic.
- `apps/lambdas/escrow-tasks/release-to-seller.test.ts` — verify Lambda handler logic with mocked provider.

## Test shape

```ts
import { describe, it, expect, vi } from 'vitest';
import { idempotencyMiddleware } from './idempotency';

describe('idempotency middleware', () => {
  it('returns cached response on key match with same body', async () => {
    // arrange
    const mockDb = createMockDb({
      existingKey: { key: 'abc', requestHash: 'h1', responseBody: { ok: true }, statusCode: 200 },
    });

    // act
    const result = await idempotencyMiddleware({ key: 'abc', body: { x: 1 }, db: mockDb });

    // assert
    expect(result.cached).toBe(true);
    expect(result.response).toEqual({ ok: true });
  });

  it('returns 409 on key match with different body hash', async () => {
    // ...
  });

  it('proceeds when no existing key', async () => {
    // ...
  });
});
```

## When unit, when integration

| Test target | Category |
|---|---|
| Pure function (no DB, no network) | Unit |
| Function that calls DB via Drizzle | Unit if Drizzle is mockable cheaply; otherwise integration |
| Middleware logic | Unit (with mocked next + context) |
| Route handler (HTTP request → response) | Integration (real Hono + real DB) |
| Full request → DB → audit → event flow | Integration |
| Lambda handler in isolation | Unit |
| Lambda invoked by Step Functions Local | Integration / state-machine |

## Coverage thresholds (ADR-0017)

Critical paths have hard gates:

- `apps/api/src/middleware/idempotency.ts` — 100% line + 100% branch
- `apps/api/src/middleware/auth.ts` — 100% line + 100% branch
- `apps/lambdas/escrow-tasks/**` — 100% line + 95% branch

Other unit tests report coverage but don't gate.

## Non-negotiables

- ❌ No DB calls in unit tests unless the module's whole point is DB. Mock at the Drizzle import boundary.
- ❌ No real network. Mock fetch, mock SDK clients.
- ❌ No `setTimeout` waits — use `vi.useFakeTimers()`.
- ✅ One assertion concept per test. If a test asserts five things, split.
- ✅ Test the failure modes, not just the happy path. Branch coverage forces this.

## See also

- `docs/testing/conventions.md`
- ADR-0017 §4 (coverage policy)
