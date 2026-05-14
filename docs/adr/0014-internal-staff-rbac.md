# ADR-0014 — Internal Staff RBAC Model

**Status:** Accepted
**Date:** 2026-05-13
**Decision-makers:** Ozan (lead)

## Context

The operator authorization model (ADR-0003) covers end users of three org types — Producer, Recycler, Carrier — scoped strictly to their own organization via RLS. It does not cover the Relowa internal team, who legitimately need cross-tenant visibility to provide customer success, run support, resolve disputes, audit compliance, and operate the platform day-to-day.

Three temptations exist when adding internal access, all of them wrong:

1. **Bolt-on bypass in RLS** — add `OR auth.is_staff()` to every policy. Pollutes the security model, makes every policy harder to reason about, and creates a single boolean god-mode flag.
2. **One "admin" role** — give every Relowa employee full system access. Account managers don't need to release escrow. Compliance officers don't need to impersonate users. Concentrating power magnifies blast radius on credential leak.
3. **Defer the model entirely** — "we'll add admin later." But the *schema* is the hardest part to retrofit (tables, audit log shape, FK directions). If we commit the data model now, the panel UI can land in M6 without forcing a migration.

We also have to be precise about *what counts as security boundary*. End users are an adversarial threat class — the RLS substrate exists specifically to defend against operator bugs leaking data to wrong tenants. Internal staff are not the adversary; they are an *operational* threat class (mistakes, credential theft, insider misuse). The defense for them is different: small surface, network gates, mandatory audit, least-privilege roles, every action traceable.

This ADR fixes the staff authorization model. Network and SAML isolation are in ADR-0015.

## Decision

We split the access model into **two tiers with different enforcement layers**, and commit the staff data model in M1 (schema), defer the admin panel UI to M6 (no production users until then).

```
┌────────────────────────────────────────────────────────────────┐
│ TIER 0 — Operator users (Producer / Recycler / Carrier)        │
│   Enforcement: Postgres RLS via JWT-GUC                        │
│   Threat model: bug / leak prevention                          │
│   Audit: audit_events (hash-chained, ADR-0001)                 │
├────────────────────────────────────────────────────────────────┤
│ TIER 1 — Scoped staff (account_manager, support_agent)         │
│   Enforcement: app-layer RBAC + staff_org_assignments          │
│   DB role: relowa_admin with BYPASSRLS                         │
│   Threat model: mistakes, insider misuse                       │
│   Audit: admin_audit_log (separate, with mandatory reason)     │
├────────────────────────────────────────────────────────────────┤
│ TIER 2 — Read-only specialists                                 │
│   (compliance_officer, financial_analyst)                      │
│   Same enforcement as Tier 1; all-orgs scope                   │
├────────────────────────────────────────────────────────────────┤
│ TIER 3 — Super admin                                           │
│   Full system access; manages other staff                      │
│   Network: VPN-only (ADR-0015)                                 │
└────────────────────────────────────────────────────────────────┘
```

### 1. Staff role taxonomy

| Role | Tier | Scope | Examples of allowed actions |
|---|---|---|---|
| `super_admin` | 3 | All orgs | Full system access, manage staff, force-close auctions, escrow override |
| `account_manager` | 1 | Assigned orgs only | View org data, impersonate users, edit profile on behalf, manage their tickets |
| `support_agent` | 1 | Assigned orgs only | View org data, manage their tickets — no impersonation |
| `compliance_officer` | 2 | All orgs | Read audit trail, ESG reports, export for KVKK requests — no mutations |
| `financial_analyst` | 2 | All orgs | Read escrow, invoices, payment history — no mutations |

`super_admin` is the *only* role with `staff:manage` permission. Bootstrapping: one super_admin is created in the seed for Ozan, all others are added via that account.

### 2. Schema (M1 — commits now)

```sql
CREATE TYPE staff_role AS ENUM (
  'super_admin',
  'account_manager',
  'support_agent',
  'compliance_officer',
  'financial_analyst'
);

CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TABLE internal_staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT NOT NULL,
  role        staff_role NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  saml_subject TEXT UNIQUE,        -- IAM Identity Center subject claim, null until first login
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES internal_staff(id),
  deactivated_at TIMESTAMPTZ
);

CREATE TABLE staff_org_assignments (
  staff_id    UUID NOT NULL REFERENCES internal_staff(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organizations(id)  ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID NOT NULL REFERENCES internal_staff(id),
  PRIMARY KEY (staff_id, org_id)
);

-- Reference table; rows are seeded from code, not user-modifiable
CREATE TABLE staff_permissions (
  code        TEXT PRIMARY KEY,    -- e.g. 'tender:force_close'
  description TEXT NOT NULL,
  risk        risk_level NOT NULL
);

CREATE TABLE staff_role_permissions (
  role            staff_role NOT NULL,
  permission_code TEXT NOT NULL REFERENCES staff_permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role, permission_code)
);

CREATE TABLE admin_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id        UUID NOT NULL REFERENCES internal_staff(id),
  action          TEXT NOT NULL,                  -- e.g. 'org.search', 'user.impersonate.start'
  target_org_id   UUID REFERENCES organizations(id),
  target_user_id  UUID REFERENCES users(id),
  reason          TEXT NOT NULL,                  -- MANDATORY, free-text
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_ip       INET NOT NULL,
  prev_hash       TEXT,                           -- chained like audit_events
  hash            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_staff_idx     ON admin_audit_log(staff_id, created_at DESC);
CREATE INDEX admin_audit_target_org_idx ON admin_audit_log(target_org_id, created_at DESC);
CREATE INDEX admin_audit_action_idx    ON admin_audit_log(action, created_at DESC);
```

**RLS** — staff tables (`internal_staff`, `staff_org_assignments`, `staff_permissions`, `staff_role_permissions`, `admin_audit_log`) have RLS **disabled**. They are accessed only by the `relowa_admin` DB role; the `app_user` operator role has no `GRANT` on them at all. This is enforced in the role-creation SQL, not via policies.

**Hash chain on `admin_audit_log`** — same SHA-256 pattern as `audit_events` (ADR-0001). Tampering with admin actions must be detectable too.

### 3. Permission catalog (seeded from code)

Permissions are code-defined constants; the table is a queryable mirror. Initial set:

| Permission code | Risk | Description |
|---|---|---|
| `org:read` | low | View organization profile and aggregate data |
| `org:write` | medium | Edit organization profile on behalf of operator |
| `org:impersonate` | high | Issue a temporary JWT to act as an operator user |
| `tender:force_close` | high | Manually close a stuck auction |
| `tender:read_all` | low | Search/list tenders across orgs |
| `bid:read_all` | low | View bids across orgs (sensitive — pricing data) |
| `escrow:read_all` | medium | View escrow state across orgs |
| `escrow:manual_release` | critical | Release/refund escrow outside the state machine |
| `audit:read_all` | medium | Read user audit_events across orgs |
| `compliance:export` | medium | Export KVKK/CSRD reports across orgs |
| `finance:read_all` | medium | View invoices, payment history across orgs |
| `ticket:read_assigned` | low | View support tickets in assigned orgs |
| `ticket:read_all` | low | View support tickets across orgs |
| `ticket:write` | low | Reply to / close support tickets |
| `staff:read` | low | View other staff members |
| `staff:manage` | critical | Create/disable staff, change roles, assign orgs |
| `admin_audit:read` | medium | Read admin_audit_log |

### 4. Role → permission mapping

```
super_admin:        ALL permissions
account_manager:    org:read, org:write, org:impersonate, tender:read_all (assigned),
                    bid:read_all (assigned), escrow:read_all (assigned),
                    ticket:read_assigned, ticket:write
support_agent:      org:read (assigned), tender:read_all (assigned),
                    ticket:read_assigned, ticket:write
compliance_officer: org:read, audit:read_all, compliance:export, admin_audit:read
financial_analyst:  org:read, escrow:read_all, finance:read_all
```

`(assigned)` means the permission is checked AND the target_org_id must be in `staff_org_assignments` for this staff member. Tier-2 specialists have no assignment scoping — they see all orgs by role definition.

### 5. Enforcement pattern (app-layer)

Every admin-panel mutation flows through one middleware in `apps/admin`:

```ts
async function requirePermission(
  c: Context,
  permission: PermissionCode,
  targetOrgId?: string,
  reason?: string,
): Promise<StaffSession> {
  const staff = c.get('staff');                          // from SAML middleware
  if (!staff.is_active) throw new HTTPException(403);

  // Permission check
  const allowed = await db.query.staffRolePermissions.findFirst({
    where: and(eq(role, staff.role), eq(permission_code, permission)),
  });
  if (!allowed) throw new HTTPException(403, 'missing permission: ' + permission);

  // Scope check for tier-1 roles
  if (['account_manager', 'support_agent'].includes(staff.role) && targetOrgId) {
    const assigned = await db.query.staffOrgAssignments.findFirst({
      where: and(eq(staff_id, staff.id), eq(org_id, targetOrgId)),
    });
    if (!assigned) throw new HTTPException(403, 'org not assigned');
  }

  // Mandatory reason for all mutations and high-risk reads
  const action = c.req.routePath;
  if (isMutationOrHighRisk(action) && !reason) {
    throw new HTTPException(400, 'reason is required');
  }

  await writeAdminAudit({ staff, action, targetOrgId, reason, clientIp: c.req.header('x-forwarded-for') });
  return staff;
}
```

**No DB-layer enforcement for staff access.** The `relowa_admin` DB role has `BYPASSRLS` — RLS is irrelevant once the request is identified as staff. The discipline is in the app middleware. This is appropriate because:

- The threat model differs: staff is "trusted but verify," not "potentially malicious."
- The audit story is the verification — every read of `bid:read_all` or `escrow:read_all` writes to `admin_audit_log`.
- The network gate (ADR-0015) means a hijacked staff credential still needs VPN access to do anything.

### 6. Impersonation (account_manager, super_admin)

When a staff member with `org:impersonate` clicks "View as Esko Geri Dönüşüm":

```
1. Staff enters mandatory reason (e.g. "Customer cannot publish tender, step 2 error").
2. admin_audit_log row written: action='user.impersonate.start',
   target_org_id, target_user_id, reason, client_ip.
3. API issues a temporary JWT (TTL 30 min) with the operator user's claims:
       { sub: <operator_user_id>, active_org_id: <org_id>,
         email: <operator_email>,
         impersonated_by: <staff_id>,
         impersonation_session: <uuid> }
4. apps/admin renders the operator UI in an iframe pointed at app.relowa.com,
   passing the temp JWT.
5. A persistent banner appears: "Acting as <org name>. All actions logged. [Exit]"
6. Every operator API call during the session sees impersonated_by claim;
   audit_events.user_id = operator_user_id, audit_events.payload.impersonated_by = staff_id.
7. On exit (manual or TTL expiry):
   admin_audit_log row: action='user.impersonate.end', metadata.duration_seconds.
```

Two audit trails simultaneously: the operator-side `audit_events` (the user-facing change record) and the staff-side `admin_audit_log` (the impersonation session record). Cross-referenced via `impersonation_session` UUID.

`compliance_officer` and `financial_analyst` cannot impersonate by design — they read only, and reading sensitive data is itself a mutation in the audit sense (logged but not state-changing).

### 7. Bootstrapping

In M1 schema migration:
- Seed `staff_permissions` table with the catalog above.
- Seed `staff_role_permissions` with the role mapping.
- Seed one `internal_staff` row for Ozan with role `super_admin` (no `saml_subject` until first SAML login binds it).
- Create `relowa_admin` DB role with `BYPASSRLS` and `GRANT`s on staff tables; no `GRANT`s for `app_user` on any staff table.

The admin panel UI is not required for these to exist. The super_admin can perform direct DB operations via psql tunneled through the VPN until the panel ships.

## Consequences

### Positive

- Schema commits today; panel UI defers without forcing a migration later.
- Operator security model unchanged — RLS remains the single boundary for adversarial threats.
- Five roles each have a clear scope; no "admin god mode" diffused across the team.
- Every staff action audited with mandatory reason; insider misuse leaves a trail.
- Impersonation produces double audit (operator-side + staff-side), correlatable via session UUID.
- Adding a new internal role is a permission-mapping change, not a refactor.

### Negative

- App-layer enforcement means a bug in `requirePermission` is a real exposure. Mitigated by: small admin surface, narrow function, explicit tests, and every call site auditable in `git log`.
- `BYPASSRLS` is a powerful attribute. The role-creation SQL must enforce that only the admin app uses it — operator API connects strictly as `app_user`. Documented in runbook.
- Mandatory `reason` is friction for staff. This is intentional. We will not soften it to "optional reason" because the friction is the point.
- Five enums plus permission tables add to the schema surface area. Worth it for the audit story.

## Future plans

- **M6 admin panel** — UI for staff management, org search, impersonation, ticket queue, escrow disputes (ADR-0015 covers the network/auth wiring).
- **Time-bounded permission grants** — temporary elevation for a specific incident, expiring auto-revoke. Useful when a tier-2 specialist needs tier-1 access for a 24h window. Defer until we feel the need.
- **Approval workflows** — high-risk actions (`escrow:manual_release`, `tender:force_close`) could require a second super_admin approval. Defer until volume justifies the workflow tax.
- **Read-replica for compliance** — `compliance_officer` queries against a read replica to keep load off primary. Phase 2+.
- **Auto-onboarding for account managers** — round-robin assignment of new orgs to AMs based on capacity. Operational feature, not a security feature.
- **SCIM provisioning** — automated staff lifecycle from IAM Identity Center (create / disable / role change). Defer until staff count > ~15.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Single `is_staff` boolean on `users` | Conflates operator and staff identity; impersonation becomes a privilege-escalation gun pointed at every operator login. |
| RLS-based staff isolation (`OR auth.is_staff()`) | Pollutes every policy; god-mode boolean diffused across hundreds of clauses; impossible to reason about. |
| Open Policy Agent / Casbin / Cerbos as external authz service | Adds a service for a closed and well-scoped policy set (~17 permissions × 5 roles). Justify it when policy count crosses the boundary where a table becomes hard to maintain. |
| Defer the entire schema to M6 | Creates a migration cliff: schema, RLS implications, hash chain on a new audit table, FK from operator tables to staff tables. Better to commit now and grow into the panel. |
| Per-org staff accounts (one Cognito identity per org) | Operationally absurd; account managers would have 10 logins. |

## Reference

- ADR-0001 — Postgres as system of record (audit chain pattern reused here)
- ADR-0003 — RLS with JWT-GUC pattern (the operator side that this complements)
- ADR-0005 — Cognito authentication (operator auth, doesn't apply to staff)
- ADR-0012 — Frontend app architecture (`apps/admin` shape)
- ADR-0015 — Admin tooling isolation (VPN, SAML, private DNS)
- AGENTS.md §2 (RLS as security boundary — clarified: for operators)
