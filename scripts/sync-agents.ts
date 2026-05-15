#!/usr/bin/env tsx
/**
 * scripts/sync-agents.ts
 *
 * Keeps `.opencode/skills/` and `.claude/agents/` skill files byte-identical.
 *
 * Modes:
 *   --check    Exit 1 if drift detected (used in CI: `pnpm agents:check`)
 *   --sync     Copy .opencode/skills/ -> .claude/agents/ (used: `pnpm agents:sync`)
 *   (default)  Same as --check
 *
 * Also verifies every skill's required_reading[] files exist on disk.
 *
 * See docs/agents/sync-strategy.md for the full policy.
 */

import { readdirSync, readFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const OPENCODE_DIR = resolve(ROOT, ".opencode/skills");
const CLAUDE_DIR = resolve(ROOT, ".claude/agents");

const SKIP_FILES = new Set(["README.md"]);

type Frontmatter = { required_reading?: string[] };

function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const lines = match[1].split("\n");
  const fm: Frontmatter = {};
  let inRequiredReading = false;
  let reading: string[] = [];
  for (const line of lines) {
    if (line.startsWith("required_reading:")) {
      inRequiredReading = true;
      continue;
    }
    if (inRequiredReading) {
      const itemMatch = line.match(/^\s*-\s+(.+)$/);
      if (itemMatch) {
        reading.push(itemMatch[1].trim());
      } else if (line.trim() === "" || line.startsWith("#")) {
        continue;
      } else {
        inRequiredReading = false;
      }
    }
  }
  if (reading.length > 0) fm.required_reading = reading;
  return fm;
}

function skillFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md") && !SKIP_FILES.has(f));
}

function check(): boolean {
  let ok = true;

  const opencodeFiles = skillFiles(OPENCODE_DIR);
  const claudeFiles = skillFiles(CLAUDE_DIR);

  const opencodeSet = new Set(opencodeFiles);
  const claudeSet = new Set(claudeFiles);

  const onlyOpen = opencodeFiles.filter((f) => !claudeSet.has(f));
  const onlyClaude = claudeFiles.filter((f) => !opencodeSet.has(f));

  if (onlyOpen.length > 0) {
    console.error(`Skills only in .opencode/skills/: ${onlyOpen.join(", ")}`);
    ok = false;
  }
  if (onlyClaude.length > 0) {
    console.error(`Skills only in .claude/agents/: ${onlyClaude.join(", ")}`);
    ok = false;
  }

  for (const file of opencodeFiles) {
    if (!claudeSet.has(file)) continue;

    const a = readFileSync(`${OPENCODE_DIR}/${file}`, "utf-8");
    const b = readFileSync(`${CLAUDE_DIR}/${file}`, "utf-8");

    if (a !== b) {
      console.error(
        `Drift detected: ${file} differs between .opencode/skills/ and .claude/agents/`,
      );
      ok = false;
    }

    // Validate required_reading paths (warn only — some files are planned but not built yet)
    const fm = parseFrontmatter(a);
    for (const relPath of fm.required_reading ?? []) {
      const absPath = resolve(ROOT, relPath);
      if (!existsSync(absPath)) {
        console.warn(`Required-reading file missing (planned?): ${relPath} (from ${file})`);
      }
    }
  }

  return ok;
}

function sync(): void {
  const opencodeFiles = skillFiles(OPENCODE_DIR);

  if (!existsSync(CLAUDE_DIR)) {
    mkdirSync(CLAUDE_DIR, { recursive: true });
  }

  for (const file of opencodeFiles) {
    const src = `${OPENCODE_DIR}/${file}`;
    const dst = `${CLAUDE_DIR}/${file}`;
    copyFileSync(src, dst);
    console.log(`Synced: ${file}`);
  }
  console.log(`Done. ${opencodeFiles.length} files synced.`);
}

// ─── main ──────────────────────────────────────────────────────────────

const mode = process.argv[2];

if (mode === "--sync") {
  sync();
} else {
  const ok = check();
  if (ok) {
    console.log("agents:check — OK (no drift)");
    process.exit(0);
  } else {
    console.error("agents:check — FAILED (drift detected)");
    process.exit(1);
  }
}
