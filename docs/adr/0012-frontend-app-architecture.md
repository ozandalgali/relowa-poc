# ADR-0012 — Frontend App Architecture

**Status:** Accepted
**Date:** 2026-05-13
**Decision-makers:** Ozan (lead)

## Context

The Relowa frontend serves three distinct audiences from one design system:

1. **Public** — marketing pages, login, registration, role selection.
2. **Operators** — Producer / Recycler / Carrier users running their own org's workflows inside the app shell.
3. **Relowa staff (admin)** — internal users who can read across tenants for license verification, escrow disputes, and support.

The user, operator, and admin surfaces differ in three meaningful ways:

- **Permissions model.** Operators are RLS-scoped to their org. Admins have a Cognito group claim (`relowa.admin`) that, via the Pre-Token-Generation Lambda, sets `app.elevated = true` in the JWT — RLS policies allow cross-tenant read where this is true. (Not all policies; a separate ADR will cover the admin read surface.)
- **Surface area & bundle.** The operator app ships 9 modules of UI. The admin app needs <10 screens. Shipping both in one Next.js build forces every operator visit to download admin code unless we split.
- **Risk profile.** A vulnerability in admin code is an "all tenants" event. Smaller surface, separate deploy, separate audit story.

Combined with the Q4 decision ("separate `apps/admin` out of question"), this ADR fixes the architecture.

## Decision

We adopt a **two-app Next.js architecture** with a shared UI kit:

```
apps/
├── web/                ← operator + marketing + auth (one Next.js app)
│   ├── (marketing)/    ← landing, contact, public pages
│   ├── (auth)/         ← login, register, role-select, OTP, password reset
│   ├── (app)/          ← authenticated operator surface, AppShell layout
│   └── api/            ← BFF route handlers (proxy to apps/api or direct DB for SSR)
├── admin/              ← Relowa-staff console (separate Next.js app)
│   ├── (auth)/         ← admin login (Cognito group-gated)
│   └── (admin)/        ← cross-tenant operations
└── api/                ← Hono backend (per ADR-0009)
```

Both apps import from `packages/ui` (ADR-0011). They deploy independently and have distinct Cognito App Clients, ECS task definitions, and CloudWatch dashboards.

### 1. `apps/web` route groups

Next.js App Router with three top-level route groups:

```
(marketing)/
  /                                   ← landing
  /nasil-calisir, /teknoloji, /cozumler, /iletisim
(auth)/
  /giris, /kayit, /rol-secimi
  /kayit/uretici, /kayit/tesis, /kayit/tasiyici
  /otp, /sifre-sifirla
(app)/
  layout.tsx                          ← AppShell with RoleAwareSidebar
  /dashboard
  /pazar-yeri                         ← recycler marketplace
  /ihaleler                           ← producer my-tenders
  /ihaleler/yeni                      ← 2-step wizard
  /ihaleler/[id]
  /canli-ihale-takip
  /gecmis-ihaleler
  /operasyon-takip
  /operasyon-takip/[shipmentId]
  /tasiyici-ilanlari                  ← recycler-side carrier ad ownership
  /tasiyici-ilanlari/[id]
  /tasiyici/ilanlar                   ← carrier-side feed
  /finans
  /finans/faturalar
  /esg
  /esg/rapor/[period]
  /ayarlar
  /yardim
```

URL slugs are Turkish (per Q10 — routes are user-visible). File and folder names are English everywhere else.

### 2. Role-aware sidebar

One `<RoleAwareSidebar />` component, items derived from JWT claims at runtime:

```ts
const NAV_BY_ROLE: Record<OrgType, NavItem[]> = {
  producer:  [Dashboard, Ihaleler, CanliIhaleTakip, GecmisIhaleler, Finans, ESG, OperasyonTakip, Ayarlar, Yardim],
  recycler:  [Dashboard, PazarYeri, AcikIhaleTakip, GecmisIhaleler, Finans, ESG, OperasyonTakip, TasiyiciIlani, Ayarlar, Yardim],
  carrier:   [Dashboard, IlanFeed, AktifRotalar, GecmisOperasyonlar, Finans, Ayarlar, Yardim],
};
```

No three separate layouts; one component, claim-driven rendering. Role transitions (org switch) trigger a fresh JWT, sidebar re-renders.

### 3. Data access pattern

**Three options were considered. We chose a hybrid:**

| Layer | Backend | Used for |
|---|---|---|
| Server Components (SSR/RSC) reading directly from Postgres via Drizzle | `packages/db` | Initial page loads, audit log views, ESG report rendering, anything read-heavy and naturally request-scoped |
| Hono REST API (`apps/api`) | ADR-0009 | All mutations (tenders, bids, carrier ads, escrow actions); reads that need consistent caching headers |
| AppSync subscription (live push) | ADR-0006 outbox | Real-time updates on tender detail / live bid feed / shipment events |

**Rule of thumb:**
- Reads in a Server Component → Drizzle directly (with JWT GUC set via middleware).
- Mutations from a Client Component → fetch the Hono API (with `Idempotency-Key`).
- Live updates → subscribe via the realtime hook (ADR-0006).

This avoids the "two APIs" trap (SSR has its own data layer, client has another) while keeping mutations behind the auditable Hono surface.

### 4. AuthN/AuthZ wiring

Two different identity systems serve two different app surfaces:

| App | Authentication | Authorization |
|---|---|---|
| `apps/web` (operator) | Cognito User Pool → JWT | RLS via JWT-GUC pattern (ADR-0003) |
| `apps/admin` (staff) | SAML via AWS IAM Identity Center | Application-layer RBAC (ADR-0014), DB role with `BYPASSRLS` |

**Operator authentication.** Cognito Hosted UI (or custom UI hitting Cognito SDK) issues JWTs. The Next.js middleware validates the JWT on every request, refreshes if needed, and propagates claims into:

- A signed session cookie (httpOnly, secure, sameSite=lax).
- Server-component context (read via `headers()` / a typed helper).
- Outgoing `Authorization: Bearer` header on Hono API calls.

**Operator authorization.** Handled by RLS in Postgres. Server Components don't check `if (user.role === 'admin')`; they trust that the JWT claims, when written to `request.jwt.claims` GUC, will cause RLS to filter rows. UI hides menu items the user can't access purely for ergonomics, not security.

**Staff authentication and authorization.** Detailed in ADR-0014 (RBAC model) and ADR-0015 (network isolation). Summary: SAML assertion validated, staff identity loaded from `internal_staff` table, permissions checked per-action against `staff_role_permissions`, scope checked against `staff_org_assignments` for tier-1/tier-2 roles. Mandatory `reason` recorded for every mutation.

**Unified login flow** (operator):

```
POST /auth/login (email + password) → Cognito
  → resolve org_members for user
  → 0 orgs: 403 "no active organization"
  → 1 org:  issue full JWT, redirect to /dashboard
  → 2+ orgs: issue temp JWT (active_org_id=null),
             redirect to /rol-secimi
             → user picks org → exchange for full JWT → /dashboard
```

One login URL for all operator roles (producer / recycler / carrier). Role discovery happens after authentication via `org_members` lookup; the login page itself reveals nothing about which roles exist.

### 5. `apps/admin` shape

```
apps/admin/
├── (auth)/
│   └── /giris                  ← SAML SSO entry, not Cognito (see ADR-0014/0015)
└── (admin)/
    /dashboard                  ← cross-tenant KPIs
    /organizations              ← license verification, AM assignments
    /organizations/[id]         ← drill-down, audit trail view
    /tenders                    ← cross-tenant tender search
    /escrow/disputes            ← dispute resolution (super_admin only)
    /audit                      ← global audit log with Merkle proof export
    /staff                      ← internal staff management (super_admin only)
    /tickets                    ← support tickets (account_manager + support_agent)
    /impersonate/[orgId]        ← acts-as iframe view (account_manager + super_admin)
```

Admin app uses the **same `packages/ui`** but a small `<AdminShell>` variant with a high-contrast banner ("Acting as Relowa Staff — cross-tenant view") at the top to prevent surprise. RBAC details live in ADR-0014; network and auth isolation in ADR-0015.

Hard rules (enforced in ADR-0014 / 0015):
- Admin app is unreachable from the public internet. Production hostname is private DNS only (`admin.relowa.local`, Route53 Private Hosted Zone tied to AWS Client VPN). No cert transparency leak.
- Admin authentication is SAML via AWS IAM Identity Center, **not** Cognito User Pools. Cognito is for operator users only.
- DB connection uses the `relowa_admin` Postgres role with `BYPASSRLS` attribute. Application-layer RBAC scopes access.
- Every admin action writes to `admin_audit_log` (separate from user `audit_events`) with mandatory `reason` field and `client_ip`.
- Impersonation issues a short-lived JWT with the target org's claims; the operator UI loads in an iframe inside the admin shell with a persistent "acting-as" banner.

### 6. Build & deploy

- `apps/web` deploys to ECS Fargate behind a public ALB. Host: `app.relowa.com`.
- `apps/admin` deploys to ECS Fargate behind an **internal-only ALB** (no public IPs). Host: `admin.relowa.local` (private DNS), reachable only from the VPN CIDR.
- CI: each app has its own build target; only changed paths trigger redeploy.
- Bundle budget: `apps/web` initial JS ≤ 180 kB gzip; `apps/admin` ≤ 220 kB (less aggressive — fewer users, internal).

### 7. Component import discipline

```ts
import { Button, Card } from '@relowa/ui';                  // primitives (Layer 0)
import { KPIStatCard, DataTable } from '@relowa/ui/patterns'; // composites (Layer 1)
import { AppShell, AuthShell } from '@relowa/ui/shells';    // shells (Layer 2)
import { tokens } from '@relowa/ui/tokens';                 // raw token values for CSS-in-JS, charts
```

Subpath exports keep the public surface tidy without forcing a multi-package split.

## Consequences

### Positive

- Admin failures cannot brick the operator app — separate deploys, separate ALB target groups.
- Bundle size stays sane: operators never download admin code.
- Two clear surfaces for security review (operator vs. admin).
- Server Components + Drizzle for reads keeps simple list pages cheap (no API round-trip for marketplace browse).
- Hono API stays the authoritative mutation path — audit + idempotency stay enforced.

### Negative

- Auth must be wired into both apps. Mitigation: shared `packages/auth-utils` with Cognito client + JWT helpers, consumed by both.
- A bug in `packages/ui` ships to both apps. This is a feature for consistency but a coupling we must test against (visual regression covers it).
- Server Components reading the DB directly means **two callers** for some queries — admin tools want the same query through Hono for auditability. Mitigation: route admin-app reads through Hono only (or through a thin "admin DB layer" in `packages/db-admin` if Hono becomes a bottleneck).

## Future plans

- **Impersonation** (Phase 2) — admin can "view as" a tenant user; needs a new JWT claim `acting_as_user_id` and explicit RLS policy support. Big enough for its own ADR.
- **PWA shell** (Phase 2) — operator app becomes installable for offline-tolerant carriers in the field. Service worker scope + manifest only; no native shell.
- **React Native carrier driver app** (Phase 2) — shares the design tokens but not the components. Carrier P1 stays in the web app.
- **Per-tenant subdomain support** (Phase 3) — `acme.relowa.com` style. Trivial with ALB host-based routing; deferred until enterprise sales asks for it.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Single Next.js app with `/admin` route group | Q4 decision: admin separation requested explicitly. Also fails the "smaller blast radius for admin bugs" goal. |
| All-client SPA (no Server Components) | Loses SSR perf wins on dashboard/marketplace; charts and tables are big. App Router gives us both. |
| Remix / Nuxt / SvelteKit | Tooling neutral arguments; choosing Next.js because shadcn/ui assumes it and team familiarity dominates. |
| Direct Drizzle from client components | Impossible — Drizzle needs server credentials and the GUC is per-transaction. Client always goes through Hono. |
| GraphQL gateway in front of Hono | Adds a layer with no current consumer. AppSync (for subscriptions) is a separate concern. Revisit if mobile apps proliferate. |

## Reference

- ADR-0003 — RLS + JWT GUC pattern (foundation for auth)
- ADR-0005 — Cognito authentication (Pre-Token-Generation Lambda details)
- ADR-0006 — Outbox pattern for AppSync (real-time push)
- ADR-0009 — Hono API + EventBridge bidding
- ADR-0011 — UI kit & design tokens (the shared `packages/ui`)
- PRD-0004 — Module map
