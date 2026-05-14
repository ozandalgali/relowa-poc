# ADR-0003 — RLS with the JWT-via-GUC Pattern

**Status:** Accepted (POC validated)
**Date:** 2026-05-09

## Context

Multi-tenant B2B SaaS requires strict cross-tenant isolation. The two common patterns:

1. **Application-layer authorization** — every query carries `WHERE org_id = $current_user.org_id`. Burden on developer; one missed `WHERE` clause leaks data; security review never ends.
2. **Database-layer authorization** — Postgres RLS policies enforce isolation. Application bugs cannot escape.

Supabase popularized pattern 2 by exposing `auth.uid()` in policies. The mechanism behind it is unremarkable:

```sql
-- Per request, the framework writes JWT claims into a Postgres GUC:
SELECT set_config('request.jwt.claims', '{"sub":"...","active_org_id":"..."}', true);

-- The auth.uid() function reads from that GUC:
CREATE FUNCTION auth.uid() RETURNS uuid AS $$
  SELECT (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
$$ LANGUAGE sql STABLE;
```

We can replicate this in 30 lines of SQL + 5 lines of Hono middleware.

## Decision

We adopt the **JWT-via-GUC pattern** for RLS in this project, mirroring Supabase's `auth.*` API surface (`auth.uid()`, `auth.email()`, `auth.org_id()`, `auth.has_role()`, `auth.is_member()`, `auth.user_org_ids()`).

JWT claims are written to `request.jwt.claims` (a transaction-scoped GUC) at the start of every authenticated request by the Hono `rlsContext` middleware. RLS policies on every application table reference these helpers.

Helper functions that read from `org_members` (i.e. `has_role`, `is_member`, `user_org_ids`) are marked `SECURITY DEFINER` with explicit `SET search_path = public, pg_temp` to bypass RLS recursion when the policies on `org_members` themselves invoke these helpers.

## Consequences

### Positive
- Authorization rules live in the database — uniform, auditable, immune to application bugs.
- Same DX as Supabase: `auth.uid()` and friends behave identically.
- Drizzle queries are RLS-aware automatically — no special framework integration required.
- Cross-tenant tests can be written purely in SQL, no application stack to spin up.

### Negative
- `SECURITY DEFINER` is a sharp tool. Any helper function added must explicitly set `search_path` or it becomes a privilege escalation surface.
- The application database role (`app_user`) must be NON-superuser. RLS bypasses for superuser. Production setups must enforce this — covered in `docs/runbook/rls-debugging.md`.
- Drizzle Kit doesn't generate RLS policies. We hand-write side-car SQL files and register them with our two-phase migrate runner.
- Transaction-scoped GUC means we must run authenticated code inside a transaction. Hono middleware ensures this.

## Patterns to follow

When adding a table:

```sql
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY my_table_select_own_org ON my_table
  FOR SELECT
  USING (org_id = auth.org_id());

CREATE POLICY my_table_insert_admin ON my_table
  FOR INSERT
  WITH CHECK (
    org_id = auth.org_id()
    AND auth.has_role('admin')
  );

-- Add no DELETE policy unless deletion is genuinely allowed.
```

## Anti-patterns to reject

- ❌ `if (user.orgId !== row.orgId) throw` in API code.
- ❌ Bypassing RLS with `SET ROLE postgres` for "convenience" in app paths.
- ❌ Using `auth.uid()` as a column default. (It's request-scoped, not row-scoped.)
- ❌ Adding policies that self-reference the same table without `SECURITY DEFINER` indirection.

## Validation

POC has 21 RLS policies across 7 tables, all green:

| Test | Result |
| --- | --- |
| Acme admin sees own 3 tenders | ✓ |
| EkoMetal admin sees only published | ✓ |
| Carrier sees 0 (no policy) | ✓ |
| Anonymous sees 0 | ✓ |
| Cross-tenant INSERT denied | ✓ |
