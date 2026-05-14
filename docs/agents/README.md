# Relowa Agent Team

> The team of 16 specialist agents that build, test, and operate this codebase.
> Source of truth: ADR-0016. This file is the navigable index.

## The team at a glance

```
┌───────────────────────────────────────────────────────────────────┐
│  LEAD                                                             │
│  └── lead-orchestrator                                            │
├───────────────────────────────────────────────────────────────────┤
│  SQUAD: Data & RLS                    SQUAD: API & Workflow       │
│  ├── migration-author                 ├── endpoint-writer         │
│  ├── db-operator                      ├── event-bridge-wiring     │
│  ├── rls-test-runner                  └── state-machine-author    │
│  └── audit-trail-verifier                                         │
├───────────────────────────────────────────────────────────────────┤
│  SQUAD: Frontend & UI                 SQUAD: Cross-cutting        │
│  ├── design-system-keeper             ├── tester                  │
│  ├── feature-component-builder        ├── doc-keeper              │
│  ├── route-page-builder               └── compliance-specialist   │
│  └── realtime-debugger                                            │
├───────────────────────────────────────────────────────────────────┤
│  SQUAD: DevOps                                                    │
│  └── ci-cd-engineer                                               │
└───────────────────────────────────────────────────────────────────┘
```

## Quick-pick decision tree

Use this when you don't already know which agent fits.

```
Are you adding or changing a DB table or RLS policy?
  → migration-author

Is the DB slow or behaving weirdly under load?
  → db-operator

Did you change RLS and want to verify isolation?
  → rls-test-runner

Are you investigating the audit hash chain?
  → audit-trail-verifier

Are you writing or modifying a Hono REST endpoint?
  → endpoint-writer

Are you adding an EventBridge rule, scheduler, or Lambda target?
  → event-bridge-wiring

Are you building or extending a Step Functions workflow?
  → state-machine-author

Are you touching packages/ui — tokens, primitives, or patterns?
  → design-system-keeper

Are you building a feature-specific component (e.g. TenderCreateStep1)?
  → feature-component-builder

Are you assembling a Next.js page from components?
  → route-page-builder

Is a real-time subscription not delivering, or outbox lag rising?
  → realtime-debugger

Did you ship code that needs integration / E2E test coverage?
  → tester

Are you updating docs/, ADRs, PRDs, or memory notes?
  → doc-keeper

Does the change touch user PII, money flow, audit, or cross-border data?
  → compliance-specialist  (always, even alongside other agents)

Are you adding a CI step, a deploy target, an IAM role, or Terraform/CDK?
  → ci-cd-engineer

Not sure / multi-step feature?
  → lead-orchestrator (will plan and dispatch)
```

## How to invoke

### Plan-then-execute (default for anything multi-step)

1. Start a session.
2. Tell the `lead-orchestrator`: "Build X" or "Fix Y" or "Add Z."
3. The lead agent reads ADR-0016 §2 and produces a plan listing the specialists, their dependencies, and the verifiable artifacts each will produce.
4. You approve, edit, or reject the plan.
5. On approval, the lead dispatches in dependency order and reports back.

### Direct invocation (for single-file changes or known small tasks)

1. Open the skill file you want: `.opencode/skills/<role>.md` (opencode) or `.claude/agents/<role>.md` (Claude Code).
2. In opencode: paste the contents at session start, or reference it.
3. In Claude Code: invoke via the subagent tool with `subagent_type: <role-name>`.

Either way the agent reads its required-reading list before writing code. Skipping required reading is the only thing that fails a skill invocation without producing any output.

## Agent table

| # | Agent | Squad | Skill file |
|---|---|---|---|
| 1 | `lead-orchestrator` | Lead | `.opencode/skills/lead-orchestrator.md` |
| 2 | `migration-author` | Data & RLS | `.opencode/skills/migration-author.md` |
| 3 | `db-operator` | Data & RLS | `.opencode/skills/db-operator.md` |
| 4 | `rls-test-runner` | Data & RLS | `.opencode/skills/rls-test-runner.md` |
| 5 | `audit-trail-verifier` | Data & RLS | `.opencode/skills/audit-trail-verifier.md` |
| 6 | `endpoint-writer` | API & Workflow | `.opencode/skills/endpoint-writer.md` |
| 7 | `event-bridge-wiring` | API & Workflow | `.opencode/skills/event-bridge-wiring.md` |
| 8 | `state-machine-author` | API & Workflow | `.opencode/skills/state-machine-author.md` |
| 9 | `design-system-keeper` | Frontend & UI | `.opencode/skills/design-system-keeper.md` |
| 10 | `feature-component-builder` | Frontend & UI | `.opencode/skills/feature-component-builder.md` |
| 11 | `route-page-builder` | Frontend & UI | `.opencode/skills/route-page-builder.md` |
| 12 | `realtime-debugger` | Frontend & UI | `.opencode/skills/realtime-debugger.md` |
| 13 | `tester` | Cross-cutting | `.opencode/skills/tester.md` |
| 14 | `doc-keeper` | Cross-cutting | `.opencode/skills/doc-keeper.md` |
| 15 | `compliance-specialist` | Cross-cutting | `.opencode/skills/compliance-specialist.md` |
| 16 | `ci-cd-engineer` | DevOps | `.opencode/skills/ci-cd-engineer.md` |

Each file is mirrored verbatim into `.claude/agents/<role>.md`. The sync script (`pnpm agents:check`) enforces no drift.

## When you see overlap

Some tasks could plausibly be done by two agents. The tiebreakers:

| Situation | Tiebreaker |
|---|---|
| New table involves PII | `migration-author` writes the schema. `compliance-specialist` reviews. Both required. |
| New component will also need new tokens | `design-system-keeper` first (token addition is a separate change). Then `feature-component-builder` consumes the new token. Two PRs, not one. |
| Endpoint needs a new event | `endpoint-writer` adds the route. `event-bridge-wiring` adds the rule/target. The lead coordinates. |
| Page uses a pattern that doesn't exist yet | `design-system-keeper` adds the pattern to `packages/ui`. Then `route-page-builder` uses it. |
| Test is failing because of a Postgres tuning issue | `db-operator` investigates first. `tester` updates test expectations if the test was over-fitting. |

When in doubt, ask the lead.

## See also

- ADR-0016 — Agent Team & Orchestration (the constitutional doc)
- AGENTS.md — operating principles
- `docs/agents/team-handbook.md` — feature walkthroughs
- `docs/agents/sync-strategy.md` — opencode ↔ Claude Code sync discipline
- ADR-0017 — Test strategy (the framework `tester` operates within)
