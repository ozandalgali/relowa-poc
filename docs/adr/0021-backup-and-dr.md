# ADR-0021 — Backup, Disaster Recovery, RTO/RPO

**Status:** Accepted
**Date:** 2026-05-14
**Decision-makers:** Ozan (lead)

## Context

The platform's data has different recovery characteristics:

- **Postgres** is the system of record (ADR-0001). Loss = business death.
- **S3 buckets** contain tender photos, org documents, e-fatura PDFs, audit archive — varying criticality.
- **Cognito user pool** holds operator credentials.
- **Step Functions execution history** contains in-flight escrow workflows.
- **Secrets Manager / KMS** holds cryptographic material.
- **Arbitrum One anchor** is external; we don't back it up but we depend on its availability.

Without explicit RTO/RPO targets:
- We over-engineer some things and under-engineer others.
- A real incident reveals we have no plan and we improvise badly.
- Pilot customers cannot evaluate our reliability commitment.

## Decision

We adopt **explicit RTO/RPO targets** per data class with **AWS-native backup mechanisms**, **quarterly tested restore drills**, and a **single-region production** with **cross-region backup copies** for the highest-criticality data.

### 1. RTO/RPO targets

| Data class | RPO (max data loss) | RTO (max downtime) | Notes |
|---|---|---|---|
| **Postgres SoR** | 15 minutes | 4 hours | Drives the SLA |
| **Cognito user pool** | 24 hours | 8 hours | Re-create from RDS in worst case |
| **S3 audit-archive** | 24 hours | 24 hours | Cross-region replication, Object Lock preserves |
| **S3 tender-photos / org-documents** | 1 hour | 24 hours | Versioning + cross-region (org-docs only) |
| **S3 e-fatura** | 1 hour | 24 hours | Required by Turkish tax retention; cross-region |
| **S3 public-assets** | 7 days | 24 hours | Rebuildable from source repo |
| **Secrets Manager + KMS** | 0 (continuous) | 1 hour | AWS-managed; cross-region replicas |
| **Step Functions in-flight** | 0 (event-sourced from DB) | 8 hours | Re-creatable from `escrow_orders` state |
| **OutbOX queue** | 0 (DB-backed) | 2 hours | Re-creatable from `outbox` table |

**Phase 1 commitment to customers:** RPO 15 min, RTO 4 hours for the production system as a whole. Documented in pilot contracts and the SLA published in Help Center.

### 2. Postgres backup strategy

**Continuous protection:**
- RDS Multi-AZ in `eu-central-1` (synchronous replica in different AZ; auto-failover ~60s on primary failure).
- Continuous WAL backup to S3 (managed by RDS).
- Point-in-time recovery (PITR) window: 35 days.

**Daily snapshots:**
- RDS automated snapshots daily at 03:00 UTC (low-traffic).
- Retention: 35 days.
- Stored in `eu-central-1`.

**Cross-region snapshots:**
- Lambda daily replicates the most recent automated snapshot to `eu-west-1` (Ireland).
- Encryption maintained (KMS multi-region key).
- Retention in DR region: 14 days (cost balance).

**Manual snapshots before risky operations:**
- Pre-deploy of any schema migration → `manual-pre-migration-<commit_sha>` snapshot.
- Retained indefinitely until verified post-migration.
- Tag with `auto_delete=false` to prevent lifecycle cleanup.

### 3. Postgres restore procedures

Three documented scenarios with runbooks:

**Scenario A — Single-AZ failure (most likely):**
- AWS auto-fails-over to Multi-AZ replica in <60s.
- API connections drop briefly; reconnect via RDS endpoint DNS.
- No human action required.
- Customer impact: ~60s connection drops; alarms fire and clear.

**Scenario B — Region-wide failure or accidental destructive query:**
1. Decide RPO target: PITR to most-recent-valid timestamp.
2. Restore via AWS Console: `relowa-prod-<env>` → new instance `relowa-prod-restored-<date>`.
3. Apply latest migrations (idempotent per ADR-0017).
4. Verify integrity (`./tests/rls-isolation.sh` + audit-chain check).
5. Switch ECS task env variables to new RDS endpoint.
6. Drain old endpoint connections.
7. Verify with `tests/prod-smoke.sh`.
8. RTO target: 4 hours from decision-to-restore.

**Scenario C — `eu-central-1` total outage:**
1. Spin up RDS instance in `eu-west-1` from latest cross-region snapshot.
2. Update Route53 to point DNS to a `eu-west-1` ECS cluster (planned but not standing P1; spun up on demand).
3. RTO target: 12 hours (extended; documented). Phase 2 reduces to 4 hours via warm standby.
4. RPO target: 24 hours (last cross-region snapshot).

### 4. S3 backup strategy

**Versioning:**
- All buckets (except `public-assets`) have versioning enabled.
- Lifecycle: previous versions transitioned to Glacier after 30 days.
- Accidental deletions recoverable.

**Cross-region replication:**

| Bucket | CRR enabled | Target region | Why |
|---|---|---|---|
| `relowa-audit-archive-prod` | ✅ | `eu-west-1` | Legal evidence; survives regional disaster |
| `relowa-org-documents-prod` | ✅ | `eu-west-1` | 10-year retention required by law |
| `relowa-efatura-prod` | ✅ | `eu-west-1` | Turkish VUK m.253 — 10-year retention |
| `relowa-tender-photos-prod` | ❌ | n/a | Rebuildable from producer if needed; cost not justified |
| `relowa-public-assets-prod` | ❌ | n/a | Rebuildable from repo |

CRR replication time objective: <15 min for new objects.

**Object Lock** (Compliance mode):
- `relowa-audit-archive-prod` — 10 years
- `relowa-efatura-prod` — 10 years per Turkish law

Object Lock means even AWS root cannot delete. Use sparingly; only on data that cannot legally be deleted.

### 5. Cognito backup

Cognito User Pool has no native backup. We mitigate:

1. **Source of truth is RDS.** `users` table mirrors Cognito identifiers + email. Cognito acts as credential store + JWT issuer.
2. **Daily Lambda exports** Cognito user attributes (sub, email, status) to `relowa-cognito-backup-prod` S3 bucket. JSON Lines, encrypted.
3. **Recovery scenario:**
   - Create new User Pool with identical config (Terraform).
   - Bulk import users via `AdminCreateUser` (no passwords; users re-enroll via password reset).
   - Operators receive notification: "Please reset your password — security maintenance."
   - RTO: 8 hours (manual import + notification).

This is a partial recovery — passwords are lost. We accept this for P1; Phase 2 evaluates Cognito alternatives with backup story.

### 6. Step Functions + in-flight escrow

Step Functions execution state is ephemeral (90-day retention). Our DB is the source of truth:

- `escrow_orders.status` + `escrow_orders.state_machine_arn` together let us reconstruct in-flight workflows.
- On region failover, a recovery Lambda iterates `escrow_orders WHERE status NOT IN ('released', 'refunded', 'failed')`:
  - For each, start a new Step Function execution.
  - The state machine's first state checks DB; if already past that state, idempotently advances.
- This recovery is **not zero-touch**, but it works.

### 7. Outbox queue

The `outbox` table is the queue's source of truth (ADR-0006). Relay state (`published_at`) is in DB. After restore:
- Relay restarts; processes any unpublished rows.
- AppSync subscribers reconnect and miss-replay via the `since=<timestamp>` REST endpoint (ADR-0006 §9).
- No data loss; some duplicate events for subscribers (idempotency at consumer level).

### 8. Secrets Manager + KMS

- Secrets Manager supports cross-region replication (configured for all production secrets).
- KMS keys are multi-region (replica key in `eu-west-1`).
- Recovery: no action — replicas are continuously synced.

### 9. Backup verification & restore drills

**Monthly automated:**
- Lambda creates a fresh RDS instance from the most recent automated snapshot in dev account.
- Runs `tests/migration-smoke.sh` + `tests/rls-isolation.sh` against it.
- Tears down.
- Alarm if any step fails.

**Quarterly manual:**
- Documented restore drill (`docs/runbook/dr-quarterly-drill.md`, planned M0):
  - Pick a random restore scenario from the runbook.
  - `super_admin` performs the full procedure in dev account.
  - Measure RTO actual vs target.
  - File `docs/postmortems/YYYY-QQ-dr-drill.md` regardless of outcome.

If drilled RTO exceeds target, that's a P2 incident requiring infrastructure fix.

### 10. Compliance posture

- KVKK m.12 requires "appropriate measures" for data security. Documented backup + DR is part of demonstrating compliance.
- Audit immutability via Object Lock satisfies regulatory evidence requirements.
- Cross-region copies stay within EU (data residency preserved).
- 10-year retention on tax-relevant artifacts (e-fatura, audit) meets VUK m.253 + KVKK m.7 minimum-retention requirements.

### 11. What we explicitly accept as risk

| Risk | Why we accept |
|---|---|
| 15-min RPO for Postgres | Better RPO requires synchronous cross-region (expensive + latency cost). 15 min is industry-standard for B2B SaaS at our stage. |
| 4-hour RTO for full restore | Solo lead reality. With on-call rotation we'd target 1h. |
| Cognito password loss on region failover | Cognito's backup story is weak; we accept "reset on recovery" UX hit. Customer comms template ready. |
| `eu-central-1` total outage = 12h RTO | Warm standby in `eu-west-1` adds ~$400/mo. Not justified at pilot scale. Phase 2 if customer demands. |
| Cross-region IP egress costs | Acceptable at our scale (<$50/mo). |

### 12. Cost model

| Item | Pilot scale | 10x scale |
|---|---|---|
| RDS backups (included in instance cost) | $0 | $0 |
| Cross-region snapshot replication | $15/mo | $50/mo |
| S3 CRR (audit + docs + efatura) | $5/mo | $30/mo |
| S3 Object Lock (no incremental cost over storage) | $0 | $0 |
| Cognito backup S3 bucket | $0.10/mo | $1/mo |
| KMS multi-region replica | $1/mo | $10/mo |
| Cross-region snapshot Lambda | $0.50/mo | $1/mo |
| **Total** | **~$22/mo** | **~$90/mo** |

Acceptable at any scale.

## Consequences

### Positive

- **Targets are written down and customer-facing.** Pilot customers can evaluate, contracts can reference.
- **Backup mechanisms use AWS-native tools** — no third-party backup vendor in the trust chain.
- **Cross-region copy for legal-evidence data** — survives regional disaster.
- **Quarterly drills** ensure the procedure isn't theoretical.
- **Compliance posture is documented** — KVKK m.12 evidence-ready.
- **Cost is bounded and predictable.**

### Negative

- **Cognito recovery requires password reset** — UX hit on regional disaster. Mitigated by clear communication template + low probability.
- **No warm standby in P1** — `eu-central-1` regional outage = 12h RTO. Accepted; Phase 2 improves.
- **Quarterly drill is solo-lead-time-expensive** (~half day). Worth it.
- **Multi-region KMS has small fee per key**. Acceptable.

## Future plans

- **Warm standby in `eu-west-1`** when customer scale or contract demands. Reduces regional RTO to 4h. Phase 2.
- **Active-active cross-region** — Phase 3 if absolutely needed. Adds eventual-consistency complexity to RLS substrate.
- **Real-time replication to read replica** for low-RPO reporting workloads. Phase 2 if reports become heavy.
- **Backup integrity attestation** — sign monthly backup verification result with same Merkle approach as audit. Phase 2.
- **Auto-failover scripts** to reduce RTO from 4h to 1h. Phase 2 alongside on-call rotation hire.
- **Customer-initiated restore** — for enterprise tenants, "point-in-time restore for my org" as a self-service tool. Phase 3.
- **Cognito alternative** — evaluate Auth0/Keycloak hybrid for better backup story. Phase 2.

## Alternatives considered

| Option | Rejected because |
|---|---|
| pg_dump cron job | Inferior to RDS automated snapshots + PITR. |
| Custom WAL shipping to S3 | RDS already does this; reinventing is pointless. |
| Multi-region active-active | Adds eventual-consistency complexity; RLS substrate gets harder; not justified at scale. |
| Daily full restore drill | Too expensive; monthly automated + quarterly manual hits diminishing returns. |
| No cross-region anything | Single-region regulatory risk; legal evidence (audit archive) must survive regional events. |
| Bacula / Veeam | Heavy enterprise tooling; AWS-native is simpler and cheaper at our scale. |

## Reference

- ADR-0001 — Postgres SoR (what we're backing up)
- ADR-0008 — Arbitrum anchoring (the audit chain we replicate)
- ADR-0014 — Internal staff RBAC (super_admin executes restores)
- ADR-0015 — Admin tooling isolation (DR procedures live in admin tooling)
- ADR-0019 — File storage (S3 buckets covered here)
- ADR-0020 — Observability (alarms drive DR triggers)
- ADR-0023 — Secrets management (multi-region replication of secrets)
- PRD-0007 — Operations & support (SLA references RTO target)
- AWS RDS backup: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html
- S3 CRR: https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html
- Multi-Region KMS: https://docs.aws.amazon.com/kms/latest/developerguide/multi-region-keys-overview.html
