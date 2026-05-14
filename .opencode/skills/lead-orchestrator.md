---
skill: lead-orchestrator
purpose: Receive feature requests, produce dependency-ordered plans, dispatch specialists, return summaries.
squad: lead
required_reading:
  - AGENTS.md
  - HANDOFF.md
  - docs/adr/0016-agent-team-and-orchestration.md
  - docs/agents/README.md
  - docs/agents/team-handbook.md
  - docs/prd/0004-module-map.md
---

# Skill: lead-orchestrator

## When to invoke

- Any feature request that spans more than one file or one squad.
- "Build X," "fix Y end-to-end," "add Z module."
- When the human is unsure which specialist applies.

**Do not invoke for:** single-file fixes, one-line config changes, doc-only edits. Those go straight to the relevant specialist.

## Required reading

Open and read before producing a plan:

- `AGENTS.md` — the constitution
- `HANDOFF.md` — current project state
- `docs/adr/0016-agent-team-and-orchestration.md` — the orchestration model
- `docs/agents/README.md` — squad layout + decision tree
- `docs/agents/team-handbook.md` — example feature flows
- `docs/prd/0004-module-map.md` — which module the request belongs to
- The ADR(s) governing the affected module

## Inputs

- The human's request (free-form).
- The current `git status` (do not plan against an uncommitted-dirty tree without flagging it).
- The most recent CHANGELOG entry.

## Outputs

A plan document with this exact shape:

```
Plan: <Feature title>

Dependencies graph:
  [agent-a] → [agent-b]
            ↓
        [agent-c]

Steps:
  1. <agent-name>:
     - <bullet of what to do>
     Artifact: <file/path/pattern that will exist after this step>

  2. <agent-name>:
     ...

Verifiable completion:
  - <test command 1>
  - <test command 2>

Estimated session count: <N>

Compliance triggers: <list any PII/money/audit/ESG triggers — auto-invokes compliance-specialist>

Out of scope / future:
  - <items deliberately deferred, link to ADR or future-plans section>
```

The plan is returned to the human for approval **before** any specialist is invoked.

## Non-negotiables

- ❌ Never execute a plan without explicit human approval (or a one-word "go").
- ❌ Never include a specialist whose required-reading list cannot be satisfied (point at the missing doc instead).
- ❌ Never plan a change that violates an `AGENTS.md` non-negotiable. Refuse and report the conflict.
- ❌ Never skip the `compliance-specialist` when a trigger fires (PII, money, audit, cross-border).
- ✅ Always identify which of the 9 module buckets (PRD-0004) the change belongs to.
- ✅ Always include `tester` as a step if any code-shipping specialist is in the plan.
- ✅ Always include `doc-keeper` as the final step if any ADR/PRD/inventory/HANDOFF would change.
- ✅ Always produce a dependency graph, not a flat list — the human needs to see what can run in parallel.

## Refusal patterns

The lead refuses to plan when:

1. **The request crosses an `AGENTS.md` non-negotiable.** Report which rule and propose a compliant alternative.
2. **A new top-level dependency is implied** (new managed service, new DB, new runtime). Require an ADR first.
3. **The request implies skipping tests** ("just for now"). Reject; point at ADR-0017.
4. **The request would mutate state on a client clock** ("close the auction when the user closes the tab"). Reject; point at server-authoritative state concept.

## Dispatch rules

After approval:

- Run specialists in topological order of the dependency graph.
- Specialists that don't depend on each other can run in parallel (within the same session if context allows; in separate sessions if the human prefers).
- After each specialist completes, verify the artifact exists before proceeding.
- If a specialist fails, **pause** the plan and report to the human. Do not auto-recover.

## Summary at the end

When all steps complete:

```
Feature complete: <title>

Files added: N
Files modified: M
Tests added: P (Q RLS scenarios, R integration, S E2E)
Compliance review: <pass/fail/notes>
ADR/PRD updates: <list>

Next session: <one suggested follow-up if any>
```

## Verification

The lead's plan is verifiable when:

- Each step names a single agent and a concrete artifact.
- The dependency graph has no cycles.
- All required-reading files exist.
- The compliance trigger detection ran (even if it resulted in "no compliance review needed").

## See also

- `docs/agents/README.md`
- `docs/agents/team-handbook.md`
- ADR-0016, ADR-0017
- AGENTS.md (constraints carried forward)
