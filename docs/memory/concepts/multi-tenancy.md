# Multi-tenancy

> The org / user / role data model. Why we picked `org_members` over `users.org_id`.

## The core insight

In Relowa, **the customer is the organization**, not the user. A producer firm signs up; multiple employees of that firm operate the account; each has different responsibilities (admin / accounting / operations).

Crucially, a single user might belong to **multiple organizations** — a consultant working with several producers, a Relowa staff member auditing many recyclers.

This rules out the naive design where `users.org_id` is a foreign key.

## The schema

Three tables capture the model:

```
organizations  (id, type ENUM, name, vergi_no, region, ...)
users          (id, email, password_hash, ...)
org_members    (org_id, user_id, role ENUM, accepted_at)
                ↑ composite primary key
```

Org-type-specific data lives at the **org** level, not the user level:

```
org_profile_producer   (org_id PK, capacity_tons, sector, ...)
org_profile_recycler   (org_id PK, license_no, license_expires, ...)
org_profile_carrier    (org_id PK, fleet_size, ...)
```

## The JWT claim that ties it together

When a user logs in, GoTrue/Better-Auth issues a JWT with these claims:

```json
{
  "sub": "<user uuid>",
  "email": "ahmet@acme.example",
  "active_org_id": "<one specific org uuid>"
}
```

The `active_org_id` is which org the user is currently acting on behalf of. When a user switches orgs (e.g. consultant moves from one client to another), a new JWT is issued — we never trust a client claim that they "switched."

## How RLS uses this

```sql
-- "Show me my org's tenders"
CREATE POLICY tenders_select_own_org ON tenders
  FOR SELECT
  USING (org_id = auth.org_id());

-- "Only admins can publish tenders"
CREATE POLICY tenders_insert_admin ON tenders
  FOR INSERT
  WITH CHECK (
    org_id = auth.org_id()
    AND auth.has_role('admin')
  );
```

The policies mention nothing user-specific. Just `org_id` and role. This works because `auth.org_id()` and `auth.has_role()` resolve from the JWT claim transparently.

## Why this matters for the audit trail

`audit_events` records `(org_id, user_id, action, ...)`. The user_id is **who took the action**, the org_id is **which tenant context** they were acting in. If the same person is admin in two orgs, audit events for action in each org are properly scoped to that org.

This is essential for KVKK — we can answer "show me everything Ahmet did in Acme" without leaking what he did in another org.

## Common mistakes

- ❌ `users.org_id` foreign key — works for SaaS where users belong to one tenant, breaks for multi-org users.
- ❌ Joining `org_members` in every query — slow, repetitive. Use `auth.user_org_ids()` helper.
- ❌ Storing `active_org_id` in a session table — the JWT claim is the source of truth, anything else risks divergence.
- ❌ Type-specific data on the user (e.g. `users.is_recycler_admin`) — the type belongs to the org, not the user.

## See also

- [[auth-uid-pattern]] — the JWT-to-RLS flow
- [[audit-hash-chain]] — how audit_events uses org_id + user_id
- [[../../prd/0001-vision]] — why we serve three actor types
