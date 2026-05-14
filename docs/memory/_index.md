# Relowa Memory Vault

> Obsidian-style knowledge graph for the Relowa POC + Phase 1.

This folder is the project's institutional memory. Every gotcha discovered, every concept worth re-explaining, every micro-decision that didn't justify a full ADR but matters next time — it lives here.

## Folders

- **[[concepts/]]** — long-lived architectural concept explainers
- **[[decisions/]]** — small decisions that don't merit a full ADR
- **[[learned/]]** — mistakes made, time wasted, traps avoided next time

## Conventions

1. **One concept per file.** If a note reaches 1500 words, split it.
2. **Wikilinks generously.** `[[multi-tenancy]]` not `multi-tenancy.md`. Obsidian and most Markdown editors render these.
3. **Top of every note**: a 1–2 sentence "what this is" stub so search hits make sense out of context.
4. **Bottom of every note**: a "see also" section linking related notes.
5. **No copy-paste between notes.** If two notes need the same paragraph, factor it out into a third note and link.

## Entry points

If you're new to this codebase, start here:

- [[concepts/auth-uid-pattern]] — how RLS works without Supabase
- [[concepts/multi-tenancy]] — org / user / role data model
- [[concepts/audit-hash-chain]] — tamper-evident audit trail
- [[concepts/idempotency]] — why every mutation needs a key
- [[concepts/server-authoritative-state]] — why client clocks lie
- [[concepts/hash-anchoring]] — daily Merkle root on Arbitrum One for regulatory timestamping

If you're debugging:

- [[learned/postgres-port-conflict]] — the 5432 vs 5433 saga
- [[learned/postgres-18-volume-mount]] — Postgres 18 directory layout change
- [[learned/rls-recursion-fix]] — SECURITY DEFINER as recursion-breaker
- [[learned/realtime-aes-key-length]] — `DB_ENC_KEY` must be exactly 16 chars

## How agents add to this vault

Every session that hits a non-obvious problem or makes a decision worth remembering:

1. Decide which folder (`concepts`, `decisions`, `learned`).
2. Pick a slug. Lowercase, hyphen-separated. Be descriptive: `postgres-18-volume-mount`, not `gotcha-1`.
3. Write 200–600 words. Include code if it clarifies. Cross-link.
4. Update this `_index.md` if the note belongs in an entry-point list.
