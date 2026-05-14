# tests/

> How to run tests locally. The strategy is in ADR-0017; this file is the bootstrap.

## Quick map

| Layer | Tool | Where | Run |
|---|---|---|---|
| Unit | Vitest | Co-located `*.test.ts` next to source | `pnpm test` |
| RLS isolation | bash + psql | `tests/rls-isolation.sh` | `./tests/rls-isolation.sh` |
| Migration smoke | bash + psql | `tests/migration-smoke.sh` | `./tests/migration-smoke.sh` |
| Audit chain | bash + psql | `tests/audit-chain.sh` | `./tests/audit-chain.sh` |
| API integration | Vitest | `tests/api-integration/` | `pnpm test:integration` |
| Event flow | Vitest | `tests/event-flow/` | `pnpm test:events` |
| State machine | Vitest + SFN Local | `tests/state-machine/` | `pnpm test:sfn` |
| Auction lifecycle | bash | `tests/bidding-flow.sh` | `./tests/bidding-flow.sh` |
| Frontend component | Vitest + RTL + axe | Co-located `*.test.tsx` | `pnpm test:web` |
| E2E (critical) | Playwright | `tests/e2e/` | `pnpm test:e2e -- --grep @critical` |
| E2E (full) | Playwright | `tests/e2e/` | `pnpm test:e2e` |
| Contract | Vitest | `tests/contract/` | `pnpm test:contract` |
| Visual regression | Playwright snapshot | `tests/visual/` (P2) | `pnpm test:visual` |
| Performance | k6 | `tests/perf/` (P2) | `k6 run tests/perf/<scenario>.k6.ts` |
| Security | OWASP ZAP, gitleaks, pnpm audit | CI workflows | runs in CI |
| i18n / a11y | ESLint + axe | inline in component tests | `pnpm lint` + `pnpm test` |
| Compliance | manual checklist | `docs/compliance/reviews/` | reviewed by `compliance-specialist` |

## Prerequisites

```bash
# 1. Docker compose up (Postgres, Realtime, LocalStack, Adminer)
pnpm infra:up

# 2. Fresh DB
pnpm db:reset

# 3. (Optional) Provision EventBridge in LocalStack for event-flow / auction tests
./scripts/setup-events.sh
```

## Running everything (full local test pass)

```bash
# Substrate first — fail fast on the load-bearing layer
./tests/rls-isolation.sh
./tests/migration-smoke.sh
./tests/audit-chain.sh

# Then the TS suite
pnpm test                  # unit
pnpm test:integration      # api-integration + event-flow + state-machine
pnpm test:contract

# Then the lifecycle
./tests/bidding-flow.sh

# Then E2E critical
pnpm test:e2e -- --grep @critical
```

Expected total time: < 6 minutes on a current MacBook.

## Watch mode (during development)

```bash
pnpm test -- --watch              # unit
pnpm test:web -- --watch          # frontend component
```

## Coverage

```bash
pnpm test --coverage
open coverage/index.html
```

Coverage **thresholds** gate only the critical paths (ADR-0017 §4):

- `apps/lambdas/escrow-tasks/**` — 100% line + 95% branch
- `apps/api/src/middleware/idempotency.ts` — 100% line + 100% branch
- `apps/api/src/middleware/auth.ts` — 100% line + 100% branch

Other files report coverage but don't block.

## Folder structure

```
tests/
├── README.md                 ← this file
├── factories/                ← typed data factories
├── helpers/                  ← auth helper, API client, poll, db-test
├── fixtures/                 ← static JSON / SQL fixtures
├── api-integration/          ← Vitest (real Postgres + Hono)
├── event-flow/               ← Vitest (outbox → relay → mock receiver)
├── state-machine/            ← Vitest + Step Functions Local
├── e2e/                      ← Playwright critical + full flows
├── contract/                 ← OpenAPI ↔ Hono spec diff
├── visual/                   ← Playwright snapshot diff (P2)
├── perf/                     ← k6 (P2)
├── rls-isolation.sh          ← canonical regression
├── migration-smoke.sh
├── audit-chain.sh
└── bidding-flow.sh           ← canonical auction E2E (bash)
```

## When tests fail

1. **Read the failure message.** Our tests have descriptive names per `conventions.md`; the message tells you the invariant violated.
2. **Reproduce locally** before fixing in CI.
3. **Never relax an assertion to make a test green.** The assertion is the spec.
4. **If RLS isolation fails:** see `docs/runbook/rls-debugging.md` and `docs/memory/learned/`.
5. **If audit chain fails:** treat as a security incident; do not auto-recover.

## When to write what (cheat-sheet)

| You wrote… | Add test category |
|---|---|
| A new migration / RLS policy | `migration-smoke` + `rls-isolation` |
| A new Hono route | `api-unit` (specialist) + `api-integration` (tester) |
| A new event | `event-flow` |
| A new Lambda task | `api-unit` + `state-machine` |
| A new component in `packages/ui` | `frontend-component` |
| A new feature component | `frontend-component` |
| A new page | `frontend-e2e` if critical path |
| A change touching `audit_events` | `audit-chain` extension |
| A change touching PII / money / cross-border | `compliance` review note |

## See also

- ADR-0017 — Test strategy (the authority)
- `docs/testing/conventions.md` — naming, factories, assertions
- `docs/testing/categories/<name>.md` — per-category patterns
- `docs/runbook/ci-pipeline.md` — how each category runs in CI
- `docs/runbook/rls-debugging.md` — when RLS tests go red
