# RLS infinite recursion

> Symptom: `ERROR: infinite recursion detected in policy for relation "org_members"`.
> Root cause: an RLS helper function queried a table whose own RLS policies invoked the helper.
> Fix: `SECURITY DEFINER` on the helper, with `SET search_path` for safety.

## What happened

After enabling RLS and adding policies, every test query produced:

```
ERROR:  infinite recursion detected in policy for relation "org_members"
```

The dependency graph:

```
auth.has_role(role)
  → SELECT FROM org_members
      → policy members_select_same_org applies
          → policy WHERE clause references org_members again
              → policy applies again → recursion
```

## The fix

Mark helpers `SECURITY DEFINER`:

```sql
CREATE OR REPLACE FUNCTION auth.has_role(role_name text) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp     -- ⬅ MANDATORY
AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_members
    WHERE user_id = auth.uid()
      AND org_id = auth.org_id()
      AND role::text = role_name
      AND accepted_at IS NOT NULL
  );
$$;
```

`SECURITY DEFINER` runs the function as its owner (postgres superuser), which bypasses RLS. The recursion path is broken because the inner SELECT no longer triggers policy evaluation.

## Why `SET search_path` is mandatory

Without it, an attacker who can create objects in any schema (a low-privilege user, perhaps) could shadow built-ins:

```sql
CREATE SCHEMA evil;
CREATE FUNCTION evil.uuid_generate_v4() RETURNS uuid AS $$
  -- arbitrary code, runs as superuser when has_role calls it
$$ LANGUAGE plpgsql;
```

If `has_role`'s search_path includes `evil` before `pg_catalog`, the wrong function gets called. Setting `SET search_path = public, pg_temp` pins the resolution and closes the door.

## When else this comes up

Any helper that touches a table with self-referencing RLS:

- `auth.user_org_ids()` — same fix
- `auth.is_member()` — same fix
- Anything reading from `audit_events` (if we add policies that reference `audit_events`)

## A subtler trap: cross-table policy recursion

Originally we had:

- `organizations.orgs_select_published_for_recyclers` policy referenced `tenders`
- `tenders.tenders_select_published_for_recyclers` policy referenced `organizations`

This isn't function recursion — it's policy recursion across tables. Fix: drop the cross-policy. Producer-org info for bidders is fetched via a denormalized join in the API layer.

## How to spot this

Postgres's recursion detector is reliable — when it fires, it tells you which relation. But the cure is sometimes a layout change, not a function annotation. If a helper function fix doesn't resolve it, look for cross-table policy graph cycles.

## See also

- [[../concepts/auth-uid-pattern]] — overall RLS pattern
- [[../../adr/0003-rls-with-jwt-guc-pattern]] — formal record
