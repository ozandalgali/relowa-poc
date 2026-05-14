# ADR-0004 — Multi-Agent Orchestration

**Status:** Accepted
**Date:** 2026-05-09

## Context

Relowa POC and Phase 1 are being built collaboratively with AI agents (opencode, Claude Code, Cursor). A solo human lead operating without a multi-agent workflow leaves significant leverage on the table:

- Different parts of the work benefit from different specializations (DB schema design, RLS policy authorship, integration testing, frontend work, documentation).
- Without explicit roles, every session reinvents context, costs more tokens, and produces inconsistent quality.
- Without a memory system, lessons learned in session 5 are forgotten in session 12.

## Decision

We adopt an explicit **multi-agent orchestration model** for ongoing work, with the following structure:

### Tier 1 — Lead session (orchestrator)

Single human-facing session. Routes work to specialist sessions. Reads `AGENTS.md`, `CHANGELOG.md`, recent ADRs at start of every session.

### Tier 2 — Specialist roles, defined as `.opencode/skills/*.md`

Each skill is a self-contained Markdown file describing:
- When to invoke it
- What inputs to expect
- What outputs to produce
- Constraints / non-negotiables specific to that role

Initial roles:

| Skill | Purpose |
| --- | --- |
| `migration-author` | Writes new Drizzle schema + raw SQL side-car migrations. |
| `rls-test-runner` | Executes the RLS isolation suite, reports failures with diff. |
| `audit-trail-verifier` | Validates the audit hash chain, surfaces tampering. |
| `endpoint-writer` | Writes Hono endpoints with idempotency middleware. |
| `realtime-debugger` | Diagnoses Supabase Realtime / logical replication issues. |
| `doc-keeper` | Maintains memory graph in `docs/memory/`. |

### Tier 3 — Memory system

`docs/memory/` is an Obsidian-vault-shaped knowledge graph. Three top-level folders:

- `concepts/` — explainers of architectural concepts (auth pattern, multi-tenancy, idempotency, etc.). Long-lived.
- `decisions/` — short notes capturing micro-decisions that don't merit full ADRs.
- `learned/` — gotchas, pitfalls, surprising failure modes encountered in development.

Cross-linking with `[[wikilinks]]` is used so an agent or human can traverse the graph naturally.

## Consequences

### Positive
- Sessions get fresh on the same context fast (read `AGENTS.md` + relevant skill).
- Lessons learned compound — `learned/` notes mean the same trap is sprung at most once.
- Future sessions (or future contributors) inherit institutional knowledge without ceremony.
- Skills can be reused across projects with minimal modification.

### Negative
- Documentation discipline cost. Mitigation: every PR includes the relevant `learned/` or `decisions/` note when applicable.
- Skills risk staleness. Mitigation: revisit during quarterly retro.
- Agents may misinterpret skill scope. Mitigation: skill files include explicit non-goals.

## How agents should interact with this system

1. Start of session: read `AGENTS.md`, scan `CHANGELOG.md` `[Unreleased]`, scan recent `learned/` notes.
2. When asked to do work that fits a skill, **invoke the skill file** (load it into context, follow its directives).
3. When discovering a new gotcha, **write a `learned/` note** before continuing the work.
4. When making a non-trivial decision, write an ADR (full) or a `decisions/` note (short).
5. End of session: update `CHANGELOG.md` `[Unreleased]`.

## Validation

This ADR is the foundational record. Skill files in `.opencode/skills/` and the memory directory in `docs/memory/` are the operational manifestation.
