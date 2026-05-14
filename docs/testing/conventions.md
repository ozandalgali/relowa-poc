# Test Conventions

> Naming, file layout, factories, assertion style. Every category's specifics live in `docs/testing/categories/`.

**Authority:** ADR-0017.

## File layout

```
tests/
├── README.md                          # how to run each category locally
├── factories/                         # shared data factories
│   ├── orgs.ts
│   ├── users.ts
│   ├── tenders.ts
│   ├── bids.ts
│   ├── carrier-ads.ts
│   └── shipments.ts
├── helpers/                           # cross-test helpers (auth, JWT, idempotency keys, fetch wrapper)
├── fixtures/                          # static JSON / SQL fixtures for state-machine + contract tests
├── api-integration/                   # Vitest, full API+DB
├── event-flow/                        # Vitest, outbox→relay verification
├── state-machine/                     # Vitest + SFN Local
├── e2e/                               # Playwright critical paths
├── contract/                          # OpenAPI ↔ Hono diff
├── visual/                            # Playwright snapshots (P2)
├── perf/                              # k6 (P2)
├── rls-isolation.sh                   # bash substrate
├── migration-smoke.sh                 # bash substrate
├── audit-chain.sh                     # bash substrate
└── bidding-flow.sh                    # bash end-to-end auction
```

Unit tests are **co-located** with the source they test:

```
apps/api/src/middleware/idempotency.ts
apps/api/src/middleware/idempotency.test.ts        ← here, next to source

packages/ui/primitives/Button.tsx
packages/ui/primitives/Button.test.tsx              ← here
```

The rule: if the test is about *one* unit of code, it lives next to that code. If the test exercises multiple units across a boundary, it lives in `tests/<category>/`.

## File naming

| Pattern | Use |
|---|---|
| `<name>.test.ts` | Unit (Vitest), runs in `pnpm test` |
| `<name>.test.tsx` | Component unit (Vitest + React Testing Library) |
| `<name>.spec.ts` | E2E (Playwright); the `.spec.ts` suffix is what `playwright.config.ts` matches |
| `<name>.sql` | SQL-only test (run by bash via psql) |
| `<name>.sh` | Bash test script |

## Test name conventions

Test names describe the assertion, in present tense, in plain English.

```ts
// ✅
it('returns 409 when status is already published', ...)
it('rejects cross-tenant access via RLS', ...)
it('preserves audit chain across rollback', ...)

// ❌
it('test publish endpoint', ...)
it('should work', ...)
it('case 1', ...)
```

Describe blocks group by **subject**, not by **type of test**:

```ts
// ✅
describe('POST /tenders/:id/publish', () => {
  it('transitions draft → published');
  it('returns 409 when already published');
  it('rejects when caller is not org admin');
});

// ❌
describe('publish endpoint - happy path tests', () => { ... });
describe('publish endpoint - error cases', () => { ... });
```

## Factories

Every fixture is a typed function. Factories live in `tests/factories/`.

```ts
// tests/factories/tenders.ts
import { db, tenders } from '@relowa/db';
import type { TenderInsert } from '@relowa/db';

export async function createTender(opts: {
  forOrg: string;
  createdBy?: string;
  status?: TenderInsert['status'];
  overrides?: Partial<TenderInsert>;
}): Promise<TenderRow> {
  const defaults: TenderInsert = {
    orgId: opts.forOrg,
    createdByUserId: opts.createdBy ?? await createUserInOrg(opts.forOrg),
    materialType: 'plastic',
    quantityTons: '10.000',
    pickupRegion: 'Kocaeli',
    status: opts.status ?? 'draft',
  };

  const [tender] = await db.insert(tenders)
    .values({ ...defaults, ...opts.overrides })
    .returning();

  return tender;
}
```

Factory rules:

- **Sensible defaults** for every required column.
- **Override pattern** as the last argument for any per-test customization.
- **Auto-create dependencies** (a tender needs an org; the factory either accepts an `orgId` or creates one).
- **No magic values** — every default is a const or a deterministic generator (faker seeded with a fixed seed).
- **Idempotent within a transaction** — calling twice produces two rows; calling inside a rolled-back transaction leaves no trace.

Never copy-paste a 30-line fixture; if you find yourself doing so, add it to a factory.

## Transaction rollback for isolation

Vitest tests share the same database. Per-test isolation is achieved by wrapping each test in a transaction that rolls back:

```ts
// tests/helpers/db-test.ts
import { db } from '@relowa/db';
import { afterEach, beforeEach } from 'vitest';

let tx: Transaction | null = null;

beforeEach(async () => {
  tx = await db.transaction.begin();
});

afterEach(async () => {
  if (tx) await tx.rollback();
  tx = null;
});

export function getTestDb(): Transaction {
  if (!tx) throw new Error('test transaction not started');
  return tx;
}
```

Tests use `getTestDb()` instead of the bare `db` import. Any DB writes during the test live inside the transaction and disappear at teardown.

E2E tests don't use this pattern — they need real commits to drive the full system. Instead, E2E suites do a full `pnpm db:reset` before the suite and accept the slower setup.

## Assertions

Use Vitest's native `expect`. Prefer narrow assertions over deep object equality where possible.

```ts
// ✅
expect(response.status).toBe(201);
expect(response.body.id).toBeTypeOf('string');
expect(response.body.status).toBe('draft');

// ❌
expect(response.body).toEqual({
  id: expect.any(String),
  status: 'draft',
  createdAt: expect.any(String),
  updatedAt: expect.any(String),
  // ... 30 lines
});
```

Snapshot tests for components are fine; snapshot tests for API responses are usually a code smell (any field change cascades).

## Polling instead of sleeping

Asynchronous outcomes (event materializes, state-machine progresses, UI updates) must be **polled**, never `setTimeout`ed.

```ts
// ✅
import { waitFor } from './helpers/poll';

await waitFor(
  async () => (await db.query.outbox.findFirst({ where: ... })) !== undefined,
  { timeout: 5_000, interval: 100, message: 'outbox row never materialized' }
);

// ❌
await new Promise(r => setTimeout(r, 2000));
const row = await db.query.outbox.findFirst({ where: ... });
expect(row).toBeDefined();
```

The poll helper is in `tests/helpers/poll.ts`. It fails fast with a meaningful message if the condition never becomes true.

## Mocking philosophy

| Boundary | Mock? |
|---|---|
| Postgres | **No.** Use a real Postgres (the docker-compose one). |
| Cognito (in API integration tests) | **Yes**, via the `AUTH_MODE=dev` HMAC path. Cognito is reached only in E2E + production. |
| EventBridge / SQS / Lambda (in dev) | **Real**, via LocalStack. |
| AppSync (in dev) | Mocked behind the `useRealtimeChannel` flag. Real in E2E against deployed dev. |
| Iyzico / Nilvera / Greyparrot | **Mocked** via the provider adapter's `Manual` implementation. |
| S3 (when used) | LocalStack. |
| HTTP fetch to internal services | Use real service via docker-compose. |
| Date/time | Mocked with `vi.useFakeTimers()` when relevant. Always reset in `afterEach`. |

The rule: **mock the third party, run the rest real.** Mocking the DB or the event bus invalidates the test.

## Tags and CI gating

Tests can be tagged for selective runs:

```ts
it.concurrent('@critical happy-path tender flow', async () => { ... });
```

Tags:

- `@critical` — must pass on every PR (subset of E2E).
- `@slow` — exclude from PR CI; runs nightly.
- `@flaky` — known-flaky; quarantined while we fix.

`.github/workflows/e2e.yml` runs `--grep @critical` on PRs and the full suite nightly.

## Coverage configuration

Defined in `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['apps/**/src/**', 'packages/**/src/**'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/test/**', '**/fixtures/**'],
      thresholds: {
        // Critical paths — see ADR-0017 §4
        'apps/lambdas/escrow-tasks/**': { lines: 100, branches: 95 },
        'apps/api/src/middleware/idempotency.ts': { lines: 100, branches: 100 },
        'apps/api/src/middleware/auth.ts': { lines: 100, branches: 100 },
        // No global threshold by design — see ADR-0017
      },
    },
  },
});
```

The PR comment surfaces coverage delta but blocks only on threshold paths.

## Anti-patterns

- ❌ **Shared mutable state between tests.** Each test must work in any order, in isolation.
- ❌ **`it.only` / `describe.only` left in committed code.** A pre-commit hook catches this.
- ❌ **`.skip` without an issue link.** If it's skipped, there's a reason; document it.
- ❌ **`expect.assertions(N)` everywhere.** Only useful in async-callback tests; usually a smell.
- ❌ **Real network calls** to third-party services in CI.
- ❌ **Tests that pass when the assertion never runs** (forgot to `await`, callback never invoked). The poll helper has explicit `messages` to catch this.

## See also

- ADR-0017 — Test strategy (the canonical doc)
- `tests/README.md` — how to run each category locally
- `docs/testing/categories/<name>.md` — per-category patterns
- `docs/runbook/ci-pipeline.md` — where each category runs in CI
