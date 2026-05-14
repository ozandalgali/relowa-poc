# ADR-0016 — Agent Team & Orchestration

**Status:** Accepted
**Date:** 2026-05-14
**Decision-makers:** Ozan (lead)

## Context

ADR-0004 established that this repo is built collaboratively with AI agents and introduced six skill files in `.opencode/skills/`. That was the right starting structure but left three things underspecified:

1. **No defined team.** Skills exist as a flat list. No squads, no orchestrator, no hand-off rules. Every session re-discovers which skill applies.
2. **No multi-runtime support.** Skills live in `.opencode/skills/`. Claude Code's native subagent system (`.claude/agents/`) is not wired in. A session running in Claude Code can't natively invoke the skills.
3. **No compliance discipline.** KVKK, CSRD, ESPR, WSR — the regulatory work is mentioned in PRD-0001 but no agent owns it. By the time someone notices, the code is too far along.

The substrate is now meaningfully bigger than when ADR-0004 was written: 16 ADRs, 5 PRDs, two frontend apps (`apps/web`, `apps/admin`), an API package, several Lambdas, a UI kit, a maps package, and a 5-role staff RBAC model. The agent system needs to scale with the project, not stay frozen at the original six skills.

## Decision

We adopt a **16-agent team organized into 5 squads + 1 lead orchestrator**, with **canonical content duplicated into both `.opencode/skills/` and `.claude/agents/`** so each runtime is first-class. A `pnpm agents:sync` validator (planned) keeps the two locations identical.

### 1. The 16-agent team

```
┌────────────────────────────────────────────────────────────────────┐
│  LEAD                                                              │
│  ├── lead-orchestrator                                             │
├────────────────────────────────────────────────────────────────────┤
│  SQUAD: Data & RLS                    SQUAD: API & Workflow        │
│  ├── migration-author                 ├── endpoint-writer          │
│  ├── db-operator                      ├── event-bridge-wiring      │
│  ├── rls-test-runner                  ├── state-machine-author     │
│  ├── audit-trail-verifier                                          │
├────────────────────────────────────────────────────────────────────┤
│  SQUAD: Frontend & UI                 SQUAD: Cross-cutting         │
│  ├── design-system-keeper             ├── tester                   │
│  ├── feature-component-builder        ├── doc-keeper               │
│  ├── route-page-builder               ├── compliance-specialist    │
│  ├── realtime-debugger                                             │
├────────────────────────────────────────────────────────────────────┤
│  SQUAD: DevOps                                                     │
│  ├── ci-cd-engineer                                                │
└────────────────────────────────────────────────────────────────────┘
```

| # | Agent | Squad | One-line job |
|---|---|---|---|
| 1 | `lead-orchestrator` | Lead | Receives requests, plans, dispatches to squads, returns the plan for approval before execution |
| 2 | `migration-author` | Data & RLS | Drizzle schema + raw SQL side-car RLS migrations |
| 3 | `db-operator` | Data & RLS | Indexes, EXPLAIN, RDS params, extensions, partition strategy, perf work |
| 4 | `rls-test-runner` | Data & RLS | Runs `tests/rls-isolation.sh`, extends with new cases per new tables |
| 5 | `audit-trail-verifier` | Data & RLS | Validates audit hash chain integrity; surfaces tampering |
| 6 | `endpoint-writer` | API & Workflow | Hono routes with auth + idempotency + Zod + audit |
| 7 | `event-bridge-wiring` | API & Workflow | EventBridge buses, rules, scheduler entries, Lambda targets |
| 8 | `state-machine-author` | API & Workflow | Step Functions ASL, especially the escrow state machine (ADR-0007) |
| 9 | `design-system-keeper` | Frontend & UI | Guards `packages/ui` — tokens, primitives, drift prevention |
| 10 | `feature-component-builder` | Frontend & UI | Builds feature-specific components consuming `packages/ui` |
| 11 | `route-page-builder` | Frontend & UI | Assembles Next.js pages from components, wires data + i18n |
| 12 | `realtime-debugger` | Frontend & UI | Diagnoses subscription / outbox / CDC issues end-to-end |
| 13 | `tester` | Cross-cutting | Integration + E2E + state-machine tests; pair-runs on every code-shipping invocation |
| 14 | `doc-keeper` | Cross-cutting | Maintains `docs/memory/`, ADRs, PRDs, ensures cross-links and freshness |
| 15 | `compliance-specialist` | Cross-cutting | KVKK / CSRD / ESPR / WSR regulatory review on every PR touching user data or money flow |
| 16 | `ci-cd-engineer` | DevOps | GitHub Actions workflows, AWS OIDC, ECR/ECS/Lambda deploys, Terraform/CDK IaC |

### 2. Orchestration model — plan, approve, execute

The `lead-orchestrator` is the only agent that talks to the human directly during the planning phase. The flow:

```
1. Human: "Build the carrier ad endpoint with bid submission."

2. lead-orchestrator produces a plan:
   ├── migration-author: add carrier_ads, carrier_bids tables + RLS
   ├── rls-test-runner: extend isolation suite with carrier-ad scenarios
   ├── endpoint-writer: POST /carrier-ads, POST /carrier-ads/:id/bids
   ├── event-bridge-wiring: carrier_ad.created, carrier_bid.placed events
   ├── tester: integration test for bid submission + outbox event
   ├── doc-keeper: update component-inventory if new patterns introduced
   ├── compliance-specialist: KVKK check (no IBAN handling here → pass)
   └── ci-cd-engineer: no infra change → pass

3. Human approves (or edits) the plan.

4. lead-orchestrator dispatches in dependency order.
   Specialists execute in parallel where possible.
   Each writes its own unit tests; tester adds integration coverage.

5. lead-orchestrator returns a summary diff + test results.
```

**Plan boundary is the approval gate.** The human approves the plan, not each individual step. Execution flows automatically once approved. If a specialist hits an unexpected case, it pauses and reports back to the lead.

### 3. Required reading per agent

Every skill file declares a **required-reading list** at the top — files that must be read before any code is written. Examples:

- `migration-author` reads `AGENTS.md §2`, `ADR-0001`, `ADR-0003`, `packages/db/src/schema.ts`, the relevant memory concepts.
- `feature-component-builder` reads `ADR-0011` (UI kit), `docs/frontend/component-inventory.md`, `docs/frontend/status-taxonomy.md` before touching any TSX.
- `compliance-specialist` reads `PRD-0001`, the relevant regulation summary in `docs/compliance/`, and the schema deltas in the current PR.

This converts "we have docs" into "agents actually consult them." Skipping required reading is the only thing that fails a skill invocation without writing any code.

### 4. Hand-off rules between squads

Squads communicate through artifacts in the repo, not through agent-to-agent chat. The artifacts are:

| Boundary | Artifact |
|---|---|
| Data & RLS → API & Workflow | New schema file + RLS side-car + isolation test |
| API & Workflow → Frontend & UI | Hono endpoint with OpenAPI spec generated (via `@hono/zod-openapi`) |
| API & Workflow → Realtime | Outbox row contract (`aggregate_type`, `event_type`, `payload` shape) — ADR-0006 |
| Frontend & UI → User | Storybook stories + a11y pass + i18n keys present |
| Cross-cutting → All | Tests pass, docs updated, compliance check signed off |

The lead orchestrator's plan output explicitly names these artifacts so each step has a verifiable completion criterion.

### 5. Multi-runtime support — both opencode and Claude Code

Each agent has **two file homes, identical content**:

```
.opencode/skills/<role>.md           ← canonical for opencode
.claude/agents/<role>.md             ← canonical for Claude Code subagents
```

**Why two real files, not symlinks or pointer files:**

- Symlinks fail on Windows + many CI artifact systems.
- Pointer files require the runtime to resolve them; one runtime not doing it = silent fallback to a stale spec.
- Two real files means each runtime is first-class. Neither falls short.

**Drift prevention:**

- `scripts/sync-agents.ts` (planned) reads both directories, diffs them line by line, fails CI if they disagree.
- The script supports a single-direction sync (`--from=opencode`) for the initial population and update workflows.
- The `pnpm agents:check` command runs in pre-commit hook (lefthook / husky) so drift is caught before push.

The duplication discipline is documented in `docs/agents/sync-strategy.md`.

### 6. Skill file structure (every agent)

```markdown
---
skill: <role-name>
purpose: <one sentence>
squad: data-rls | api-workflow | frontend-ui | cross-cutting | devops | lead
required_reading:
  - AGENTS.md
  - docs/adr/00XX-foo.md
  - docs/prd/000X-bar.md
  - packages/relevant/file.ts
---

# Skill: <role-name>

## When to invoke
<bullet list of trigger conditions>

## Required reading
<the agent must open and read these before writing code>

## Inputs / current state
<what context is needed to begin>

## Outputs
<what the agent produces, expressed as files/diffs/test results>

## Non-negotiables
<rules unique to this role; absolute terms>

## Verification
<how to know the work is done>

## See also
<cross-links to related skills and ADRs>
```

The required-reading list is **machine-checkable** — the sync script verifies that every file in the list exists.

### 7. Compliance-specialist invocation rule

The `compliance-specialist` is **always invoked** when a plan touches:

- User PII (`users`, `org_members`, `internal_staff`, `provider_webhooks`, anything with IBAN / national ID / phone / address).
- Money flow (escrow, invoices, payouts).
- Cross-border data (anything that might cross EU borders).
- Audit log structure (changes to `audit_events`, `admin_audit_log`).
- ESG outputs (certificates, carbon calculations, Merkle anchors).

The lead orchestrator's plan auto-includes the compliance specialist when any of those triggers fire. The specialist either signs off, or returns a list of regulatory blockers + remediation steps.

Compliance is **never optional, never deferrable** for these triggers — it's the difference between a fine and a launch.

### 8. Agent lifecycle and updates

- New agents need an ADR (or an amendment to this one) and a corresponding skill file in both locations.
- Removing an agent: deprecate in skill file with `Status: deprecated`, retain for 30 days, then delete.
- Renaming: full file rewrite in both locations + grep for invocation references.

The current 16 agents are the locked Phase 1 team. Phase 2 may add `mobile-driver-builder` (carrier app), `embeddings-engineer` (semantic search), or others as the PRD expands.

## Consequences

### Positive

- **One clear plan-then-execute boundary** for the human. No surprise execution; no per-step nagging.
- **Specialists stay narrow.** A `migration-author` that also designs UI ends up bad at both.
- **Compliance is structural, not aspirational.** The specialist's invocation is automatic on trigger.
- **Two-runtime support.** Whether running in opencode or Claude Code, every agent is reachable natively.
- **Required-reading lists** convert documentation from "available" to "consulted." Cuts hallucination from agents that operate without context.
- **Squad boundaries** give clean artifact-based hand-offs without needing inter-agent chat protocols.

### Negative

- **16 files × 2 locations = 32 files to keep in sync.** Mitigated by the sync script + pre-commit hook. The cost is real but cheap.
- **Plan-then-execute adds a round-trip** to every feature. For trivial work (typo fix, one-line config), the human may want to bypass the plan step. Convention: any change > 1 file goes through the lead; single-file changes can invoke a specialist directly.
- **Required-reading lists must stay current.** When an ADR moves or a file is renamed, the lists must update. The sync script verifies existence, not currency.
- **More agents = more chance the wrong one is invoked.** Mitigated by `docs/agents/README.md`'s decision tree.

## Future plans

- **Auto-generated agent invocation** from PR labels / file globs (`if changes touch packages/db/, invoke migration-author`). Phase 2.
- **Inter-agent test contracts** — each agent declares "I am done when test X passes." Currently informal; could be formalized into a YAML schema.
- **Per-agent telemetry** — track which agent runs how often, how often they succeed first try. Useful for refining skill files.
- **Specialist agents for AI integrations** (Greyparrot adapter, OpenAI vision fallback, embeddings) when those features land.
- **Mobile carrier driver app** introduces `mobile-driver-builder` skill. Phase 2.
- **Localization-translator** agent for the third language (DE / FR). Defer until EU expansion.
- **Architecture-reviewer** agent that runs on every PR to compare changes against the ADR set, flag drift. Phase 2 once codebase is large enough.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Keep flat skill list, no squads | Loses the "who's responsible for what" map at 16 agents. |
| One generalist agent | A generalist agent in this codebase has to load all 16 ADRs + 5 PRDs into context per session. Token cost + drift cost. |
| Pointer files in `.claude/agents/` referencing `.opencode/skills/` | One runtime not resolving pointers = silent stale spec. Two real files is safer. |
| Symlinks | Cross-OS fragility, especially Windows + some CI. |
| Auto-routing without human approval | Loses the plan-boundary safety. We want execution speed but not without a clear plan to sign off. |
| No compliance specialist | Compliance leaks would be caught in PR review, but solo lead is the reviewer. Specialist agent is the structural answer. |
| Combined `frontend-engineer` (no design-system / feature-component split) | Drift creeps back into `packages/ui` invisibly. The split forces a deliberate handoff. |
| Combined `data-engineer` (no migration-author / db-operator split) | Schema modeling and DB operations are different skill modes. Splitting reduces context-switching cost. |

## Reference

- ADR-0004 — Multi-agent orchestration (the earlier, looser framing this supersedes)
- AGENTS.md — operating principles (the constitution every agent obeys)
- `docs/agents/README.md` — agent index + decision tree
- `docs/agents/team-handbook.md` — feature-flow walkthroughs
- `docs/agents/sync-strategy.md` — opencode ↔ Claude Code duplication discipline
- ADR-0017 — Test strategy (the framework `tester` operates within)
