# ADR-0017 — Test Strategy

**Status:** Accepted (supersedes the sketch in `docs/testing/strategy.md`)
**Date:** 2026-05-14
**Decision-makers:** Ozan (lead)

## Context

The POC ships with one good test script (`tests/rls-isolation.sh`, 5/5 green). That's a strong substrate but it doesn't scale: as the project grows past the substrate into APIs, real-time, state machines, UI, and compliance, the test surface has to grow with it.

Three concrete pressures force a comprehensive strategy now (not later):

1. **Solo lead.** Without explicit categorization and ownership rules, tests turn into a graveyard of `*.skip` files. The only defense is to write the strategy before the tests exist.
2. **Money flows soon.** Escrow lands in M4. Idempotency + audit + state-machine correctness all need test coverage before any user pays. Bolt-on testing for money is a disaster.
3. **Multiple specialists.** The 16-agent team (ADR-0016) needs a clear "who owns which test" map, or tests turn into "someone else's problem."

The temptation is to either over-engineer ("write tests for everything") or under-engineer ("just run the bash script"). Both fail. The right shape is a **pyramid with explicit categories, runners, owners, coverage policy, and deferral rules.**

## Decision

We adopt a **hybrid test pyramid** with bash for substrate/SQL, Vitest for TS, Playwright for E2E, declared categories, targeted coverage thresholds, and deferred categories planned but not yet implemented.

### 1. The pyramid

```
                          ┌────────────────┐
                          │ Visual + Perf  │ <- nightly only, P2
                          │ (P2 deferred)  │
                          ├────────────────┤
                          │  E2E Playwright│ <- 3 critical paths P1
                          │  (3 @critical) │
                       ┌──┴────────────────┴──┐
                       │  Integration         │ <- API + event flow + state machine
                       │  (Vitest + docker)   │
                ┌──────┴──────────────────────┴──────┐
                │  Component (frontend)              │ <- Vitest + RTL + axe
                │  Contract (OpenAPI ↔ Hono)         │
            ┌───┴────────────────────────────────────┴───┐
            │  Unit (Vitest, co-located with source)     │ <- broad base
            └─────────────────────────────────────────────┘
                                  +
            ┌─────────────────────────────────────────────┐
            │  Substrate (bash):                          │ <- the load-bearing
            │  • rls-isolation.sh                         │    smoke tests
            │  • migration-smoke.sh                       │
            │  • audit-chain.sh                           │
            └─────────────────────────────────────────────┘
                                  +
            ┌─────────────────────────────────────────────┐
            │  Compliance (manual checklist P1,           │ <- regulatory gates
            │  semi-automated P2)                         │
            └─────────────────────────────────────────────┘
```

The bash layer is **not** at the bottom by accident — RLS and migration smoke are the load-bearing tests. If they go red, nothing else matters.

### 2. Runners

| Runner | Use | Why |
|---|---|---|
| **Bash + psql** | Substrate (RLS, migration smoke, audit chain) | SQL is the natural language; no app stack needed; reads cleanly in PR diff. |
| **Vitest** | Unit, API integration, event flow, state machine, frontend component | Native TS; fast watch mode; co-locatable; works with c8 for coverage. |
| **Playwright** | E2E browser flows, visual regression (P2) | The right tool for testing user flows across pages. |
| **k6** | Performance / load (P2) | Lightweight, scriptable in JS, well-suited for bid storm simulation. |
| **OWASP ZAP** | Automated security scan (CI step) | Free, AWS Lambda compatible, fits in a nightly stage. |
| **axe-core** | Accessibility (inside Vitest component tests + Playwright pages) | The de-facto standard; runs inline. |
| **Step Functions Local** | State machine tests | The only way to exercise ASL workflows locally. |

Hybrid is the cost. Each tool is the right one for its layer; collapsing to a single runner would mean using one tool poorly for two layers.

### 3. Test categories (16 total)

| # | Category | Phase | Owner | Runner | Location |
|---|---|---|---|---|---|
| 1 | RLS isolation | P1 ✅ | `rls-test-runner` | bash | `tests/rls-isolation.sh` |
| 2 | Migration smoke | P1 | `migration-author` (+ `tester` extend) | bash | `tests/migration-smoke.sh` |
| 3 | API unit | P1 | specialist who wrote the code | Vitest | co-located `*.test.ts` |
| 4 | API integration | P1 | `tester` | Vitest | `tests/api-integration/` |
| 5 | Event flow (outbox → relay → AppSync) | P1 | `tester` | Vitest | `tests/event-flow/` |
| 6 | State machine (escrow SFN) | P1 | `tester` | Vitest + SFN Local | `tests/state-machine/` |
| 7 | Auction lifecycle E2E | P1 | `tester` | bash + curl | `tests/bidding-flow.sh` |
| 8 | Frontend component | P1 | `feature-component-builder` (basic) + `tester` (a11y/snapshot) | Vitest + RTL + axe | co-located `*.test.tsx` |
| 9 | Frontend E2E (critical paths) | P1 minimal (3 flows) | `tester` | Playwright | `tests/e2e/` |
| 10 | Contract (OpenAPI ↔ Hono) | P1 light | `tester` | Vitest | `tests/contract/` |
| 11 | Security (ZAP, dep audit, secret scan) | P1 CI step | `ci-cd-engineer` | scripts in CI | `.github/workflows/` |
| 12 | i18n / a11y lint | P1 CI step | `ci-cd-engineer` | eslint plugins + ts-prune | `.github/workflows/` |
| 13 | Audit chain integrity | P1 | `audit-trail-verifier` | bash + SQL | `tests/audit-chain.sh` |
| 14 | **Compliance** (KVKK/CSRD/ESPR/WSR) | P1 manual checklist · P2 automated | `compliance-specialist` | checklist + planned assertions | `docs/compliance/reviews/` |
| 15 | Visual regression | **P2** | `tester` | Playwright snapshots | `tests/visual/` |
| 16 | Performance / load (bid storm, escrow batch) | **P2** nightly | `tester` | k6 | `tests/perf/` |

P1 = ships in Phase 1 with the framework + first tests.
P2 = doc exists from day one; CI stage scaffolded but commented out until P2 graduates.

### 4. Coverage policy — and the reasoning

Coverage is reported globally; thresholds **only** gate the critical paths.

| Path | Threshold | Why this path, why this number |
|---|---|---|
| `apps/lambdas/escrow-tasks/**` | **100% line + 95% branch** | Money flows. A silent failure on `releaseToSeller` is a customer dispute. Branch coverage forces us to test failure modes, not just happy paths. We accept the 5% branch slack only for true unreachable code (defensive `default:` cases). |
| `apps/api/src/middleware/idempotency.ts` | **100% line + 100% branch** | A bug here double-charges. Every branch (cache hit / cache miss / hash mismatch / expired key) must be tested. The branch coverage requirement makes "I forgot to test the hash-mismatch path" impossible. |
| `apps/api/src/middleware/auth.ts` (JWT GUC setting) | **100% line + 100% branch** | A bug here either silently elevates privilege (no JWT context set → operator sees nothing or sees everything depending on default) or denies legitimate access. Single most security-critical file. |
| `packages/db/src/migrations/0001_rls_helpers_and_policies.sql` (hash chain trigger) | **N/A — behavioral test** | The hash chain is tested by `tests/audit-chain.sh` (insertion → recompute → match). Line coverage on SQL isn't meaningful. The behavioral test is the gate. |
| Everything else | **Reported, not gated** | Numbers are visible in PR comments but don't block merge. Coverage as a vanity metric is worse than no coverage; targeted thresholds make every gate meaningful. |

**Why no global threshold (the reasoning, in writing, because it gets questioned):**

A global "80% line coverage" rule corrupts test-writing behavior in three ways:

1. **It rewards trivial tests.** Engineers write `it('constructs', () => { const x = new Foo(); expect(x).toBeDefined(); })` to hit the number. Lines run; behavior is not verified.
2. **It punishes meaningful refactoring.** Splitting a complex function into smaller pieces can drop coverage if the smaller pieces are easy enough that nobody felt the need to test them individually. The refactor is good; the metric punishes it.
3. **It diffuses attention.** With a global gate, every percentage point is fungible. With targeted thresholds, attention is focused on the exact code paths where silent failure is unacceptable.

Targeted thresholds preserve the *signal* of coverage (we test what matters) without the *noise* of coverage-for-its-own-sake.

The thresholds are encoded in `vitest.config.ts`:

```ts
coverage: {
  thresholds: {
    'apps/lambdas/escrow-tasks/**': { lines: 100, branches: 95 },
    'apps/api/src/middleware/idempotency.ts': { lines: 100, branches: 100 },
    'apps/api/src/middleware/auth.ts': { lines: 100, branches: 100 },
    // No global threshold by design — see ADR-0017
  }
}
```

CI fails when any file under those paths drops below threshold. Reports for everything else are visible but non-blocking.

### 5. Test data strategy — hybrid

| Test type | Data source | Reasoning |
|---|---|---|
| RLS isolation, migration smoke | Shared seed (`packages/db/src/seed/index.ts`) | Read-only assertions about cross-tenant visibility; seed is stable. |
| API integration, event flow | Per-test factories (`tests/factories/createTender`, etc.) + transaction rollback | Mutation-heavy; each test makes its own data and undoes. |
| State machine | Pre-baked fixtures per branch (happy / error / manual override) | Workflows are complex; copy-pasting fixtures is OK when they encode workflow inputs. |
| Frontend component | Static mock props (TS-typed) | Component tests don't touch DB; props are the contract. |
| E2E | Seed + factory hybrid; full reset between suites | Long-running flows need predictable starting state. |

**Factories live in `tests/factories/`:**

```ts
// tests/factories/tenders.ts
export async function createTender(opts: {
  forOrg: string,
  status?: TenderStatus,
  overrides?: Partial<typeof tenders.$inferInsert>
}): Promise<typeof tenders.$inferSelect> {
  // returns inserted row with sensible defaults
}
```

This eliminates the "copy-paste 30 lines of fixture" antipattern and gives test authors a single API to invent test data.

### 6. P2/P3 category handling

For every category not yet implemented:

1. The category doc exists from day one in `docs/testing/categories/<name>.md` with `Status: 📋 Planned (P2)` or `(P3)`.
2. The CI workflow YAML has the stage **scaffolded but commented out**:
   ```yaml
   # P2 — uncomment when visual regression graduates
   # visual-regression:
   #   runs-on: ubuntu-latest
   #   steps:
   #     - uses: actions/checkout@v4
   #     - run: pnpm test:visual
   ```
3. When the category graduates from P2 → P1, the doc's status changes and the CI stage uncomments. No "we'll figure it out later" — the figure-it-out happened in P1 planning.

Categories deferred:
- **Visual regression** — Playwright snapshot diff. Doc + CI scaffold P1; implementation P2.
- **Performance / load** — k6 scripts. Doc + CI scaffold P1; nightly run starts in P2.

### 7. Test ownership rules

Encoded in each specialist's skill file (ADR-0016 §3):

| Code change | Who writes the test |
|---|---|
| New function or class | The specialist who wrote it (unit test, co-located). |
| New Hono endpoint | `endpoint-writer` writes the unit test. `tester` adds the integration test in a paired invocation. |
| New schema | `migration-author` writes the migration. `rls-test-runner` extends the RLS suite. `tester` adds API integration coverage when the endpoint lands. |
| New state machine state | `state-machine-author` writes the Lambda unit test. `tester` writes the state-machine integration test. |
| New component in `packages/ui` | `design-system-keeper` writes the snapshot + a11y test. |
| New feature component | `feature-component-builder` writes the basic snapshot. `tester` adds a11y + interaction tests. |
| New page | `route-page-builder` writes the page; `tester` adds the E2E if it's a critical path. |
| New CI stage | `ci-cd-engineer` writes the smoke test for the stage itself. |

The lead orchestrator's plan output always includes a `tester` step when any code-shipping specialist is in the plan. No exception.

### 8. CI orchestration

| Workflow | Trigger | Stages | Time budget |
|---|---|---|---|
| `lint.yml` | Every PR push | typecheck, eslint, prettier, agents:check, i18n key lint, secret scan | < 2 min |
| `test.yml` | Every PR push | unit, RLS isolation, migration smoke, audit chain | < 3 min |
| `integration.yml` | `[full]` label or push to main | API integration, event flow, state machine, contract | < 8 min |
| `e2e.yml` | Nightly on main | Playwright critical paths + full suite | < 30 min |
| `visual.yml` | Nightly on main (P2) | Visual regression | < 15 min |
| `security.yml` | Weekly cron | OWASP ZAP, dep audit, secret history | < 30 min |
| `perf.yml` | Weekly cron (P2) | k6 bid storm + escrow batch | < 60 min |
| `deploy-dev.yml` | Push to main | Build, deploy to dev account | < 10 min |
| `deploy-prod.yml` | Manual gate on main | Build, deploy to prod | < 15 min |

Details in `docs/runbook/ci-pipeline.md` (owned by `ci-cd-engineer`).

### 9. Bug regression discipline

Every bug fix includes a test that:

1. Fails before the fix.
2. Passes after the fix.
3. Has a comment linking to the bug context (issue ID, memory note, or commit hash).

This is non-negotiable. The `tests/` folder is the documentation of "things that have hurt us before."

## Consequences

### Positive

- **One coherent plan** instead of ad-hoc additions.
- **Owner per test type** removes the "someone else will write it" failure mode.
- **Targeted coverage thresholds** keep the signal where it matters (money + auth) without polluting the metric elsewhere.
- **Deferred categories have homes from day one** — no surprise "we need visual regression now" without a place to put it.
- **Hybrid runners** match tools to layers; no single tool gets stretched outside its sweet spot.
- **Substrate tests (bash) stay first-class** — they're the load-bearing layer and they're readable to anyone, including future contractors.

### Negative

- **Three runners to maintain.** Vitest + Playwright + bash. Mitigated by clear "which tool when" rule. Worst case is one tool's version bump breaks; the others keep running.
- **Coverage thresholds in 3 places** (vitest.config + each specialist agent + this ADR). They must stay in sync. Doc-keeper validates this quarterly.
- **Compliance category is manual in P1.** The risk is forgetting to run the checklist; mitigated by the compliance-specialist being auto-invoked on triggers (ADR-0016 §7).
- **No global coverage gate** can feel uncomfortable. Defended explicitly in §4 reasoning.

## Future plans

- **Property-based tests** (`fast-check`) for invariants like "any sequence of bids preserves audit chain integrity." Add when we have a complex algorithmic surface (Phase 2).
- **Mutation testing** (`stryker`) for the critical paths to verify tests are *meaningful* not just covering. Phase 2.
- **Synthetic monitoring in prod** — Playwright running every 5min against production critical paths from CloudWatch Synthetics. Phase 2.
- **Contract test against deployed providers** (Iyzico sandbox, Greyparrot mock) — Phase 2 when adapters land.
- **Visual regression and performance graduate from P2 to P1 in CI** when the team capacity allows. Likely M6 (admin panel) timeframe.
- **Automated KVKK assertions** — codify checklist items into runnable tests where possible (e.g. "no PII column flows to CloudWatch logs"). Phase 2.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Bash-only test suite | Doesn't scale past the substrate; API + UI tests need richer tooling. |
| TS-only test suite (port RLS tests to Vitest) | Loses the "any DBA can read this" property of bash + psql; RLS tests are the canonical reference and should stay legible at the SQL level. |
| Cypress instead of Playwright | Playwright has better cross-browser, faster, and AWS-friendly. Cypress's value proposition (debugging UX) matters less in a CI-first flow. |
| Jest instead of Vitest | Vitest is faster, native ESM, better TS support, and shares config with Vite-based tools. Jest is the legacy default; no reason to choose it for a greenfield codebase. |
| Global 80% coverage gate | See §4 reasoning. Vanity metric, distorts test-writing behavior. |
| Skip frontend testing in P1 | UI bugs in money flows are catastrophic. Component + critical-path E2E is the minimum. |
| Single "tester" agent owns all tests | Specialists writing their own unit tests creates feedback during implementation; deferring everything to `tester` produces over-the-wall tests that miss intent. |
| Deferring compliance to P2 | KVKK violations at launch are existential. Manual checklist in P1 is the floor. |

## Reference

- ADR-0001 — Postgres SoR (substrate tests defend this)
- ADR-0003 — RLS with JWT-GUC (the RLS suite verifies)
- ADR-0009 — Bidding architecture (auction lifecycle E2E target)
- ADR-0007 — Step Functions escrow (state-machine test target)
- ADR-0006 — Outbox/AppSync (event-flow test target)
- ADR-0016 — Agent team (test ownership map)
- `docs/testing/conventions.md` — naming, factories, assertions
- `docs/testing/categories/*.md` — per-category patterns
- `docs/runbook/ci-pipeline.md` — workflow definitions
- AGENTS.md (regression discipline non-negotiable)
