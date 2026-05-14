---
skill: doc-keeper
purpose: Maintain docs/memory/, docs/adr/, docs/prd/, frontend guides, HANDOFF, and the master plan dashboard. Keep cross-links live.
squad: cross-cutting
required_reading:
  - AGENTS.md
  - HANDOFF.md
  - docs/memory/_index.md
  - docs/adr/0004-multi-agent-orchestration.md
  - docs/adr/0016-agent-team-and-orchestration.md
  - docs/_site/index.html
---

# Skill: doc-keeper

## When to invoke

- After any significant decision or discovery (auto-invoked as the last step of every multi-step plan that changed architecture or learning).
- At the end of a session that produced new lessons.
- When asked to consolidate or audit the memory graph.
- When an ADR/PRD lands and needs the master plan dashboard + HANDOFF updated.
- When the component-inventory or status-taxonomy needs a sync after Figma changes.

## Inputs

- `docs/memory/_index.md` — entry point and conventions
- Existing notes under `docs/memory/concepts/`, `decisions/`, `learned/`
- Recent git activity (last 5–10 commits) for what to capture

## When to write where

| The thing you learned | Folder |
| --- | --- |
| A concept worth re-explaining whenever it comes up | `concepts/` |
| A small decision that didn't need a full ADR | `decisions/` |
| A bug, gotcha, or wasted hour | `learned/` |
| A project-wide architectural commitment | `docs/adr/` (full ADR, not memory) |

## Note format

Top of every note:

```markdown
# <slug>

> One-sentence "what this is" so search results make sense out of context.
```

Body is normal prose — code blocks, tables, links welcome.

Bottom of every note:

```markdown
## See also

- [[related-note-1]]
- [[related-note-2]]
- [[../../adr/NNNN-relevant-adr]]
```

Wikilinks resolve in Obsidian, plus most Markdown editors. They're plain text in any other context.

## Linking discipline

Every note should link **to and from** at least one other note. Orphaned notes are eventually unfindable. When you create a note:

1. Pick existing notes that are related, edit them to add a link to the new one.
2. From the new note, link back to those parents.
3. If your new note belongs in an entry-point list (in `_index.md`), update it.

## Pruning discipline

A memory note becomes stale when:

- The technology it describes is no longer used.
- The decision it captures has been reversed.
- The "lesson learned" is no longer reproducible (e.g. fixed upstream).

Stale notes should be **moved**, not deleted: rename to `archive/<slug>.md` so the link from elsewhere doesn't 404. Add a one-line "ARCHIVED — see <new note>" at the top.

Never delete a `learned/` note even if the bug is gone. The historical record is the value.

## Audit workflow

Quarterly or whenever asked:

1. List all notes: `find docs/memory -name "*.md" | sort`.
2. For each: skim, ask "still true? still useful? linked from somewhere?"
3. Compile a list of:
   - Notes to update (drift since written)
   - Notes to archive (no longer applicable)
   - Notes that need backlinks from elsewhere
   - Concepts that need new notes (gaps in coverage)
4. Apply the changes in a single PR titled `chore(memory): quarterly audit`.

## Non-negotiables

- ❌ **Never** copy-paste the same paragraph into two notes. Factor it out.
- ❌ **Never** create a note longer than ~1500 words. Split.
- ❌ **Never** delete notes; archive them.
- ✅ **Always** include cross-links. A note without backlinks is unmaintained from day one.
- ✅ **Always** include code or queries when they clarify. Theory without examples is forgettable.

## Cross-doc sync responsibilities

When any of these change, doc-keeper updates the related artifacts:

| Trigger | Update |
|---|---|
| New ADR lands | `docs/_site/index.html` master plan grid, `HANDOFF.md` ADR list |
| New PRD lands | `docs/_site/index.html` PRD section, `HANDOFF.md` |
| Schema change (new table) | `docs/prd/0004-module-map.md` table → module mapping if relevant |
| Figma batch updated | `docs/frontend/component-inventory.md` last-sync date + diffs |
| New status enum | `docs/frontend/status-taxonomy.md` |
| New skill / agent | `docs/agents/README.md` table, `docs/_site/index.html` agent section |
| New `learned/` note | Cross-link from related concepts; update `_index.md` if entry-point-worthy |

## See also

- `docs/memory/_index.md`
- `docs/adr/0004-multi-agent-orchestration.md` (foundational)
- `docs/adr/0016-agent-team-and-orchestration.md` (current)
- `docs/_site/index.html` (master plan dashboard)
- `HANDOFF.md`
