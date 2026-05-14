# Skills for opencode

> Canonical role definitions for the Relowa agent team. Source of truth for both opencode and Claude Code.

## What's in here

16 skill files defining the agent team described in ADR-0016. Each file is mirrored byte-for-byte into `.claude/agents/` so Claude Code's native subagent system picks them up too. The mirror is enforced by `pnpm agents:check`.

## The team

```
LEAD
└── lead-orchestrator

SQUAD: Data & RLS
├── migration-author
├── db-operator
├── rls-test-runner
└── audit-trail-verifier

SQUAD: API & Workflow
├── endpoint-writer
├── event-bridge-wiring
└── state-machine-author

SQUAD: Frontend & UI
├── design-system-keeper
├── feature-component-builder
├── route-page-builder
└── realtime-debugger

SQUAD: Cross-cutting
├── tester
├── doc-keeper
└── compliance-specialist

SQUAD: DevOps
└── ci-cd-engineer
```

## How to invoke (opencode)

Paste the contents of the relevant skill file at the start of the session, or reference it: "Apply the `migration-author` skill from `.opencode/skills/`."

## How to invoke (Claude Code)

Use the subagent tool with `subagent_type: <role-name>` — Claude Code reads the mirror at `.claude/agents/<role>.md`.

## When to invoke which agent

See `docs/agents/README.md` for the decision tree and `docs/agents/team-handbook.md` for worked feature flows.

## Authoring or updating a skill

1. Edit the file in `.opencode/skills/`.
2. Run `pnpm agents:sync` to mirror into `.claude/agents/`.
3. Verify with `pnpm agents:check` (no drift).
4. Commit both files.

Every skill file follows the same shape (see `docs/agents/sync-strategy.md` for the template):

- Frontmatter: `skill`, `purpose`, `squad`, `required_reading`.
- When to invoke (and when **not** to).
- Required reading (machine-checked).
- Inputs.
- Outputs.
- Non-negotiables.
- Verification.
- See-also.

## See also

- `AGENTS.md` — overall operating principles
- `docs/adr/0016-agent-team-and-orchestration.md` — current team model
- `docs/adr/0004-multi-agent-orchestration.md` — original orchestration framing
- `docs/agents/README.md`, `docs/agents/team-handbook.md`, `docs/agents/sync-strategy.md`
