---
skill: tester
purpose: Write integration, E2E, state-machine, and event-flow tests. Pair-run on every code-shipping invocation.
squad: cross-cutting
required_reading:
  - AGENTS.md
  - docs/adr/0017-test-strategy.md
  - docs/testing/conventions.md
  - docs/testing/categories/
  - tests/README.md
---

# Skill: tester

## When to invoke

- After any specialist ships code (auto-paired by `lead-orchestrator`).
- When a regression is reported and a test should cover the case.
- When a new test category needs to be added (P2/P3 graduating to P1).
- Before declaring any feature complete.

**Do NOT invoke this skill for:**
- Unit tests of a single function — those are owned by the specialist who wrote the function.
- Modifying test infrastructure plumbing (that's `ci-cd-engineer`).
- Changing the RLS isolation suite (that's `rls-test-runner`).

The split between unit and integration ownership is in ADR-0017.

## Required reading

- `AGENTS.md`
- `docs/adr/0017-test-strategy.md` — the full strategy
- `docs/testing/conventions.md` — naming, factories, assertions
- `docs/testing/categories/<relevant>.md` — patterns for the category you're writing in
- `tests/README.md` — how to run locally

## Inputs

- The code that just shipped (file diffs).
- The behavior to verify (from ADR, PRD, or feature spec).
- Existing tests in the relevant category (don't duplicate).

## Outputs

For an API integration test:
- `tests/api-integration/<feature>.test.ts` (Vitest)
- Factory functions in `tests/factories/` if data setup is non-trivial
- Test runs in <5s; uses transaction rollback per test where possible

For an event flow test:
- `tests/event-flow/<event-type>.test.ts`
- Asserts mutation → outbox row materializes → relay handles it (mocked in unit, real in integration)

For an E2E (Playwright):
- `tests/e2e/<flow>.spec.ts`
- Reads from `tests/factories/` for seed orgs/users
- Runs against full local stack (docker-compose up)
- Tagged `@critical` if part of the P1 must-pass set

For a state-machine test:
- `tests/state-machine/<workflow>.test.ts`
- Uses Step Functions Local
- Exercises: happy path, one error branch, manual override

## Test pyramid (where each test goes)

| Layer | Runner | Owner of writing | Location |
|---|---|---|---|
| Unit | Vitest | Specialist who wrote the code | Co-located: `*.test.ts` next to source |
| RLS isolation | bash + psql | `rls-test-runner` | `tests/rls-isolation.sh` |
| Migration smoke | bash | `migration-author` (smoke) + `tester` (extensions) | `tests/migration-smoke.sh` |
| API integration | Vitest | **tester** | `tests/api-integration/` |
| Event flow | Vitest | **tester** | `tests/event-flow/` |
| State machine | Vitest + SFN Local | **tester** | `tests/state-machine/` |
| Frontend component | Vitest + RTL | `feature-component-builder` (basic) + **tester** (a11y/snapshot) | Co-located: `*.test.tsx` |
| E2E | Playwright | **tester** | `tests/e2e/` |
| Visual regression | Playwright snapshots | **tester** (P2) | `tests/visual/` |
| Contract | OpenAPI diff | **tester** | `tests/contract/` |
| Performance | k6 | **tester** (P2) | `tests/perf/` |

## Non-negotiables

- ❌ **Never** mark a test `.skip` or `.todo` without an issue link + date.
- ❌ **Never** soften an assertion to make a test pass. The assertion encodes a requirement; if requirements changed, change the spec, then the assertion.
- ❌ **Never** rely on test order. Each test must work in isolation.
- ❌ **Never** test against a shared DB without transaction-rollback isolation (unless intentional, e.g. seed verification).
- ❌ **Never** use `setTimeout`/`sleep` to wait for asynchronous outcomes — poll for the actual condition.
- ✅ **Always** tag critical-path E2E tests `@critical`. Nightly + pre-release runs filter for these.
- ✅ **Always** name tests `it('returns 409 when status is already published')` — describe the assertion, not the action.
- ✅ **Always** use factories (`createTender(forOrg: ...)`) for mutation data; avoid copy-paste fixtures.

## Coverage policy (from ADR-0017)

Coverage thresholds gate only the critical paths:

| Path | Threshold | Why |
|---|---|---|
| `apps/lambdas/escrow-tasks/` | 100% line + 95% branch | Money. Silent failures = disputes. |
| `apps/api/src/middleware/idempotency.ts` | 100% line + 100% branch | Double-charge risk. |
| `packages/db/src/migrations/0001_rls_helpers_and_policies.sql` (hash chain) | covered by behavioral test (no line gate) | Behavioral, not coverage-shaped. |

Other code reports coverage but does not block. Reasoning: line coverage without assertion intent is a vanity metric; targeted thresholds force deliberate test design where correctness is critical.

## Verification

```bash
pnpm test                         # all categories that match locally
pnpm test:e2e                     # Playwright suite
./tests/rls-isolation.sh          # RLS suite
./tests/escrow-flow.sh            # state machine integration
```

## See also

- `docs/adr/0017-test-strategy.md`
- `docs/testing/categories/`
- `.opencode/skills/rls-test-runner.md` — owns the RLS suite
- `.opencode/skills/ci-cd-engineer.md` — owns the runners + CI
