# PRD-0009 — Onboarding & Org Verification

**Status:** Accepted
**Date:** 2026-05-14
**Decision-makers:** Ozan (lead)

## Why this document exists

Every operator org (Producer, Recycler, Carrier) goes through:

1. **Registration** — initial sign-up with company info, primary user, role selection.
2. **Verification** — Relowa staff confirms the org is legitimate (Çevre Lisansı, Vergi numarası, KYC).
3. **Activation** — once verified, the org can transact.
4. **First-tender onboarding** — guided experience to reduce time-to-first-value.

Without explicit specs:
- Verification becomes ad-hoc and inconsistent.
- A bad-actor org could transact before staff catches it.
- New users abandon because the first-tender flow isn't guided.
- Çevre Lisansı validation (a Turkish regulatory requirement) gets missed and we ship non-compliant.

The Figma already shows registration flows (Batch 02). This PRD specifies the operational layer — what happens between "user fills the form" and "user creates their first tender."

## Decision

We adopt a **three-stage onboarding pipeline** with explicit owners, statuses, and SLAs at each stage.

```
Stage 1 — REGISTRATION (self-serve, instant)
  User submits form → org created with status='pending_verification'
  User can log in but sees a "Verification pending" gate.
                              ↓
Stage 2 — VERIFICATION (Relowa staff, ≤24h SLA)
  account-manager or super-admin reviews docs, vergi check, manual approval
  Org status → 'verified' OR 'rejected' (with reason)
                              ↓
Stage 3 — ACTIVATION (instant on verification)
  Welcome email + guided first-tender wizard
  Demo data available on sandbox env; production is real-data only
```

### 1. Registration data captured

Schema additions (deferred to M1 — already partially exists):

```sql
-- Add to existing organizations table
ALTER TABLE organizations ADD COLUMN status TEXT NOT NULL DEFAULT 'pending_verification';
-- Allowed values: 'pending_verification' | 'verified' | 'rejected' | 'suspended'

ALTER TABLE organizations ADD COLUMN status_reason TEXT;
ALTER TABLE organizations ADD COLUMN verified_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN verified_by UUID REFERENCES internal_staff(id);
ALTER TABLE organizations ADD COLUMN onboarding_step TEXT;
-- 'registration_complete' | 'awaiting_verification' | 'verified_no_first_tender' | 'active'

-- Existing: vergi_no, region, type, name, address

-- New table: registration documents uploaded by the org
CREATE TYPE org_doc_type AS ENUM (
  'cevre_lisansi',           -- Environmental License (recyclers, carriers)
  'vergi_levhasi',           -- Tax registration certificate
  'imza_sirkuleri',          -- Signature circular (legal authority proof)
  'faaliyet_belgesi',        -- Trade registry activity certificate
  'k1_belgesi',              -- K1 license (carriers carrying hazardous waste)
  'iso_14001',               -- ISO 14001 certification (optional)
  'other'
);

CREATE TABLE org_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  doc_type        org_doc_type NOT NULL,
  doc_label       TEXT,                                 -- "Çevre Lisansı 2026"
  s3_key          TEXT NOT NULL,                        -- presigned upload path
  uploaded_by     UUID REFERENCES users(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by     UUID REFERENCES internal_staff(id),
  reviewed_at     TIMESTAMPTZ,
  review_status   TEXT,                                 -- 'pending' | 'approved' | 'rejected'
  review_notes    TEXT,
  expires_at      TIMESTAMPTZ                           -- some licenses have expiry; null = perpetual
);

CREATE INDEX org_documents_org_idx ON org_documents(org_id);
CREATE INDEX org_documents_review_idx ON org_documents(review_status) WHERE review_status = 'pending';
```

### 2. Registration flow (Stage 1 — self-serve)

Per Figma Batch 02 (`Relowa - Kayıt`).

**Common to all org types:**
- Email + password (Cognito)
- Phone number (for SMS verification, ADR-0018)
- KVKK aydınlatma metni acceptance (timestamped in `users.kvkk_accepted_at`)
- Org type selection: Producer / Recycler / Carrier (`Relowa - Rol Seçimi`)
- Org legal name
- Vergi numarası (10–11 digit Turkish tax ID)
- Vergi dairesi (tax office)
- Primary address + region
- Authorized signatory name + role

**Producer-specific** (`Relowa - Kayıt (Atık Üreticisi)`):
- Industry sector dropdown
- Expected waste output (rough tonnage/month — drives suggested tender size)
- Primary waste material types (multi-select, drives marketplace matching)

**Recycler-specific** (`Relowa - Kayıt (Geri Dönüşüm Tesisi)`):
- Çevre Lisansı number (validated for format)
- Çevre Lisansı upload (`org_documents.doc_type = 'cevre_lisansi'`)
- Accepted waste codes (multi-select from EAEK/Atık Kodları list — Turkish hazardous + non-hazardous waste codes)
- Processing capacity (tonnage/month)

**Carrier-specific** (`Relowa - Taşıyıcı Kayıt`):
- Carrier type: Individual (Bireysel) or Fleet (Filo)
- K1 license number + upload (for hazardous waste transport)
- Vehicle types operated (multi-select)
- Service regions
- Fleet size (if applicable)

### 3. OTP / phone verification

After form submission:

- SMS OTP sent to phone number (via SMS provider per ADR-0018).
- User enters 6-digit code.
- On success: `users.phone_verified_at` set; user logged in.

Failure modes:
- 5 failed attempts → lock for 1 hour.
- Code expires after 10 minutes.
- Maximum 3 SMS sends per hour per phone number (abuse prevention, ADR-0022).

### 4. Verification flow (Stage 2 — Relowa staff)

`super_admin` (Phase 1) or `account-manager` (later) handles via admin panel.

**Admin verification queue** at `/admin/organizations?status=pending_verification`:

```
For each pending org, the queue shows:
- Org name, type, vergi_no, region
- Time since registration
- Uploaded documents count + types
- Primary user contact
- Vergi number validity check (format only — no external API call in P1)
- Action: [Review] → opens detail view
```

**Detail review** at `/admin/organizations/[id]/verify`:

```
1. Vergi number format check (10 digits = individual, 11 digits = corporate)
2. Document review:
     - Each org_documents row marked approved/rejected with notes
     - Çevre Lisansı number cross-checked against uploaded doc
     - K1 license validated for carrier type
3. Optional: external check via Türkiye Ticaret Sicili (manual lookup in P1; automated in P2 if API access)
4. Decision: Approve / Reject (with reason) / Request more info
5. On approve:
     - UPDATE organizations SET status='verified', verified_at=now(), verified_by=<staff_id>
     - Triggers welcome email + activation notifications (ADR-0018)
     - Writes admin_audit_log with reason
6. On reject:
     - UPDATE organizations SET status='rejected', status_reason=<text>
     - Email to primary user with rejection reason + appeal process
     - Writes admin_audit_log
7. On request more info:
     - Status stays pending_verification
     - Email to user listing what's needed
     - Writes admin_audit_log
```

**SLA: 24h response** on verification queue (PRD-0007 P2 severity).

### 5. Rejection appeal

A rejected org can:

1. Read the rejection reason in `/ayarlar` (gated UI shows the appeal flow).
2. Upload additional documents.
3. Click "Submit appeal" — sets status back to `pending_verification` with a flag `appealed = true`.
4. Admin reviews again. SLA: 48h on appeals (more deliberate review).

Max 3 appeals per org. After that, account is locked; account requires direct email contact.

### 6. Activation & first-tender wizard (Stage 3)

On verified status:

**Welcome email** (per ADR-0018):
- Subject: "Relowa hesabınız onaylandı — ilk ihalenizi oluşturun"
- CTA button → `/ihaleler/yeni?onboarding=true`

**First-tender wizard** (Producer; analogous for Recycler/Carrier):
- Top banner: "Adım 1 / 3 — Atık bilgilerinizi girin"
- Pre-filled with the materials selected at registration.
- Side panel: "Bu ihale yayınlandığında ~25 tesise bildirim gidecek." (data-driven; counts recyclers in their region accepting that material)
- After publish: success modal with "Sıradaki adım: Teklifleri canlı izleyin" → `/canli-ihale-takip`

**Empty-state design** per Figma:
- Marketplace empty: "Pazar yerinde henüz ihale yok. Üretici eklendikçe burada görünecek."
- Operations empty: "Henüz aktif sevkiyat yok. İlk ihalenizden sonra burada izleyebilirsiniz."

**Onboarding completion tracking:**

```sql
ALTER TABLE organizations ADD COLUMN onboarding_step TEXT;
-- Values:
-- 'registration_complete'           -- Stage 1 done
-- 'awaiting_verification'           -- Stage 2 in queue
-- 'verified_no_first_tender'        -- Stage 3 not started
-- 'first_tender_drafted'            -- created but not published
-- 'first_tender_published'          -- M2 trigger; onboarding "complete"
-- 'active'                          -- has > 1 tender lifecycle
```

PostHog events fire per stage (per ADR-0020) to power funnel analytics.

### 7. Sandbox vs production

- **Sandbox** (a separate env, e.g. `sandbox.relowa.com`):
  - Demo data populates marketplace with 5 fake tenders so first-tender wizard has context.
  - Verification auto-approved.
  - Sandbox accounts cannot transact real money (Manual provider only).
  - Sandbox marked with high-contrast banner.

- **Production** (`app.relowa.com`):
  - No demo data. Empty states use copy that explains "as platform grows, you'll see X here."
  - Full verification required.

### 8. KVKK at onboarding

Per ADR-0005 §7 and PRD-0007 §4:

- KVKK aydınlatma metni is shown at registration (Figma shows checkbox in `Kayıt` flow).
- Acceptance timestamped in `users.kvkk_accepted_at`.
- Unable to complete registration without accepting.
- The aydınlatma metni text is final-reviewed by legal before pilot launch.

### 9. The "verification pending" gate

Between Stage 1 and Stage 2, a user can log in but:

- Sees a top banner: "Hesabınız onay bekliyor (~24 saat)."
- Sidebar items active: Dashboard (read-only), Ayarlar, Yardım Merkezi.
- Sidebar items disabled: İhale Oluştur, Pazar Yeri, Operasyon Takip.
- Help link: "Verification süreci hakkında" → modal explaining the process.

This converts the wait into transparent expectation, not silent confusion.

### 10. Suspended status

`super_admin` can set `organizations.status = 'suspended'` with a `status_reason`. Effects:

- All API endpoints reject mutations with 403.
- Read access preserved (so they can see their own data + appeal).
- In-app banner: "Hesabınız askıya alındı: [reason]. [Destek talebi oluştur]"
- Audit log entry mandatory.

Use cases: regulatory issue, payment dispute, abuse pattern.

### 11. RBAC additions

| Permission | Risk | Role assignments |
|---|---|---|
| `org:verify` | medium | super_admin, account_manager (in assigned orgs only) |
| `org:reject` | medium | Same |
| `org:suspend` | high | super_admin only |
| `org:request_info` | low | super_admin, account_manager (assigned), support_agent (assigned) |

ADR-0014 amendment: these go into `staff_permissions`.

### 12. Operational metrics

Tracked in PostHog + CloudWatch:

| Metric | Target | Source |
|---|---|---|
| Time registration → verification submission | < 15 min | PostHog funnel |
| Time verification submission → decision | < 24h (P2 SLA) | `verified_at - registered_at` |
| Verification approval rate | > 80% | `count(verified) / count(decided)` |
| Time verified → first tender published | < 7 days | Funnel between onboarding_step values |
| Rejection appeal success rate | (tracked, no target) | Manual review |
| Sandbox-to-production conversion (pilots) | > 50% | Manual |

## Consequences

### Positive

- **Verification is structural.** No "I'll check that later" — staff has a queue, an SLA, and a paper trail.
- **Çevre Lisansı + K1 are first-class** — regulatory documents are tied to org type at registration.
- **First-tender experience is guided.** Reduces "I signed up but never used it" abandonment.
- **Onboarding stages are queryable.** `onboarding_step` powers funnel analytics + retention conversations.
- **Suspended status is explicit.** Halts mutation, preserves data, supports KVKK obligations.

### Negative

- **24h verification SLA is solo-lead-dependent** (PRD-0007). If volume spikes, queue grows. Mitigation: scale by hiring an `account-manager` early.
- **Document review is manual** — no automated Çevre Lisansı validation against the Turkish ministry's registry (no public API). Mitigation: visual review.
- **Bad actors can register, sit in queue, never get verified** — they consume DB rows. Mitigation: auto-purge `pending_verification` orgs older than 30 days with no document upload.

## Future plans

- **Automated vergi check** — if/when the Gelir İdaresi Başkanlığı offers a stable API for taxpayer status verification. Phase 2.
- **Automated Çevre Lisansı validation** — same; if Çevre Bakanlığı offers a registry API. Phase 2.
- **Identity verification (KYC)** for primary signatory — Phase 2 if regulatory pressure increases.
- **OAuth-style "Login with vergi sicili"** — Türkiye Cumhuriyeti's e-Devlet integration. Phase 3.
- **Tiered verification** — basic (self-attest) vs full (document review). Allows fast onboarding for low-risk tenders. Phase 2.
- **Auto-rejection** of obvious bad data (mismatched vergi format, expired license dates). Phase 2.
- **Verification SLA tiers** — enterprise customers can pay for "express verification" (4h SLA). Phase 3.
- **Org switching for multi-org users** — registration supports a single org; subsequent invitations to a second org go through different flow. Phase 1 supports via invitations (ADR-0005 §5).

## Reference

- ADR-0005 — Cognito authentication (registration flow)
- ADR-0014 — Internal staff RBAC (who can verify)
- ADR-0015 — Admin tooling isolation (where verification UI lives)
- ADR-0018 — Notifications (welcome emails, OTP, SMS)
- ADR-0019 — File storage (document uploads)
- ADR-0022 — Rate limiting (SMS abuse prevention)
- PRD-0001 — Vision (KVKK, Çevre Lisansı references)
- PRD-0007 — Operations & support (SLA enforcement)
- Figma batch 02 — `docs/figma/extracted/batch-02-auth.json`
