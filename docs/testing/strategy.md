# Test strategy

> What we test, how, and why. Three layers, plus a regression script.

## Layers

### Layer 1 — Database invariants (SQL-level)

These are the load-bearing tests. They run in plain `psql` against the running Postgres container, no application stack required.

**What we assert:**
- RLS enforces cross-tenant isolation (SELECT and INSERT)
- RLS enforces intra-org role boundaries (admin vs accounting vs operations)
- Audit hash chain produces deterministic, verifiable hashes
- Idempotency keys prevent duplicate side effects
- Triggers fire as expected (audit insert, updated_at)

**Where:**
- `tests/rls-isolation.sh` — substrate smoke test, runs in <5 seconds
- `tests/audit-chain.sh` — verifies hash chain integrity (Phase 1)
- `tests/idempotency.sh` — verifies key + hash matching (Phase 1)

### Layer 2 — API integration (HTTP-level)

Once Hono lands, every endpoint gets:

- Authorization positive case (correct role can do it)
- Authorization negative case (wrong role gets 403, cross-tenant gets 403/404)
- Idempotency replay (same key returns cached response)
- Idempotency key conflict (different body with same key returns 409)
- Schema validation (Zod rejects malformed input)

**Tooling:** Vitest + supertest-style HTTP calls against a running test server, fresh DB per test file.

### Layer 3 — End-to-end flow

Full lifecycle test:

1. Producer logs in
2. Producer posts a tender
3. Recycler subscribes via Realtime websocket
4. Recycler receives tender notification
5. Recycler bids
6. Producer sees bid via Realtime
7. Auction closes server-side
8. Audit chain verified intact
9. RLS still enforced

**Tooling:** Playwright running against a `pnpm db:reset && pnpm api:dev && pnpm web:dev` stack.

## What we do NOT test

- Third-party API behavior (Greyparrot, Iyzico, SES) — those have their own SLAs. Mock at the boundary.
- Specific UI pixel positions. Functional behavior, yes; visual regressions, no (until later).
- Performance at scale. Phase 1 is correctness-focused.

## Regression discipline

Every fix to a real bug includes a test that fails before the fix and passes after. This is non-negotiable. The `tests/` folder is the documentation of "things that have hurt us before."

## Running tests

```bash
# All tests, smoke level
./tests/rls-isolation.sh

# (When Vitest lands)
pnpm test:api

# (When Playwright lands)
pnpm test:e2e
```

## CI strategy (Phase 1)

GitHub Actions:
1. Spin up the same Docker Compose stack
2. Run migrations + seed
3. Run all three layers
4. Block merge on red

Time budget: <3 minutes per CI run. Anything slower goes into a nightly job, not PR gating.

## See also

- [[../memory/concepts/auth-uid-pattern]]
- [[../adr/0003-rls-with-jwt-guc-pattern]]
