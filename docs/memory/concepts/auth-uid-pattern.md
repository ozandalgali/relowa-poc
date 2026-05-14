# auth.uid() pattern

> How we replicate Supabase's `auth.uid()` developer experience without Supabase, in 30 lines of SQL plus 5 lines of middleware.

## Why this concept matters

The single biggest reason developers love Supabase is the seamless flow:
- User logs in → token issued
- Application calls `db.from('tenders').select()` → only their data comes back
- No `WHERE org_id = ...` boilerplate, no authorization bugs

The "magic" looks like a framework, but it's actually a **vanilla Postgres pattern** anyone can use.

## The mechanism

Three pieces:

### 1. The GUC

PostgreSQL has a per-session, per-transaction setting called a **GUC** (Grand Unified Configuration). Anything can be stored there as a string.

```sql
SELECT set_config('request.jwt.claims', '{"sub":"...","active_org_id":"..."}', true);
--                                                                              ^^^^
--                                                                  transaction-scoped
```

### 2. The helper functions

We define functions in the `auth` schema that read from the GUC:

```sql
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT (current_setting('request.jwt.claims', true)::json->>'sub')::uuid;
$$;
```

Identical signature to Supabase. Same DX.

### 3. The middleware

In Hono, we have a tiny middleware that runs at the start of every authenticated request:

```typescript
export const rlsContext = createMiddleware(async (c, next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) { await next(); return; }
  const claims = await verify(token, JWT_SECRET);
  await db.execute(sql`
    SELECT set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)
  `);
  await next();
});
```

That's it. Now every Drizzle query in this request runs with RLS context.

## Why `SECURITY DEFINER` matters

When `auth.has_role(role_name)` queries `org_members`, it triggers RLS policies on `org_members`. Those policies might call `auth.has_role()`. Infinite recursion.

Fix: helper functions touching tables with their own RLS policies are marked `SECURITY DEFINER` so they run as the function owner (postgres superuser), bypassing RLS:

```sql
CREATE FUNCTION auth.has_role(role_name text) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp   -- ⬅ MANDATORY: prevents search_path injection
AS $$ ... $$;
```

The `SET search_path` is non-negotiable. Without it, an attacker who can create objects in any schema could shadow functions like `count` or `now` and get the helper to call their malicious version.

## Anti-patterns

- ❌ Using `auth.uid()` inside application code (`SELECT auth.uid()` from Drizzle). The whole point is that you don't need to.
- ❌ Using `auth.uid()` as a column default (it's request-scoped).
- ❌ Setting `request.jwt.claims` from anywhere other than authentication middleware.
- ❌ Granting application role superuser privileges, which would bypass RLS entirely.

## See also

- [[multi-tenancy]] — the data model these helpers protect
- [[../../adr/0003-rls-with-jwt-guc-pattern]] — the formal decision record
- [[../learned/rls-recursion-fix]] — what happens when you forget SECURITY DEFINER
