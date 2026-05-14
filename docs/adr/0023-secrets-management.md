# ADR-0023 — Secrets Management & Rotation

**Status:** Accepted
**Date:** 2026-05-14
**Decision-makers:** Ozan (lead)

## Context

The platform accumulates many secrets across its lifecycle:

- DB passwords (RDS master, RDS app user, `relowa_admin` role)
- API signing keys (session JWT HMAC)
- Cognito client secrets (none for SPA, but App Client for admin SAML may have)
- KMS Customer Managed Key references
- VAPID keys (Web Push)
- SMS provider API keys (Netgsm / Iletimerkezi)
- SES SMTP credentials
- Sentry DSNs
- PostHog project keys
- Iyzico API keys + webhook signing secrets (M4)
- Nilvera API keys (M4)
- Greyparrot API keys (M4)
- Arbitrum anchor wallet private key (M3+)
- Internal CA private key for `admin.relowa.local` (M0)
- VPN certificate signing keys (M0)
- GitHub Actions OIDC trust (no secret, just IAM trust)
- ECR push credentials (via OIDC; no secret)
- Anchor smart-contract owner key

Without discipline:
- Secrets land in `.env` files in repos.
- Rotation never happens; old credentials live forever.
- Compromised credentials have no recovery plan.
- New environments accumulate ad-hoc copy-paste.
- KVKK m.12 "appropriate security measures" obligation is unmet.

## Decision

We adopt **AWS Secrets Manager** as the canonical store for runtime secrets, **AWS KMS** for cryptographic material with auto-rotation where possible, **separate identities per environment**, and **mandatory rotation cadences with audit**.

### 1. Storage by secret class

| Class | Storage | Why |
|---|---|---|
| **DB passwords** | Secrets Manager with auto-rotation | Native RDS integration |
| **API signing keys (JWT HMAC)** | Secrets Manager | Custom rotation Lambda |
| **Provider API keys** (Iyzico, Nilvera, etc.) | Secrets Manager | Manual rotation per provider cadence |
| **VAPID keys** | Secrets Manager | Rare rotation |
| **TLS / Private CA keys** | AWS Certificate Manager + AWS Private CA | Native rotation |
| **VPN client certs** | AWS Private CA per-laptop | Issued and revoked per-staff |
| **Arbitrum wallet private key** | Secrets Manager + AWS KMS sign-only | Encrypted; signs without exposing key |
| **KMS Customer Managed Keys** | AWS KMS (native) | Auto-rotation 365 days |
| **Cognito client secrets** | Cognito console (where unavoidable) | Some attributes inherent |
| **Sentry / PostHog public DSNs** | Env vars in CI (public-ish) | Not actually secret; in client bundles |
| **GitHub Actions AWS creds** | AWS OIDC trust (no long-lived creds) | Per-run STS tokens |

### 2. Secrets Manager organization

Per-environment hierarchical naming:

```
/relowa/<env>/<category>/<name>

Examples:
/relowa/prod/db/rds-master-password
/relowa/prod/db/app-user-password
/relowa/prod/db/relowa-admin-password
/relowa/prod/api/jwt-signing-key
/relowa/prod/api/webhook-hmac-secret
/relowa/prod/notifications/ses-smtp-credentials
/relowa/prod/notifications/sms-netgsm-api-key
/relowa/prod/notifications/vapid-private-key
/relowa/prod/providers/iyzico-api-key
/relowa/prod/providers/iyzico-webhook-secret
/relowa/prod/providers/nilvera-api-key
/relowa/prod/providers/greyparrot-api-key
/relowa/prod/anchor/wallet-private-key
/relowa/prod/observability/sentry-auth-token

/relowa/dev/...
/relowa/staging/...
```

Names are stable; **values rotate**.

### 3. Access via IAM

Each ECS task / Lambda has a role with `secretsmanager:GetSecretValue` scoped to specific secret ARNs only:

```
relowa-api-prod role:
  Allow secretsmanager:GetSecretValue on:
    /relowa/prod/db/app-user-password
    /relowa/prod/api/jwt-signing-key
    /relowa/prod/api/webhook-hmac-secret

relowa-escrow-tasks-prod role:
  Allow secretsmanager:GetSecretValue on:
    /relowa/prod/db/app-user-password
    /relowa/prod/providers/iyzico-api-key
    /relowa/prod/providers/iyzico-webhook-secret

relowa-anchor-lambda-prod role:
  Allow secretsmanager:GetSecretValue on:
    /relowa/prod/anchor/wallet-private-key
  Allow kms:Sign on the anchor signing key
```

Least-privilege: a service has access only to the secrets it needs.

`relowa-admin-prod` role has read access to a wider set but with mandatory CloudTrail audit on every fetch.

### 4. Rotation cadence

| Secret class | Cadence | Method |
|---|---|---|
| RDS master password | 90 days | Auto via Secrets Manager → RDS integration |
| RDS app user password | 90 days | Auto via Secrets Manager rotation Lambda |
| `relowa_admin` DB role password | 30 days | Auto via Secrets Manager rotation Lambda |
| API JWT signing key | 180 days | Custom rotation Lambda (dual-key window 24h for token transition) |
| Webhook HMAC secrets | 365 days | Manual via runbook |
| SES SMTP credentials | 365 days | Manual |
| SMS provider API keys | 365 days | Manual; coordinated with provider |
| VAPID keys | 730 days (2 years) | Manual; all subscriptions re-registered |
| KMS CMKs | 365 days | Native auto-rotation (AWS managed) |
| Iyzico / Nilvera / Greyparrot keys | 180 days | Manual; coordinated with provider |
| Anchor wallet private key | 730 days | Manual; contract `transferOwnership` per ADR-0008 |
| VPN client cert | 365 days per device | AWS Private CA + manual renewal |
| Internal CA root | 3650 days (10 years) | Almost-never; documented procedure |
| Cognito password policy (operator passwords) | 90 days for org admins, 365 for accounting/ops | Cognito password policy + reset prompts |
| Staff Cognito-equivalent (Identity Center) | 30 days for super_admin, 60 for tier-2 | IAM Identity Center policy |

### 5. JWT signing key rotation (dual-key window)

The session JWT HMAC key needs special handling:

- **At rotation:** generate `new_key`. Store as `jwt-signing-key-next`.
- API signs new tokens with `new_key`.
- API verifies tokens with `key` OR `new_key`.
- After 24 hours (longest session TTL): demote `key` to obsolete, promote `new_key` to `key`.
- All existing tokens are now signed by what was `new_key`.

Implementation in `apps/api/src/middleware/auth.ts`. Test coverage in `api-integration` category.

### 6. Operator password rotation

Cognito User Pool enforces:

- Min 12 characters, mixed case, digit, symbol (already in ADR-0005).
- 90-day expiry for org admin role; 365-day for accounting/operations.
- Compromised-password detection enabled (Cognito Advanced Security, paid tier).
- Reset on expiry forced at next login.

Customer-facing copy: "Şifrenizi güvenliğiniz için her 90 günde bir yenilemenizi isteyeceğiz."

### 7. Staff credential rotation

Per ADR-0015 (IAM Identity Center):
- super_admin: 30-day password rotation, MFA mandatory.
- account_manager / support_agent / compliance_officer / financial_analyst: 60-day rotation, MFA mandatory.

### 8. Compromise response

Documented procedure (`docs/runbook/secret-compromise.md`, planned M0):

**Scenario: API JWT signing key leaked**

1. Detection: GitHub secret scanner alert, or anomalous JWT in logs, or external report.
2. Within 15 min: rotate the key (skip dual-key window) via emergency rotation Lambda.
3. All sessions invalidated; users redirected to login.
4. Customer comms: "Güvenlik bakımı — tekrar giriş yapın." (No mention of leak to public; mention to KVKK Authority if PII risk).
5. Root-cause investigation; postmortem.

**Scenario: DB password leaked**

1. Within 15 min: rotate via Secrets Manager.
2. ECS tasks auto-refresh on next read (5-min TTL).
3. Brief downtime during refresh — alarms fire and clear.

**Scenario: Iyzico key leaked**

1. Coordinate with Iyzico support to invalidate the key.
2. Generate new key + update Secrets Manager.
3. ECS task refresh.
4. KVKK + customer notification if money-flow data was accessible.

**Scenario: Anchor wallet key leaked**

1. CRITICAL — the anchor contract owner could be hijacked.
2. Generate new wallet; call `transferOwnership(new_wallet)` from the *current* wallet (race against attacker).
3. Update Secrets Manager.
4. If attacker has already transferred ownership: contract is permanently lost; emit ADR-0008 successor contract; document the gap day.

### 9. Local development

Dev secrets:
- `.env.example` committed (placeholder values).
- `.env` git-ignored (real dev values).
- For Manual provider, secrets are obvious throwaway strings — purpose: make it loudly clear they're dev.
- `pnpm secrets:dev` script populates `.env` from a static dev-secrets file (not git-tracked).

Dev secrets are not protected — by design they're throwaway. Cognito + Manual providers won't accept them in production.

### 10. CI / GitHub Actions

No long-lived AWS keys in GitHub Secrets per ADR-0015 §AWS OIDC. Limited GitHub Secrets remain:

- `SENTRY_AUTH_TOKEN` — for sourcemap upload (Sentry CLI; Sentry-issued, not AWS).
- Read-only `gh` token if needed for cross-repo workflows.

These rotate annually.

### 11. Audit + observability

- CloudTrail logs every `GetSecretValue` call.
- Per-secret access metrics; alarm if a secret is fetched outside expected ECS tasks (signals credential theft).
- `kms:Decrypt` denied requests are P1 alarms (per ADR-0020) — they signal someone attempting unauthorized access.
- `super_admin` reviewing secrets via console writes to `admin_audit_log` (manual).
- Quarterly: compliance-specialist audits secret access patterns + rotation compliance.

### 12. Secret inventory

A canonical list in `docs/runbook/secrets-inventory.md` (planned M0):

```
Each secret:
  - Path
  - Purpose
  - Owner agent (which ECS task / Lambda reads it)
  - Rotation cadence
  - Last rotated date
  - Compromise procedure pointer
```

`pnpm secrets:audit` checks the inventory against actual Secrets Manager state and reports drift. CI runs this in lint.

### 13. KVKK m.12 compliance

KVKK requires "appropriate technical and administrative measures":

- Encrypted at rest (Secrets Manager + KMS native).
- Encrypted in transit (TLS for Secrets Manager API; mTLS for inter-service).
- Access scoped via IAM (documented per role).
- Rotation cadence documented.
- Audit log of access (CloudTrail).
- Compromise response runbook.

Documented in `docs/compliance/kvkk-security-measures.md` for regulator demonstration.

### 14. Cost model

| Item | Pilot scale | 10x scale |
|---|---|---|
| Secrets Manager: ~30 secrets × $0.40/mo | $12/mo | $50/mo |
| Secrets Manager API calls (~10k/mo) | $0.05/mo | $1/mo |
| KMS: ~15 CMKs × $1/mo | $15/mo | $30/mo |
| AWS Private CA | $400/mo flat | $400/mo |
| AWS Certificate Manager (public certs) | Free | Free |
| Cognito Advanced Security | $0.05/active user/mo | $5/mo at pilot, $50/mo at 10x |
| **Total** | **~$430/mo** | **~$485/mo** |

Private CA is the big cost. Alternative is self-signed roots with rotation pain. We accept the cost for operational simplicity.

## Consequences

### Positive

- **Single canonical store** — no `.env` files in production paths.
- **Auto-rotation where supported** — DB passwords + KMS keys rotate without human action.
- **Least-privilege IAM** — services access only their own secrets.
- **Compromise procedures documented** — no improvising during a leak.
- **CloudTrail audit** — every secret access logged.
- **KVKK posture** — regulator demonstration ready.

### Negative

- **Private CA cost ($400/mo)** is real. Acceptable for ADR-0015 isolation benefits.
- **JWT dual-key window** is operational complexity. Mitigated by automation.
- **30-day super_admin rotation** is friction. Worth it.
- **Cognito Advanced Security tier** adds per-MAU cost. Activated only if compromised-password detection matters; otherwise basic tier.

## Future plans

- **HashiCorp Vault evaluation** if multi-cloud comes up. Phase 3.
- **Secret-less inter-service** via IAM-only AWS auth (e.g. RDS IAM auth). Phase 2.
- **OIDC for staff-to-AWS** instead of long-lived programmatic credentials. Phase 2.
- **Hardware Security Module (HSM)** for the anchor wallet key when value justifies. Phase 3.
- **Automated rotation Lambdas** for provider keys when providers offer rotation APIs. Phase 2.
- **Per-tenant encryption keys (BYOK)** — enterprise customers bring their own KMS keys. Phase 3.
- **Detect-and-revoke leaked secrets** in real-time via GitHub secret scanning integration. Phase 2.
- **Vendor-side IP allowlisting** of our outbound IPs (NAT Gateway EIPs) — limits damage if a key leaks.

## Alternatives considered

| Option | Rejected because |
|---|---|
| HashiCorp Vault self-hosted | Operational burden too high for solo lead. AWS Secrets Manager is sufficient at our scale. |
| Doppler / 1Password Secrets | Adds third-party; KVKK paperwork; AWS-native preferred. |
| Encrypted `.env` files in git | Old-school; rotation impossible without redeploy; key management still required. |
| AWS Parameter Store (SSM) | Cheaper but lacks rotation features; we'd reinvent. |
| Public certs for `admin.relowa.local` | Impossible — `.local` is reserved; private CA is the only option. |
| Long-lived AWS keys in GitHub Secrets | Multiple OWASP-listed pitfalls; OIDC is the standard answer. |
| Skip Cognito Advanced Security | Loses compromised-password detection. Cost-benefit favors keeping it. |

## Reference

- ADR-0005 — Cognito authentication
- ADR-0006 — Outbox / AppSync (uses webhook HMAC for the AppSync publisher)
- ADR-0007 — Step Functions escrow (uses provider API keys)
- ADR-0008 — Arbitrum anchoring (anchor wallet key)
- ADR-0014 — Internal staff RBAC (staff Cognito-equivalent rotation)
- ADR-0015 — Admin tooling isolation (Private CA + VPN certs)
- ADR-0017 — Test strategy (JWT rotation tested in api-integration)
- ADR-0018 — Notifications (VAPID + SMS keys)
- ADR-0020 — Observability (KMS denied alarms)
- ADR-0021 — Backup & DR (Secrets Manager replication cross-region)
- ADR-0022 — Rate limiting (no direct secrets here)
- PRD-0006 — Provider integration (where provider keys are consumed)
- AWS Secrets Manager: https://docs.aws.amazon.com/secretsmanager/
- AWS Private CA: https://docs.aws.amazon.com/privateca/
