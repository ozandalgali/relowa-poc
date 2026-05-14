# ADR-0015 — Admin Tooling Isolation

**Status:** Accepted
**Date:** 2026-05-13
**Decision-makers:** Ozan (lead)

## Context

ADR-0014 specifies *who* internal staff are and *what* they can do. This ADR specifies *how the admin surface is reached*, *who authenticates them*, and *where it lives in the network topology*.

The threat we are defending against is not adversarial end users — that's what RLS is for. The threats here are:

1. **Credential theft.** A staff member's password phished, a laptop stolen, a session token exfiltrated by malware.
2. **Insider misuse.** A staff member acts outside their assigned scope, or after deactivation that hasn't propagated.
3. **Cross-app contamination.** A browser session for the operator app collides with a staff session, leading to accidental cross-tenant actions.
4. **Surface discovery.** Public DNS / cert-transparency logs reveal `admin.relowa.com` exists; attackers know exactly where to point exploits.

A single layer of defense — even strong SAML SSO — is brittle against (1) and (4). We want three independent gates: anything reaching the admin surface must pass all three.

## Decision

We isolate the admin surface at three independent layers and use AWS-native primitives at each:

```
              ╔══════════════════════════════════════════╗
              ║  Gate 1 — TCP reachability               ║
              ║  AWS Client VPN endpoint                 ║
              ║  CIDR 10.99.0.0/22, cert-based auth      ║
              ║  Route53 Private Hosted Zone resolves    ║
              ║    admin.relowa.local                    ║
              ╚════════════════════╤═════════════════════╝
                                   │
              ╔════════════════════▼═════════════════════╗
              ║  Gate 2 — Identity                       ║
              ║  AWS IAM Identity Center → SAML          ║
              ║  Required MFA (hardware token preferred) ║
              ║  Session TTL 8h, sliding 30min idle      ║
              ╚════════════════════╤═════════════════════╝
                                   │
              ╔════════════════════▼═════════════════════╗
              ║  Gate 3 — RBAC (ADR-0014)                ║
              ║  Role-based permission check             ║
              ║  + assignment scope for tier-1 roles     ║
              ║  + mandatory reason on mutations         ║
              ║  + admin_audit_log for every action      ║
              ╚══════════════════════════════════════════╝
```

### 1. Hostname & DNS

**Production:** `admin.relowa.local` — resolvable only via Route53 Private Hosted Zone attached to the production VPC. The VPN endpoint pushes this hosted zone's DNS server to connected clients, so the hostname is unresolvable to anyone not currently on the VPN.

Why `.local` (a reserved TLD per RFC 6762):
- No public DNS record. Nothing to leak in cert-transparency logs.
- Nothing for shodan.io to scan.
- Browsers don't confuse it with anything; mDNS exists but is irrelevant inside a managed VPC.
- Eliminates the "we picked an obscure subdomain" false-security trap — there is literally no public DNS for this name.

Certificate: internal CA via AWS Private Certificate Authority (PCA). Browser warning on first laptop setup, then trusted. Public CA is impossible for a non-public TLD and that's the point.

**Dev:** `admin.localhost` mapped via `/etc/hosts` to `127.0.0.1` when running both Next.js apps locally. No VPN simulation in dev — the admin app is reachable directly but uses a development-only SAML stub.

### 2. Network topology

```
                      Internet
                         │
                    Public ALB ──► apps/web (ECS Fargate)
                                       │
                                       └─► RDS (postgres, app_user role)

                    AWS Client VPN endpoint
                         │
                    Private subnets / VPN-only SG
                         │
                    Internal ALB ──► apps/admin (ECS Fargate)
                                       │
                                       └─► RDS (postgres, relowa_admin role)
```

- The internal ALB has no public IPs; it lives in private subnets.
- The ALB's security group accepts traffic only from the VPN's authorization rule CIDR (e.g. `10.99.0.0/22`).
- The admin ECS task's security group accepts traffic only from the internal ALB.
- RDS is reachable from both the operator and admin apps; differentiation is at the *DB role*, not at the network — admin connects as `relowa_admin`, operator API as `app_user`.

### 3. AWS Client VPN setup

- **Authentication:** mutual certificate authentication. Per-laptop client certs issued from AWS PCA. No username/password layer; the cert *is* the device identity. Lost laptop → revoke the cert in AWS Console (< 5 min) and the VPN drops.
- **Authorization rules:** one rule allowing the active-staff group to reach `10.20.0.0/16` (the production VPC CIDR for admin subnets). No rule for the operator VPC.
- **Split tunneling:** enabled, only admin VPC traffic goes through the tunnel. Staff laptops aren't degraded for ordinary internet use.
- **Logging:** connection logs sent to a dedicated CloudWatch Logs group; alarm on connections from unexpected source IPs or repeated cert failures.
- **DNS push:** the VPC's Route53 resolver is pushed to clients so `admin.relowa.local` resolves.

### 4. SAML via IAM Identity Center

- **Identity store:** AWS IAM Identity Center (formerly AWS SSO), Identity Center directory as the user store. Future: switch to external IdP (Okta, Azure AD) by reconfiguring Identity Center as a service provider for that IdP — no app code change.
- **Application:** custom SAML 2.0 application registered in Identity Center, ACS URL = `https://admin.relowa.local/api/auth/saml/acs`.
- **Attribute mapping:** SAML assertion includes the staff member's email and a subject claim. `apps/admin` looks up `internal_staff WHERE saml_subject = <claim>` (or email if subject unset on first login, then binds subject).
- **MFA:** required at Identity Center level. Hardware tokens (YubiKey) preferred for super_admin and account_manager. TOTP allowed for support_agent / compliance_officer / financial_analyst.
- **Session TTL:** 8 hours absolute. Sliding 30-minute idle. Re-auth required after either.
- **Group → role mapping:** Identity Center groups (`relowa-super-admin`, `relowa-account-managers`, etc.) feed `internal_staff.role` at provisioning time. Manual override possible by super_admin.
- **Deactivation:** disabling a user in Identity Center revokes SAML on next session. Setting `internal_staff.is_active = false` denies even active sessions on next request (we always re-check on the server). Both are applied for hard deactivation.

### 5. Connection-time hygiene

When a staff member opens `admin.relowa.local` from a VPN-connected laptop:

```
1. ALB receives request.
2. SG check passes (source IP in VPN CIDR).
3. apps/admin checks for SAML session cookie.
   - missing/expired → redirect to /api/auth/saml/initiate
4. SAML round-trip with Identity Center → ACS callback.
5. apps/admin issues a signed session cookie (httpOnly, secure, sameSite=strict,
   path=/, domain=admin.relowa.local; encrypted by KMS-derived key).
6. apps/admin loads internal_staff row, attaches to request context.
7. RBAC middleware (ADR-0014 §5) gates every action.
```

The session cookie is short-lived and tightly scoped. Cross-domain leakage to `app.relowa.com` is impossible because the cookie's `Domain` attribute is `admin.relowa.local`, a different TLD.

### 6. Impersonation network path

When an account manager impersonates an operator (ADR-0014 §6):

```
1. AM clicks "View as <org>" in admin panel.
2. apps/admin calls apps/api (operator backend) on a server-to-server channel
   over the VPC private network, presenting a short-lived service token
   that authorizes "mint impersonation JWT for org X, user Y on behalf of staff Z."
3. apps/api validates the service token (mTLS or AWS SigV4 to an internal Lambda
   that signs JWTs), generates a 30-min JWT with the impersonation claims.
4. apps/admin embeds an <iframe src="https://app.relowa.com/?impersonation=<jwt>">
   The operator app accepts the impersonation JWT only when the impersonated_by
   claim is present AND the request originates from a trusted CSP frame-ancestor
   (admin.relowa.local).
5. operator app sets the JWT cookie scoped to app.relowa.com only;
   the admin shell observes the iframe via postMessage for "exit impersonation".
```

The iframe approach is deliberate: a separate browsing context, separate cookies, separate localStorage. An AM can't accidentally "leak" their admin session into the operator UI.

### 7. Logging and monitoring

- **VPN connection events** → CloudWatch Logs `/aws/vpn/connections`. Metric filter on `EVENT=AUTH_FAILURE` → alarm. Filter on `EVENT=CONNECT` from non-corporate ASN → alarm.
- **SAML auth events** → Identity Center logs, mirrored to a dedicated S3 bucket with Object Lock for 1 year.
- **admin_audit_log writes** → CloudWatch metric on `action` field; threshold alarm if `escrow:manual_release` count > 0 in 1h (any use should be reviewed).
- **Idle session timeout** → cookie expiry; client-side soft warning at 25 min.
- **Forced sign-out** → super_admin can call `POST /api/admin/staff/:id/revoke-sessions` which writes to a `revoked_sessions` table; the request middleware rejects any session whose `staff_id` appears there.

### 8. Disaster scenarios

| Scenario | Defense |
|---|---|
| Laptop stolen with VPN active | Revoke client cert in PCA (immediate); ALB SG keeps revoked-cert holders out. |
| Laptop stolen, VPN was idle | Cert revocation; Identity Center session revoke; `is_active=false`; revoked_sessions row. |
| Phished SAML session token | MFA-bound; tokens not transferable to a non-VPN machine because they only work via `admin.relowa.local`. Revoke via Identity Center. |
| Compromised admin app credential (DB role leak) | DB role only accepts connections from admin ECS tasks (security group + RDS IAM auth); also rotate role password via Secrets Manager. |
| Internal employee gone rogue | `admin_audit_log` shows every action with mandatory reason; deactivation is one click. Approval workflow on high-risk actions is future plan (ADR-0014). |
| Public internet exposure by accident | Internal ALB has no public IP; misconfiguring this requires deliberate change to subnet/SG/scheme. Trapped by Terraform plan review + AWS Config rule "internal ALB must not be internet-facing". |

## Consequences

### Positive

- Three independent gates; compromise of any one is not sufficient.
- No public surface for the admin panel — invisible to scanners, cert-transparency logs, casual recon.
- AWS-native primitives at every layer: no third-party VPN, no third-party SSO, no third-party CA. Single AWS account to audit.
- KVKK alignment is improved: admin actions stay in-region, in-account, fully logged, with mandatory reason.
- The operator app is unaffected by admin outages and vice versa — separate ALBs, separate ECS services, separate DB connection pools.

### Negative

- Onboarding a new staff member requires VPN cert provisioning + Identity Center user creation + `internal_staff` row + group assignment. Runbook will document a single script that does all four. Until then, ~30min per onboard.
- Off-network access for emergencies is non-trivial. We accept this: the cost of having an "emergency bypass" is the bypass becoming the path of least resistance.
- AWS Client VPN cost: ~$0.10/hour per endpoint association + $0.05/hour per active connection. At ~5 staff active 8h/day, ~$80/month. Acceptable.
- Private CA cost: ~$400/month for the PCA. The alternative is self-signed certs with their own management burden; we accept the PCA cost for the operational simplicity.

## Future plans

- **Hardware token enforcement for tier-3** — WebAuthn / FIDO2 only for super_admin, no TOTP. Add when staff count grows.
- **Just-in-time access** — staff requests a temporary scope elevation via a chat-ops command; approval triggers a TTL-bounded permission grant. ADR-0014 future plan.
- **Geo-fencing** — VPN CIDR augmented with geo-IP check at ALB level (block connections from non-EU IPs by default). Useful when staff is geographically known.
- **SCIM lifecycle automation** — Identity Center → `internal_staff` table provisioning, including auto-deactivation when terminated.
- **Bastion for DB access** — when super_admin needs psql, route through a session-manager-only bastion that records every command; remove the option to connect Postgres directly even from VPN. Phase 2 once admin panel covers the cases.
- **Air-gapped support workstation option** — for highest-sensitivity tasks (escrow manual release > X TRY), require a hardened dedicated workstation rather than personal laptop.

## Alternatives considered

| Option | Rejected because |
|---|---|
| `admin.relowa.com` subdomain on public DNS | Discoverable via cert transparency; "security through obscurity" only works if there is no DNS leak at all. |
| Cloudflare Access / Tailscale / Twingate | Adds a third-party identity to the trust chain. AWS Client VPN is functionally adequate and stays inside the AWS audit boundary. |
| IP allowlist on a public ALB | Brittle; staff working from home behind dynamic ISP IPs. Also doesn't protect against SaaS gateways masking origin IPs. |
| SSH-based bastion only (no web admin) | Forces all support work through CLI; UI affordances are valuable for account managers handling many tickets. Bastion remains for super_admin DB access (future plan). |
| Self-hosted OpenVPN | Operational burden; AWS Client VPN is managed and integrates with AWS PCA + CloudWatch. |
| Cognito User Pool for staff | Mixing operator and staff in one identity service blurs the boundary. SAML via Identity Center separates them naturally. |

## Reference

- ADR-0014 — Internal staff RBAC (what staff can do once authenticated)
- ADR-0012 — Frontend app architecture (`apps/admin` shape)
- AWS Client VPN docs: https://docs.aws.amazon.com/vpn/latest/clientvpn-admin/
- AWS IAM Identity Center: https://docs.aws.amazon.com/singlesignon/
- AWS Private CA: https://docs.aws.amazon.com/privateca/
- Route53 Private Hosted Zones: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/hosted-zones-private.html
