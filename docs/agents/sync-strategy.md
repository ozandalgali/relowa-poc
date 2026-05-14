# Agent Sync Strategy

> How `.opencode/skills/<role>.md` and `.claude/agents/<role>.md` stay byte-identical.

## Why two files at all

Both opencode and Claude Code are first-class runtimes for this project. They each expect skills in their own location:

- **opencode:** `.opencode/skills/<role>.md`
- **Claude Code:** `.claude/agents/<role>.md`

Symlinks and pointer files were considered and rejected (ADR-0016 §5). Two real files is the safest answer; the cost is sync discipline.

## The rules

### 1. Files are byte-identical

Every file in `.opencode/skills/` has a twin in `.claude/agents/` with **the same content**. No drift, no per-runtime forks, no "this version is slightly different."

### 2. Edit one, mirror to the other

The workflow:

```
1. Edit .opencode/skills/<role>.md
2. Run `pnpm agents:sync` (or copy manually until that lands)
3. Both files are now identical
4. Commit both
```

### 3. CI verifies no drift

The check (`pnpm agents:check`) runs in:
- Pre-commit hook (planned)
- GitHub Actions `lint` workflow
- Pre-push hook (planned)

If `.opencode/skills/<role>.md` and `.claude/agents/<role>.md` differ, the CI step fails with a diff. No PR merges with drift.

## The sync script (planned: `scripts/sync-agents.ts`)

Two modes:

### `pnpm agents:check` — verify, fail on drift

```ts
// Pseudocode
const opencode = readdir('.opencode/skills/').filter(f => f.endsWith('.md') && f !== 'README.md');
const claude   = readdir('.claude/agents/').filter(f => f.endsWith('.md') && f !== 'README.md');

if (!setsEqual(opencode, claude)) {
  fail(`File set mismatch: only in opencode: ${diff1}, only in claude: ${diff2}`);
}

for (const file of opencode) {
  const a = readFile(`.opencode/skills/${file}`);
  const b = readFile(`.claude/agents/${file}`);
  if (a !== b) {
    fail(`Content drift in ${file}:\n${diff(a, b)}`);
  }
}

// Also verify every skill's required_reading[] file exists:
for (const file of opencode) {
  const fm = parseFrontmatter(file);
  for (const path of fm.required_reading ?? []) {
    if (!exists(path)) fail(`Required-reading file missing: ${path} (from ${file})`);
  }
}
```

Exit code 0 = OK. Exit code 1 = drift.

### `pnpm agents:sync` — copy `.opencode/skills/` over `.claude/agents/`

```ts
// Pseudocode
for (const file of readdir('.opencode/skills/')) {
  if (file === 'README.md') continue;
  if (!file.endsWith('.md')) continue;
  copy(`.opencode/skills/${file}`, `.claude/agents/${file}`);
}
```

opencode is the source-of-truth direction. There is no reverse-sync mode by design — picking one direction prevents accidental overwrite of valid edits.

## Frontmatter compatibility

Both runtimes accept YAML frontmatter at the top. The skill files use a shared schema:

```yaml
---
skill: <role-name>
purpose: <one sentence>
squad: data-rls | api-workflow | frontend-ui | cross-cutting | devops | lead
required_reading:
  - AGENTS.md
  - docs/adr/00XX-foo.md
---
```

Neither runtime errors on unknown frontmatter keys (both treat unknown fields as user metadata). This is by design — if Claude Code introduces a new field (e.g. `model:`, `tools:`), opencode ignores it and vice versa. No fork needed.

If a runtime ever adds a required field the other doesn't recognize, we accept that the file may have a few inert lines in one runtime. We do not split the file.

## Manual sync (until the script ships)

Until `scripts/sync-agents.ts` is implemented, perform the sync by hand:

```bash
# Copy all skill files to claude/agents
cp .opencode/skills/*.md .claude/agents/

# Remove the README that shouldn't be in agents
rm .claude/agents/README.md

# Verify
diff -r .opencode/skills .claude/agents
```

The README files in each location may differ (opencode's README explains opencode usage; claude's README explains Claude Code usage). Only the skill files themselves need to be identical.

## When a skill is renamed

Rename in both locations, in the same commit:

```bash
git mv .opencode/skills/old-name.md .opencode/skills/new-name.md
git mv .claude/agents/old-name.md .claude/agents/new-name.md
```

Also update:
- `docs/agents/README.md` table
- Any cross-references in other skill files
- Any references in ADRs / PRDs / runbooks

`grep -r old-name .` should return zero hits before commit.

## When a skill is deprecated

Deprecate in both locations:

```yaml
---
skill: <role-name>
status: deprecated
deprecated_on: 2026-MM-DD
superseded_by: <new-role-name>
---
```

The body of the file is left intact for 30 days as reference, then both files are deleted.

## See also

- ADR-0016 §5 — Multi-runtime support (the architectural decision)
- `docs/agents/README.md` — agent index
- `docs/runbook/ci-pipeline.md` — where `pnpm agents:check` runs in CI
