# Runbook — RLS debugging

> When a query returns the wrong number of rows or "permission denied", here's how to diagnose.

## Step 1 — Are you actually testing RLS?

The connection role matters. The `relowa` user is the database owner — RLS is **bypassed for the owner**. To exercise RLS in a `psql` session, switch to `app_user`:

```sql
SET ROLE app_user;
```

If `app_user` doesn't exist:

```sql
CREATE ROLE app_user;
GRANT USAGE ON SCHEMA public, auth TO app_user;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth, public TO app_user;
```

In production, the application connects as a non-superuser role (typically named `app_user` or similar), so RLS is **always** active on application paths.

## Step 2 — Set the JWT claims

RLS reads `request.jwt.claims` GUC. Set it before any query:

```sql
BEGIN;
SET LOCAL ROLE app_user;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub',           '<user uuid>',
  'active_org_id', '<org uuid>',
  'email',         'someone@example.com'
)::text, true);

-- Now run the query you want to debug:
SELECT * FROM tenders;

COMMIT;   -- or ROLLBACK if you don't want side effects
```

The `true` argument to `set_config` makes the setting **transaction-scoped**, which is what middleware does in production. Outside a transaction, the setting evaporates between statements.

## Step 3 — Verify what the helpers see

```sql
SELECT auth.uid() AS who_am_i,
       auth.org_id() AS active_org,
       auth.email() AS email,
       auth.has_role('admin') AS is_admin,
       auth.user_org_ids() AS my_orgs;
```

If any of these return NULL, your claims aren't being read. Common causes:

- Forgot `BEGIN` (statement is its own transaction; `set_config(..., true)` is local to that)
- `set_config` isn't last before the query in the same transaction
- Claims JSON malformed (invalid JSON makes `current_setting` return empty)

## Step 4 — Inspect policies on the table

```sql
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = '<your table>';
```

`qual` is the `USING (...)` clause; `with_check` is `WITH CHECK (...)`. Read them to see what the policy actually requires.

## Step 5 — Test with `EXPLAIN` to confirm RLS is wrapping your query

```sql
EXPLAIN (ANALYZE, VERBOSE) SELECT * FROM tenders WHERE id = '<some id>';
```

The plan should mention `Subplan filtering` or wrap your scan in a `Filter:` line that includes the policy `qual`. If you don't see RLS in the plan, you're probably querying as the owner (Step 1).

## Step 6 — Common patterns that go wrong

### Recursion in policy

If you see `infinite recursion detected in policy for relation "X"`, see [[../memory/learned/rls-recursion-fix]].

### "0 rows returned" when you expected some

Three usual culprits:

1. JWT claims not set → `auth.uid()` is NULL → policies all fail
2. The user genuinely doesn't have a row in `org_members` for `active_org_id`
3. The policy filters by status (e.g. `status = 'published'`) and the row isn't published

### "Permission denied for table X"

The `app_user` role doesn't have `GRANT` on the table:

```sql
GRANT SELECT, INSERT, UPDATE ON <table> TO app_user;
```

GRANTs are necessary; RLS is layered **on top** of GRANT. RLS without GRANT denies; GRANT without RLS allows.

### "new row violates row-level security policy"

The INSERT or UPDATE failed `WITH CHECK`. Either:

- Wrong `org_id` (cross-tenant write attempt)
- Wrong role (e.g. `accounting` user trying to do an admin-only action)
- Wrong source table (e.g. recycler trying to write a tender)

## Step 7 — Run the RLS test suite

```bash
./tests/rls-isolation.sh
```

If suite passes but your specific case fails, write a new test that reproduces the failure, then fix.

## See also

- [[../memory/concepts/auth-uid-pattern]]
- [[../memory/learned/rls-recursion-fix]]
- [[../adr/0003-rls-with-jwt-guc-pattern]]
