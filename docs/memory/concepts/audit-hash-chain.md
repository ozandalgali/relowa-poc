# Audit hash chain

> Why every audit row links to the previous via SHA-256, and what tampering would look like.

## What we're protecting against

Three threats:

1. **An attacker with DB access deletes audit rows** to hide actions.
2. **An insider modifies audit rows** to alter history.
3. **A bug allows audit rows to be added retroactively** with a fake `created_at`.

Plain `INSERT-only` policies (no UPDATE, no DELETE) handle threat 3 from the application side, but a database superuser can bypass policies. Cryptographic chaining defends even against that.

## How it works

Each row in `audit_events` has two extra columns:

```
prev_hash   text   -- hash of the row written immediately before
hash        text   -- sha256 of THIS row's content + prev_hash
```

A trigger fills these on INSERT:

```sql
CREATE FUNCTION compute_audit_hash() RETURNS trigger AS $$
DECLARE
  prev text;
BEGIN
  SELECT hash INTO prev FROM audit_events
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  NEW.prev_hash := COALESCE(prev, '');
  NEW.hash := encode(
    digest(
      coalesce(NEW.prev_hash, '') ||
      coalesce(NEW.action, '') ||
      coalesce(NEW.entity_type, '') ||
      coalesce(NEW.entity_id::text, '') ||
      coalesce(NEW.payload::text, '') ||
      coalesce(NEW.created_at::text, ''),
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Every row's `hash` depends on its predecessor's `hash`. Modify any row in the middle of the chain → its hash changes → the next row's `prev_hash` no longer matches. The chain breaks.

## How we verify

A periodic job (Phase 2 — currently designed, not implemented) recomputes hashes and compares:

```sql
WITH chain AS (
  SELECT
    id, created_at, prev_hash, hash,
    LAG(hash) OVER (ORDER BY created_at, id) AS expected_prev_hash
  FROM audit_events
)
SELECT id, created_at FROM chain
WHERE prev_hash IS DISTINCT FROM COALESCE(expected_prev_hash, '');
```

Any row in the result set means tampering detected.

## Why we don't use bigint sequences for chaining

Sequences are cheap to forge — an attacker can re-number rows after deletion. SHA-256 hashes can't be forged without computing the whole chain forward, which requires the predecessor data — which is what was modified.

## What we mirror to S3

Daily, the audit table is exported as JSON Lines to an S3 bucket with **Object Lock (WORM)** enabled. Object Lock means: even with full AWS root credentials, the objects cannot be modified or deleted for the configured retention period (e.g. 7 years for KVKK).

The DB chain protects against in-flight tampering. The S3 mirror is the legal-evidence backstop — if someone disputes the DB record, the WORM mirror is the appellate court.

## Operational notes

- Chain is **global**, not per-org. Trade-off: easier verification, marginally slower writes (one extra SELECT per audit insert). At pilot scale this is irrelevant.
- The trigger is `BEFORE INSERT`, so even concurrent inserts produce a deterministic chain (Postgres serializes via row locks).
- If a row is somehow inserted bypassing the trigger (e.g. someone disables it), the next row's hash will fail to verify — the chain still detects the issue.

## See also

- [[../../adr/0001-postgres-as-system-of-record]] — Postgres is the SoR
- [[multi-tenancy]] — the org_id / user_id columns on audit_events
- [[idempotency]] — the other tamper-resistance pattern in this stack
