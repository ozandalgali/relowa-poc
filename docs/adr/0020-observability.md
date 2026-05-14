# ADR-0020 — Observability

**Status:** Accepted
**Date:** 2026-05-14
**Decision-makers:** Ozan (lead)

## Context

A solo lead cannot stare at logs. The substrate must surface what matters automatically:

- **Errors that hurt customers.** Crashed page loads, failed bid placements, escrow stuck.
- **Performance degradations.** API p95 climbing, AppSync backlog, outbox lag.
- **Business events that need attention.** First tender of a new producer, large escrow flagged for review, KVKK request received.
- **Security signals.** Unusual login geography, repeated auth failures, suspect admin actions.
- **Cost spikes.** AWS bill anomaly before it becomes a problem.

Without a unified observability story:
- Errors hide in logs nobody reads.
- The first sign of trouble is a customer email.
- Postmortems lack data to root-cause.
- Compliance demands an audit trail we don't have.

## Decision

We adopt a **three-tool stack** with clear ownership of each concern:

| Tool | Owns | EU residency |
|---|---|---|
| **Sentry** (EU instance) | Errors & exceptions, performance traces | Yes — `sentry.io/eu/` |
| **PostHog** (EU instance) | Product analytics, funnels, session replay | Yes — `eu.posthog.com` |
| **CloudWatch + AWS-native** | Infrastructure metrics, logs, alarms, billing | Native to `eu-central-1` |

All three are EU-resident. No data leaves the EU. No third-party PII processor outside the EU.

### 1. Sentry (errors)

**Coverage:**
- `apps/web` — browser errors + RSC errors + JS exceptions.
- `apps/admin` — same.
- `apps/api` — Hono handler exceptions + Drizzle errors + uncaught.
- `apps/lambdas/*` — Lambda invocation errors.

**Configuration:**
- DSN per app, separate projects: `relowa-web`, `relowa-admin`, `relowa-api`, `relowa-lambdas`.
- Sample rate: 100% errors, 10% performance traces (cost control).
- Release tracking: SHA-tagged on every deploy (sourcemaps uploaded).
- Environment: `dev`, `staging`, `prod`.
- Org-level access via SSO (IAM Identity Center → Sentry SAML).

**PII scrubbing:**
- `beforeSend` hook strips: emails, phones, IBANs, JWT tokens, password fields, idempotency keys.
- Regex-based scrubbing in Sentry's data scrubbing config.
- Allowlist for IDs (org_id, tender_id) — these are not PII once tokenized.
- KVKK compliance: explicit data-processing agreement with Sentry EU; documented in `docs/compliance/data-processing-agreements/`.

**Alerts:**
- Spike: 10+ errors of same fingerprint in 5 minutes → Slack alert.
- New regression: error that didn't exist in prior release → Slack alert.
- High-volume regression: 100+ errors/hour of one fingerprint → PagerDuty.

### 2. PostHog (product analytics)

**Coverage:**
- `apps/web` — page views, button clicks, funnel events.
- `apps/admin` — staff actions for activity tracking.
- Backend events forwarded from outbox-derived business events.

**Configuration:**
- EU instance: `eu.posthog.com`.
- Project per app.
- Session recording: disabled in P1 (KVKK risk; revisit P2 with explicit consent).
- Feature flags: enabled — used for gradual rollouts (env switching in ADR-0006 is one example).

**Event taxonomy (~30 canonical events):**

```ts
// packages/analytics/events.ts
export const ANALYTICS_EVENTS = {
  // Auth
  'auth.signup_started':            { props: ['org_type'] },
  'auth.signup_completed':          { props: ['org_type', 'org_id'] },
  'auth.otp_requested':             { props: [] },
  'auth.otp_verified':              { props: [] },
  'auth.login_success':             { props: [] },
  'auth.login_failure':             { props: ['reason'] },
  'auth.kvkk_accepted':             { props: [] },

  // Onboarding
  'onboarding.docs_uploaded':       { props: ['doc_type'] },
  'onboarding.verification_submitted': { props: [] },
  'onboarding.verified':            { props: ['days_to_verify'] },
  'onboarding.rejected':            { props: ['reason'] },
  'onboarding.first_tender_drafted': { props: [] },
  'onboarding.first_tender_published': { props: ['days_since_verified'] },

  // Marketplace
  'tender.created':                 { props: ['material_type', 'tonnage_bucket'] },
  'tender.published':               { props: ['material_type', 'tonnage_bucket'] },
  'tender.bid_received':            { props: ['bid_count_at_time'] },
  'tender.won':                     { props: ['final_price_bucket', 'auction_duration'] },
  'marketplace.filter_used':        { props: ['filter_key'] },

  // Logistics
  'carrier_ad.created':             { props: [] },
  'carrier_ad.bid_received':        { props: [] },
  'carrier_ad.awarded':             { props: [] },
  'shipment.delivered':             { props: [] },

  // Finance
  'escrow.funded':                  { props: ['amount_bucket'] },
  'escrow.released':                { props: ['amount_bucket'] },
  'invoice.viewed':                 { props: [] },
  'invoice.exported':               { props: ['format'] },

  // ESG
  'esg.report_generated':           { props: ['period'] },
  'esg.certificate_downloaded':     { props: [] },

  // System
  'page.viewed':                    { props: ['route', 'duration_ms'] },
  'error.shown':                    { props: ['error_code'] },
} as const;
```

**Funnels** (preconfigured in PostHog):
- Signup → Verified → First tender published
- Tender published → bid received → won → funded → settled
- Recycler signup → first carrier ad → first shipment delivered

**KVKK considerations:**
- No PII in event properties (use `org_id`, never `org_name`).
- Bucket numeric values (`tonnage_bucket` instead of `12.5`) to prevent inference.
- IP addresses anonymized at PostHog level.
- Data-processing agreement signed; documented.

### 3. CloudWatch + AWS-native

**Logs:**
- ECS Fargate task stdout/stderr → CloudWatch Logs.
- Lambda logs → CloudWatch Logs.
- Retention: dev 30 days, prod 90 days.
- Log group naming: `/ecs/relowa-{app}/{env}`, `/aws/lambda/relowa-{function}-{env}`.
- Structured logging via `pino` with redaction for PII:

```ts
import pino from 'pino';
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['*.email', '*.phone', '*.iban', '*.password', 'req.headers.authorization', '*.token'],
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
});
```

**Metrics (CloudWatch dashboards):**

Three dashboards, owned by `ci-cd-engineer`:

**Dashboard: `relowa-infra`**
- RDS: CPU, connections, replication lag, disk IOPS, query latency p95/p99
- ElastiCache: hit rate, evictions, memory usage
- ECS Fargate: task count, CPU/mem per service, ALB target health
- Lambda: invocations, errors, duration p50/p95/p99, concurrent executions
- S3: bucket size per bucket, request rates, KMS calls
- SQS: queue depth (the canary for relay lag)

**Dashboard: `relowa-business`**
- Active tenders by status
- Bids/hour rate
- Escrow funds locked total
- Escrow disputes open
- KVKK requests pending count
- Verification queue depth

**Dashboard: `relowa-cost`**
- Daily AWS bill estimate
- Per-service breakdown
- Anomaly indicators (>20% week-over-week)

**Alarms (CloudWatch → SNS → PagerDuty / Slack):**

| Alarm | Threshold | Severity | Routing |
|---|---|---|---|
| API p95 latency | > 500ms for 10 min | P2 | Slack |
| API 5xx rate | > 1% for 5 min | P1 | PagerDuty |
| RDS CPU | > 80% for 15 min | P2 | Slack |
| RDS connections | > 80% of max | P2 | Slack |
| RDS replication lag | > 60s | P2 | Slack |
| Outbox queue depth | > 1000 messages | P2 | Slack |
| Outbox relay lag | > 5 min between row insert and publish | P1 | PagerDuty |
| Escrow Step Function failures | > 0 in 5 min | P1 | PagerDuty |
| Auth Lambda errors | > 5 in 5 min | P1 | PagerDuty |
| Cognito Pre-Token-Generation cold start p95 | > 200ms | P3 | Slack |
| ECR push failures | > 0 in deploy | P2 | Slack |
| Daily anchor Lambda failure | > 0 days | P1 | PagerDuty + email |
| KMS denied request | > 0 | P1 | PagerDuty (security signal) |
| Failed login spike | > 100/hr | P2 | Slack (security signal) |
| AWS bill estimate | > $500/mo dev, > $5000/mo prod | P3 | Slack |

### 4. X-Ray distributed tracing

- Enabled on Lambda + Hono API + Step Functions.
- 5% sample rate in P1 (cost control).
- Service map view for end-to-end request traces.
- Useful for "tender publish slow" debugging: trace covers API → DB → outbox → relay → AppSync.

### 5. Synthetic monitoring (P1 light, P2 full)

- **P1:** A single CloudWatch Synthetics canary every 5 min hitting `https://app.relowa.com/health` and `https://api.relowa.com/health`. If it fails twice, P1 alarm.
- **P2:** Playwright canary running the auction-lifecycle E2E test (subset) every 30 min in prod against a synthetic-only test org.

### 6. Status page

`status.relowa.com` (planned M5, hosted on Statuspage.io or self-hosted alternative):

- Auto-updated by CloudWatch SNS → Statuspage webhook on P1 alarm.
- Manual updates by `super_admin` during incidents.
- Components: API, Web app, Admin panel, Escrow, Realtime, e-fatura, AI scan, anchor pipeline.

### 7. Logs → metrics extraction

Specific log patterns get extracted to CloudWatch metrics for graphing:

- `"audit_chain_break"` → AuditChainBreaks metric → P1 alarm
- `"escrow.released"` → EscrowReleasedDaily metric → business dashboard
- `"admin.impersonation.start"` → AdminImpersonations metric → compliance dashboard
- `"kvkk.request_received"` → KvkkRequests metric → operations dashboard

### 8. Distributed log correlation

Every request gets a `request_id` (UUID) added by Hono middleware:

```ts
app.use(async (c, next) => {
  const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
  c.set('requestId', requestId);
  c.res.headers.set('x-request-id', requestId);
  logger.info({ requestId, method: c.req.method, path: c.req.path }, 'request started');
  await next();
});
```

The `requestId` flows into Sentry as tag, into PostHog as event property, into CloudWatch as log field. Cross-tool drill-down: from a Sentry error → grab requestId → search CloudWatch logs → see business event in PostHog timeline.

### 9. KVKK & data residency

- Sentry EU + PostHog EU + AWS `eu-central-1` — all data EU.
- DPAs signed with Sentry + PostHog before production sends start.
- PII scrubbing at source — neither Sentry nor PostHog sees raw email/phone/IBAN.
- Data retention: Sentry 90 days, PostHog 1 year (in-app analytics; configurable), CloudWatch 30/90 days.
- Customer data export (KVKK m.13) does NOT include observability data — these are operational logs, not customer-record data.

### 10. Cost model

| Tool | Cost (pilot) | Cost (10x pilot) |
|---|---|---|
| Sentry EU Team plan | $26/mo (Team, 50k events/mo) | $80/mo (Business plan) |
| PostHog EU Self-hosted | $0 if usage < 1M events/mo | $450/mo (Cloud) at scale |
| CloudWatch | ~$20/mo (logs + metrics + alarms) | ~$100/mo |
| X-Ray | ~$3/mo at 5% sample | ~$20/mo |
| Statuspage | $29/mo for the cheapest tier | $29/mo |
| **Total** | **~$80/mo** | **~$680/mo** |

PostHog self-hosted option exists if cost scales badly. Sentry alternatives (GlitchTip self-hosted) exist if Sentry pricing changes.

### 11. Dashboards in `apps/admin`

Internal staff dashboards live in admin app, embedding CloudWatch metrics + PostHog charts via iframe with SAML SSO. No re-implementation; we trust the source tools' UIs.

## Consequences

### Positive

- **One known place per concern.** Sentry for errors, PostHog for behavior, CloudWatch for infra.
- **EU-resident across the board** — no KVKK paperwork for data residency.
- **PII scrubbed at source** — observability tools never see sensitive fields.
- **Cross-tool correlation via `request_id`** — debug across boundaries.
- **Alarms classified by severity** — P1 to PagerDuty (waking Ozan), P2/P3 to Slack (handled in working hours).
- **Status page closes the loop with customers** — they see incidents in real-time.

### Negative

- **Three tool subscriptions** ≈ $80/mo at pilot scale. Not free. Mitigated by EU SaaS pricing being saner than US.
- **Log redaction is best-effort** — a new field forgets redaction config. Mitigated by Sentry's secondary scrubbing + regular review.
- **Sample rates** (10% perf, 5% X-Ray) miss some events. Acceptable trade for cost.
- **PostHog session replay disabled** — loses some UX debugging power. Mitigated by careful event taxonomy.

## Future plans

- **Session replay enabled P2** with explicit user opt-in per KVKK consent flow.
- **OpenTelemetry adoption** — currently AWS-native + Sentry-specific tracing. OTel would unify. Phase 2.
- **Real-User Monitoring (RUM)** — Sentry has it; enable on `apps/web` Phase 2.
- **Anomaly detection on metrics** — CloudWatch Anomaly Detection on the key business metrics. Phase 2.
- **Cost anomaly alarms** — AWS Cost Anomaly Detection. Phase 2.
- **Log ML** — CloudWatch Logs Insights queries automated. Phase 3.
- **External APM** if performance debugging becomes the lead's primary work — Phase 3.
- **Synthetic mobile checks** when carrier driver app launches. Phase 2.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Datadog | Best-in-class but expensive; US-based default; KVKK paperwork higher friction. |
| Honeycomb | Excellent for trace exploration; lacks frontend coverage; pricier; US default. |
| ELK self-hosted | Operational burden too high for solo lead. |
| Grafana Cloud (EU) | Strong contender; we may revisit. Sentry's frontend story is better. |
| New Relic | Same arguments as Datadog. |
| Self-hosted Sentry + PostHog | Operational burden; both offer EU SaaS — use it. |

## Reference

- ADR-0001 — Postgres SoR (operational data we don't ship to observability)
- ADR-0006 — Outbox (relay lag is a key metric)
- ADR-0014 — Internal staff RBAC (admin actions feed compliance dashboard)
- ADR-0018 — Notifications (delivery rate is a metric)
- ADR-0023 — Secrets management (KMS denied requests are security alarms)
- PRD-0007 — Operations & support (alarms feed incident response)
- Sentry EU: https://sentry.io/eu/
- PostHog EU: https://eu.posthog.com
- CloudWatch: https://docs.aws.amazon.com/AmazonCloudWatch/
