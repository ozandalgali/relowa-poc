# Test category — Audit Chain Integrity

**Status:** 📋 P1, to build.
**Owner:** `audit-trail-verifier`.
**Runner:** Bash + psql.
**Location:** `tests/audit-chain.sh`.

## Purpose

Verify the SHA-256 hash chain on `audit_events` (and `admin_audit_log`) is intact — no insertion-time tampering, no post-insertion modification, no gaps that would break the daily Merkle anchor.

## What this covers

- Every row's `prev_hash` matches the previous row's `hash` (LAG check).
- Every row's `hash` recomputes correctly from the input fields (re-derivation check).
- No `audit_events` row has been UPDATEd or DELETEd (only INSERT is policy-allowed).
- The `admin_audit_log` chain is intact under the same rules.
- The most-recent row's hash matches what we'd anchor to Arbitrum today.

## Test shape

```bash
#!/usr/bin/env bash
set -euo pipefail

CONN="postgres://relowa:dev_password_change_me@localhost:5433/relowa"

# 1. LAG chain check — every prev_hash matches predecessor's hash
echo "Test 1: prev_hash chain"
BROKEN=$(psql "$CONN" -tAc "
  WITH chain AS (
    SELECT id, hash, prev_hash,
      LAG(hash) OVER (ORDER BY created_at, id) AS expected_prev_hash
    FROM audit_events
  )
  SELECT count(*) FROM chain
  WHERE prev_hash IS DISTINCT FROM COALESCE(expected_prev_hash, '');
")
[ "$BROKEN" = "0" ] && echo "  ✓ no chain breaks" || { echo "  ✗ $BROKEN broken links"; exit 1; }

# 2. Hash recomputation — every row's hash matches its computed hash
echo "Test 2: hash recomputation"
MISMATCH=$(psql "$CONN" -tAc "
  SELECT count(*) FROM audit_events
  WHERE hash <> encode(
    digest(
      coalesce(prev_hash,'') || coalesce(action,'') || coalesce(entity_type,'') ||
      coalesce(entity_id::text,'') || coalesce(payload::text,'') || coalesce(created_at::text,''),
      'sha256'
    ), 'hex'
  );
")
[ "$MISMATCH" = "0" ] && echo "  ✓ all hashes match recomputation" || { echo "  ✗ $MISMATCH mismatched"; exit 1; }

# 3. admin_audit_log same checks (when populated)
echo "Test 3: admin_audit_log chain"
# ... same structure ...

# 4. Today's expected Merkle root (for cross-check with anchor pipeline)
echo "Test 4: today's anchor candidate"
TODAY_ROOT=$(psql "$CONN" -tAc "
  -- Simple binary merkle of today's events; the real code uses the same algorithm
  WITH today AS (SELECT hash FROM audit_events WHERE created_at::date = current_date ORDER BY created_at)
  SELECT md5(string_agg(hash, '' ORDER BY hash)) FROM today;   -- placeholder; production uses sha256+pair-hashing
")
echo "  today's pseudo-root: $TODAY_ROOT"

echo ""
echo "✓ audit chain intact"
```

## When this runs

- **PR CI:** every push (cheap, ~1s on seed data).
- **Nightly cron:** against production read-replica.
- **Before anchor publish:** the anchor Lambda runs this check first; if it fails, the day's root is NOT published.

## Findings handling

- **Any chain break = security incident.** Immediate page to super_admin. Halt the anchor pipeline.
- **Hash mismatch = post-insertion tampering.** Same severity.

## What this does NOT cover

- The anchor Lambda itself publishing the root to Arbitrum (that's an integration test in M3+).
- KVKK/regulatory completeness of audit content (that's `compliance`).

## Non-negotiables

- ❌ Never "repair" a chain break by recomputing hashes. The break is evidence.
- ❌ Never run this script with a superuser; superuser bypasses RLS and can see audit events without the auth context (still safe to read, but principle-of-least-privilege violation).
- ✅ Always run this before generating any compliance export.
- ✅ Always include this in pre-anchor-publish CI step.

## See also

- ADR-0001 — Postgres SoR (hash chain trigger)
- ADR-0008 — Arbitrum hash anchoring (anchors consume this chain)
- `docs/memory/concepts/audit-hash-chain.md`
- `.opencode/skills/audit-trail-verifier.md`
