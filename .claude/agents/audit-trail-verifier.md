---
skill: audit-trail-verifier
purpose: Verify the audit_events and admin_audit_log hash chains are intact. Detect tampering. Surface gaps in the daily Merkle anchor.
squad: data-rls
required_reading:
  - AGENTS.md
  - docs/memory/concepts/audit-hash-chain.md
  - docs/adr/0001-postgres-as-system-of-record.md
  - docs/adr/0008-arbitrum-hash-anchoring.md
  - docs/adr/0014-internal-staff-rbac.md
  - packages/db/src/migrations/0001_rls_helpers_and_policies.sql
---

# Skill: audit-trail-verifier

## When to invoke

- Periodically as a maintenance check (CI nightly run).
- After any incident or suspected DB misuse.
- Before generating an ESG certificate, compliance export, or Merkle anchor.
- After any migration that touches the audit tables.
- When `compliance-specialist` requests a chain integrity report.

## Required reading

- `AGENTS.md`
- `docs/memory/concepts/audit-hash-chain.md`
- `docs/adr/0001-postgres-as-system-of-record.md`
- `docs/adr/0008-arbitrum-hash-anchoring.md` (for anchor verification)
- `docs/adr/0014-internal-staff-rbac.md` (the `admin_audit_log` chain)
- `packages/db/src/migrations/0001_rls_helpers_and_policies.sql` (the trigger definition)

## Inputs

- The current state of `audit_events` and `admin_audit_log` tables.
- The latest published Arbitrum One Merkle root for the date being verified (if applicable).

## Workflow

```sql
-- The chain verification query
WITH chain AS (
  SELECT
    id, action, entity_type, entity_id, payload, created_at,
    prev_hash, hash,
    LAG(hash) OVER (ORDER BY created_at, id) AS expected_prev_hash
  FROM audit_events
)
SELECT id, action, created_at, prev_hash, expected_prev_hash
FROM chain
WHERE prev_hash IS DISTINCT FROM COALESCE(expected_prev_hash, '');
```

A clean chain returns **zero rows**. Any row in the result indicates a chain break.

## Outputs

| Result | What it means |
| --- | --- |
| 0 rows | Chain intact. ✓ |
| 1+ rows starting at row N | Tampering or insertion bypassing the trigger between row N-1 and row N. Investigate. |
| Hash recomputation differs from stored hash | Row N was modified after insertion. Severe. |

## Hash recomputation check

Recompute the hash of every row from raw fields and compare:

```sql
SELECT id, hash AS stored_hash,
  encode(
    digest(
      coalesce(prev_hash, '') ||
      coalesce(action, '') ||
      coalesce(entity_type, '') ||
      coalesce(entity_id::text, '') ||
      coalesce(payload::text, '') ||
      coalesce(created_at::text, ''),
      'sha256'
    ),
    'hex'
  ) AS recomputed_hash
FROM audit_events
WHERE hash <> encode(
  digest(
    coalesce(prev_hash, '') || coalesce(action, '') || coalesce(entity_type, '') ||
    coalesce(entity_id::text, '') || coalesce(payload::text, '') || coalesce(created_at::text, ''),
    'sha256'
  ), 'hex'
);
```

Any rows returned indicate stored hashes that don't match their content. This is post-insertion tampering.

## Non-negotiables

- ❌ **Never** repair a broken chain by recomputing and overwriting. The break **is** the evidence.
- ❌ **Never** disable the trigger "for migration convenience." If a migration must add audit rows, write a custom trigger-bypass procedure with explicit logging.
- ✅ **Always** mirror to S3 with Object Lock daily; the S3 mirror is the legal-evidence backstop.
- ✅ **Always** include this check in CI for Phase 1+.

## See also

- `docs/memory/concepts/audit-hash-chain.md` — the concept explainer
