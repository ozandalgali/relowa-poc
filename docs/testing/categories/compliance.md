# Test category — Compliance (KVKK · CSRD · ESPR · WSR · TR sector)

**Status:** 📋 P1 manual checklist · P2 semi-automated assertions.
**Owner:** `compliance-specialist`.
**Runner:** Checklist (P1) → automated assertions where possible (P2).
**Location:** `docs/compliance/reviews/` and (P2) `tests/compliance/`.

## Purpose

Detect regulatory issues structurally, not via PR review-fatigue. Every change touching PII, money, audit, or ESG must be reviewed against the relevant regulations and the result captured in a dated review note.

## What this covers (P1 checklist scope)

| Regulation | Articles checked routinely |
|---|---|
| KVKK | m.4 (data minimization), m.5–6 (legal basis), m.12 (security measures), m.13 (data subject rights), m.16 (VERBİS), m.17 (cross-border) |
| CSRD | Annex I (sustainability info), Annex II (supply chain audit trail) |
| ESPR | Digital Product Passport requirements |
| WSR | Cross-border waste shipment traceability |
| TR sector | Çevre Lisansı, KVKK aydınlatma metni delivery, e-fatura (Nilvera/Foriba) |

## When invoked

Automatically when `lead-orchestrator` detects any trigger:

- PR touches `users`, `org_members`, `internal_staff`, `audit_events`, `admin_audit_log`, escrow tables, `material_recovery_certificates`, anything with IBAN / TC / phone / address / coordinates.
- New external service integration.
- Cross-border data flow change.
- Quarterly cadence (no trigger needed).

## Manual checklist (P1)

`compliance-specialist` runs the checklist in its skill file (`.opencode/skills/compliance-specialist.md`) and outputs a review note:

```
docs/compliance/reviews/2026-05-NN-<feature-slug>.md
```

The note's verdict is **pass / pass with conditions / block**. Block = PR cannot merge.

## Automated assertions (P2 graduation candidates)

Some checks can become real tests. Examples planned for P2:

| Assertion | How |
|---|---|
| No new column matches PII regex (IBAN, TC, phone, lat/lng) without compliance annotation | AST scan of `packages/db/src/schema.ts` in CI |
| No PII column appears in CloudWatch log filter patterns | grep over `infra/**/log-config.tf` |
| Aydınlatma metni acceptance row exists for every active user | SQL check in nightly job |
| Every `audit_events.action` matches a known action enum | Schema-level constraint or DB function |
| Data export endpoint returns < 30s for any single user | API integration test |
| Data deletion endpoint zeroes all rows within X days | scheduled job + assertion |
| All S3 buckets storing PII have Object Lock | IaC scan in CI |
| All RDS instances have encryption at rest | IaC scan |

These graduate to `tests/compliance/<assertion>.test.ts` as Vitest tests against the live dev account.

## Quarterly readiness audit (P1)

Before pilot / launch (and quarterly after):

1. Run all P1 checklist items against current production.
2. Verify all P2-graduated automated checks are passing.
3. Confirm anchor pipeline has emitted a Merkle root every day with no gaps.
4. Confirm data subject rights endpoints (export, deletion) work end-to-end on staging.
5. File `docs/compliance/reviews/YYYY-QQ-quarterly.md`.

## Non-negotiables

- ❌ Never sign off without writing the review note. A verbal "looks fine" doesn't exist.
- ❌ Never absorb a soft violation without conditions documented.
- ❌ Never quote a regulation article without verifying the citation (one mis-cited article erodes credibility).
- ✅ Always propose a remediation path; "block" without a way forward is a failure.
- ✅ Always link the review note from the PR that triggered it.

## See also

- `.opencode/skills/compliance-specialist.md` (the canonical specialist)
- `docs/compliance/` (the regulation reference shelf)
- ADR-0008 — Hash anchoring (regulatory rationale)
- ADR-0014 — Staff RBAC (admin_audit_log structure)
- PRD-0001 §Constraints (KVKK / EU residency commitment)
