# ADR-0005 — Cognito Authentication (Operator)

**Status:** Accepted
**Date:** 2026-05-13
**Decision-makers:** Ozan (lead)

## Context

ADR-0009 specified a dev-mode JWT signed with HMAC, written to `request.jwt.claims` GUC by Hono middleware, with RLS doing the actual authorization work (ADR-0003). The dev signer was always a placeholder for a production identity provider.

This ADR fixes that production identity provider for **operator users** (Producer / Recycler / Carrier members). Staff identity is separate and covered in ADR-0015 (SAML via AWS IAM Identity Center).

Three requirements drive the choice:

1. **AWS-native.** Per PRD-0001, production runs on AWS in `eu-central-1`. We do not want a third-party identity vendor in the production trust chain.
2. **JWT-compatible.** The RLS substrate consumes JSON-encoded JWT claims through the GUC. The identity provider must produce or be wrappable into a JWT format we can sign.
3. **Multi-org users.** A user may belong to multiple organizations (e.g. a holding-company operator who manages both a Producer arm and a Recycler subsidiary). The unified login flow (PRD-0004, ADR-0012) requires post-login org selection.

Additionally, KVKK requires that PII (email, phone) stays in EU. Cognito User Pools in `eu-central-1` satisfy this.

## Decision

**Cognito User Pool issues identity. The API re-signs the session JWT with `active_org_id` and `role` claims.**

This separation is the key design point: Cognito is the *identity issuer*, the API is the *session bearer*. We don't fight Cognito's Pre-Token-Generation limitations by trying to mutate Cognito tokens on org switch; we treat Cognito's token as a short-lived identity assertion that the API exchanges for a session JWT it controls.

### 1. Identity issuance (Cognito)

- **User Pool** in `eu-central-1`, named `relowa-operators-prod`.
- **App Client** for `apps/web`, no client secret (SPA).
- **Sign-in identifiers:** email (verified). Username is the email.
- **MFA:** optional in P1 for operators; required for org admins (enforced via Pre-Token-Generation Lambda check). Mandatory in P2.
- **Password policy:** ≥12 chars, mixed case, digit, symbol. Compromised-password detection on (Cognito-managed).
- **Account recovery:** email only in P1. SMS via SNS later (Turkish SMS provider integration).
- **Hosted UI is rejected** — we own the login/register pages per Figma. The frontend calls Cognito SDK directly.

### 2. Pre-Token-Generation Lambda

Triggered on every token issuance. Enriches the access token with claims from our DB:

```ts
export const handler: PreTokenGenerationTriggerHandler = async (event) => {
  const cognitoSub = event.request.userAttributes.sub;
  const email      = event.request.userAttributes.email;

  // Look up or provision the users row from Cognito sub
  const user = await db.users.findOrCreate({
    where: eq(users.cognitoSub, cognitoSub),
    create: { cognitoSub, email, full_name: null },
  });

  const memberships = await db.orgMembers.findMany({
    where: eq(org_members.userId, user.id),
    columns: { orgId: true, role: true },
  });

  event.response.claimsOverrideDetails = {
    claimsToAddOrOverride: {
      'app.user_id':       user.id,
      'app.memberships':   JSON.stringify(memberships),
      // No active_org_id here — chosen post-login
    },
  };
  return event;
};
```

The Lambda runs ~30ms cold, ~5ms warm. Provisioned concurrency = 2 in production to keep p99 < 100ms. (Cold-start mitigation from PRD-0003 risk register.)

### 3. Unified login flow

```
POST /auth/login (email, password)                  ← apps/web → Cognito SDK
  → Cognito returns idToken / accessToken / refreshToken
  → apps/web POST /api/auth/session (with accessToken)

/api/auth/session (Hono):
  1. Verify Cognito JWT signature against jwks_uri
  2. Read app.user_id and app.memberships from access token
  3. Branch:
     a. memberships.length === 0:
        → 403 "no active organization"
     b. memberships.length === 1:
        → issue session JWT with active_org_id + role
        → set session cookie, return { redirect: '/dashboard' }
     c. memberships.length >= 2:
        → issue temporary session JWT (active_org_id=null, can=['choose_org'])
        → set temp cookie, return { redirect: '/rol-secimi', memberships: [...] }

POST /api/auth/choose-org (org_id)                  ← from /rol-secimi page
  1. Verify temp session JWT
  2. Validate user is actually in that org_id
  3. Issue full session JWT
  4. Set session cookie, return { redirect: '/dashboard' }
```

The session JWT is **HMAC-signed by the API** with a key from AWS Secrets Manager. Claims:

```json
{
  "sub": "<user.id>",
  "email": "<email>",
  "active_org_id": "<org.id>",
  "role": "admin|operations|accounting",
  "org_type": "producer|recycler|carrier",
  "cognito_sub": "<cognito.sub>",
  "iat": ...,
  "exp": ...   // 1 hour
}
```

The session cookie is `httpOnly`, `secure`, `sameSite=lax`, scoped to `app.relowa.com`. Refresh: silent re-issue via `/api/auth/refresh` when token has <10min remaining, using the Cognito refresh token (stored httpOnly in a separate cookie with longer TTL).

### 4. Why API-signed session JWT (not direct Cognito JWT)

Cognito tokens can only be enriched at issue time via Pre-Token-Generation. Mutating them mid-session — e.g. when a user switches active org — requires either:

- A full Cognito re-login (slow, bad UX).
- Using Cognito's refresh-token flow with custom params, which the Pre-Token-Generation Lambda can read. But Cognito does not natively forward custom params to the Lambda from the refresh endpoint, requiring an awkward "hint" via user attributes.

API-signed session JWTs sidestep both. The API can issue a new JWT with a different `active_org_id` in ~10ms without any Cognito round-trip. Org switching becomes:

```
POST /api/auth/switch-org (org_id)
  1. Verify current session JWT (must be valid, not the temp one)
  2. Confirm user is in target org_id (RLS-bypassed lookup or query Cognito claim)
  3. Issue new session JWT with new active_org_id + role
  4. Update session cookie
  5. Write audit_events row: action='user.org_switched'
```

The RLS GUC pattern doesn't care who signed the JWT — it just reads the `request.jwt.claims` GUC. The middleware sets that GUC from whichever JWT we're carrying. Cognito JWT vs API JWT is transparent to RLS.

### 5. Multi-tenant invitation flow

A producer admin invites a colleague via email:

```
1. Admin clicks "Invite user" in /ayarlar
   POST /api/orgs/:orgId/invitations
     { email, role }
     → row in org_invitations table (token, expires_at, invited_by)
     → SES email with invitation link

2. Invitee clicks link:
   /kayit/davet/:token
     a. If invitee has no Cognito account → registration flow,
        on Cognito post-confirmation Lambda: create users row,
        find org_invitations by email, create org_members row,
        mark invitation accepted.
     b. If invitee already has Cognito account → /giris with redirect,
        on login: detect pending invitation by email, prompt accept,
        create org_members row, mark invitation accepted.

3. Audit:
   audit_events: action='org.member_invited', then 'org.member_joined'
```

This is the only flow that creates `org_members` rows in production. No direct admin-panel mutation of `org_members` for the operator surface (staff admin panel is separate, ADR-0014).

### 6. Local dev parity

In dev (`docker-compose`), there is no Cognito. The API has two auth modes:

```
AUTH_MODE=dev      → /auth/login accepts seed-data emails with no password check,
                     issues an HMAC-signed JWT directly (no Cognito)
AUTH_MODE=cognito  → production flow (Cognito SDK + jwks verification)
```

Dev mode never runs in production. The dev signer's HMAC key is checked-in to `.env.example` to make this loudly obvious (rotating it is meaningless in dev).

The integration test (`tests/bidding-flow.sh`) uses dev mode. The session JWT structure is **identical** in both modes — only the issuer differs.

### 7. KVKK considerations

- **Data residency:** User Pool in `eu-central-1`, RDS in `eu-central-1`, SES in `eu-central-1`. PII never leaves EU.
- **PII surface in Cognito:** email + optional phone + name. We mirror these into `users` table for queryability, but Cognito remains the source of truth for credential state.
- **Right to deletion:** When a user requests deletion, we soft-delete `users.deleted_at` and call Cognito `AdminDeleteUser`. Audit events referencing the user are anonymized at the same time (replace `user_id` with `null`, keep `payload.email_hash` for forensics).
- **Aydınlatma metni:** delivered at first login; acceptance stored in `users.kvkk_accepted_at`.

## Consequences

### Positive

- Cognito is the boring, managed, KVKK-aligned identity layer; we don't operate password storage.
- API-signed session JWTs keep the org-switch UX fast and decoupled from Cognito's token lifecycle.
- RLS substrate from ADR-0003 unchanged — claims arrive via GUC regardless of issuer.
- Pre-Token-Generation Lambda lets us push DB-derived claims into tokens without exposing the DB to the client.
- Dev parity preserved: same JWT shape, different issuer.

### Negative

- Two signing keys (Cognito's RSA + API's HMAC). Both must rotate; runbook covers it.
- Pre-Token-Generation Lambda cold start can spike auth latency. Mitigation: provisioned concurrency.
- Dev `AUTH_MODE=dev` must never leak to staging/prod. Mitigated by env-var allowlist in entrypoint script (refuses to start if `AUTH_MODE=dev` and `NODE_ENV !== development`).
- Multi-org users see an extra screen post-login (`/rol-secimi`). Small UX tax for a feature that supports realistic business structures.

## Future plans

- **MFA enforcement** — required for all operators in Phase 2. Cognito supports both TOTP and SMS (we'll start with TOTP for cost).
- **Social federation** — optional Google/LinkedIn login for individual carrier drivers. Adds friction to the user pool model; defer until Phase 2.
- **Cognito → AppSync direct auth** — AppSync supports Cognito as a built-in auth provider. We use the API-signed JWT instead so AppSync's session and the REST session stay aligned. Revisit if AppSync's auth becomes simpler than our wrapper.
- **Adaptive authentication** — risk-based step-up MFA (Cognito Advanced Security). Defer until staff scale and budget justify the per-MAU cost.
- **Org switch UI in topbar** — once multi-org users exist at scale, add a topbar org switcher (Figma doesn't currently show one). Trivial to add given `/api/auth/switch-org`.
- **Cognito → SCIM-style provisioning from corporate IdPs** — Phase 3 for enterprise customers.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Direct Cognito JWT in `request.jwt.claims` (no API re-sign) | Org switch requires re-login; UX tax not worth the small signing savings. |
| Auth0 / Clerk / WorkOS | Third-party identity in the trust chain; per-MAU pricing; KVKK paperwork increases. |
| Self-hosted Keycloak | Operational burden; another HA system; not justified for solo lead. |
| Better-Auth (in-app) | Considered for POC; works for dev but adds password-storage burden in production. Cognito is the lower-operational-burden option. |
| Skip Pre-Token-Generation, look up DB on every API request | Adds a DB query to every request including those that don't otherwise touch the DB. Pre-Token-Generation caches the lookup in the token. |

## Reference

- ADR-0003 — RLS with JWT-via-GUC pattern (the consumer of these claims)
- ADR-0009 — Local bidding architecture (dev-mode JWT flow)
- ADR-0012 — Frontend app architecture (login flow UX)
- ADR-0014 — Internal staff RBAC (separate identity path — SAML, not Cognito)
- PRD-0004 — Module map (User Roles bucket)
- AWS Cognito User Pools: https://docs.aws.amazon.com/cognito/
- Pre-Token-Generation Lambda: https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html
