# Claude Code Subagents

> 16 agent definitions for the Relowa team. Mirrored byte-for-byte from `.opencode/skills/`.

## How Claude Code uses these

Each `<role>.md` file defines a subagent. Invoke via the `Agent` tool with `subagent_type: <role-name>`:

```
Agent(
  description: "Add carrier_ads table + RLS",
  subagent_type: "migration-author",
  prompt: "..."
)
```

The subagent reads its own frontmatter, opens its required-reading list, and works in an isolated context.

## The 16 agents

| Agent | Squad |
|---|---|
| `lead-orchestrator` | Lead |
| `migration-author`, `db-operator`, `rls-test-runner`, `audit-trail-verifier` | Data & RLS |
| `endpoint-writer`, `event-bridge-wiring`, `state-machine-author` | API & Workflow |
| `design-system-keeper`, `feature-component-builder`, `route-page-builder`, `realtime-debugger` | Frontend & UI |
| `tester`, `doc-keeper`, `compliance-specialist` | Cross-cutting |
| `ci-cd-engineer` | DevOps |

## Source of truth

These files are mirrored from `.opencode/skills/`. **Do not edit directly here.** Edit in `.opencode/skills/`, then run `pnpm agents:sync`. CI rejects drift via `pnpm agents:check`.

## See also

- `docs/agents/README.md` — decision tree
- `docs/agents/team-handbook.md` — feature walkthroughs
- `docs/agents/sync-strategy.md` — duplication discipline
- `docs/adr/0016-agent-team-and-orchestration.md`
