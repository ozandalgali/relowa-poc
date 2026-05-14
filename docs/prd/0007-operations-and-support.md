# PRD-0007 — Operations & Support

**Status:** Accepted
**Date:** 2026-05-14
**Decision-makers:** Ozan (lead)

## Why this document exists

Engineering plans cover *how the system works*. They do not cover *what happens when a customer emails at 2am*, *who answers a KVKK data-subject request*, *how a stuck escrow gets unstuck*, or *what SLA a producer expects when a tender goes wrong*.

For a solo-lead pilot, these questions are easy to under-specify and easy to over-promise. Both fail. This PRD names the operational floor: what we will commit to in writing, what we will not, and how the agent team supports it.

## Decision

We define the operational floor for Phase 1 pilot + first 6 months of production, organized into six contracts:

1. **Support SLA** — response and resolution targets per severity.
2. **Escalation path** — who reaches whom for what.
3. **On-call coverage** — solo lead, honest about it.
4. **KVKK request handling** — data-subject rights operational flow.
5. **Incident response** — when production breaks.
6. **Customer-facing communications** — how we talk to users in trouble.

## 1. Support SLA

The SLA is **published to users** in the Help Center and in customer contracts. We commit only to what we can deliver.

| Severity | Definition | First response | Resolution target | Hours |
|---|---|---|---|---|
| **P1 — Critical** | Production down, money flow stuck, data leak suspected, regulatory escalation | 4 hours | 24 hours | 24/7 (best-effort solo) |
| **P2 — High** | Specific user can't complete a flow (login, create tender, place bid); auction stuck | 8 hours | 48 hours | Business hours (08–20 TRT, Mon–Fri) |
| **P3 — Normal** | Question, feature request, non-blocking bug | 24 hours | 5 business days | Business hours |
| **P4 — Low** | Documentation, cosmetic, "how do I" | 48 hours | 10 business days | Business hours |

**Why "best-effort solo" on P1:** A solo lead cannot truthfully commit to 24/7 paged coverage. We name it explicitly. Phase 2 hires a second on-call.

**What's NOT covered by SLA:**

- Third-party provider outages (Iyzico, Nilvera, AWS, Greyparrot). We surface status, we don't accelerate resolution.
- Pilot-tier customers get pilot-tier SLA — explicit in their contract.
- Custom feature requests are not bugs; they go through product backlog.

## 2. Escalation path

Three tiers. Each tier has a clear handoff trigger.

```
Tier 1 — Customer initiates contact
   ↓ Help Center ticket OR support@relowa.com OR in-app chat
   ↓
Tier 2 — support-agent staff handles
   ↓ Reviews ticket, checks runbooks, replies, may impersonate (with reason)
   ↓
Tier 3 — Escalation when:
   ↓   • Issue spans multiple tenants
   ↓   • Compliance / KVKK / legal implication suspected
   ↓   • Escrow stuck > 24h
   ↓   • Security incident suspected
   ↓
account-manager or compliance-officer or super-admin
   ↓
Tier 4 — Engineering escalation (Ozan + relevant agent squad)
   ↓ When operational fix requires code change
   ↓
Tier 5 — Outside counsel / regulator notification
   ↓ Only on confirmed compliance breach or data leak
```

The handoff between tiers is **explicit and logged** in `admin_audit_log` (ADR-0014). No "I emailed it to engineering" without a ticket.

### Tier responsibilities

| Tier | Who | Can do | Cannot do |
|---|---|---|---|
| 1 | Customer (self) | Submit ticket, search Help Center, AI assistant | n/a |
| 2 | `support-agent` (when staff exists) | Reply, close tickets in assigned orgs, view aggregate data, run readonly diagnostics | Impersonate (no `org:impersonate` permission), touch money, force-close auction |
| 3a | `account-manager` | Impersonate operator in assigned org (with reason), edit profile on behalf | Force-close auction, manual escrow release |
| 3b | `compliance-officer` | Read audit logs, export KVKK data, sign off on regulatory breaches | Mutate any operational data |
| 4 | `super-admin` | Anything in `staff_permissions` catalog (ADR-0014) | Skip the `reason` field on any action |
| 5 | Outside counsel | Advisory; cannot touch production directly | n/a |

## 3. On-call coverage

**Phase 1 honest reality:** Ozan is on-call for P1 incidents. There is no rotation. Phase 2 hires a second engineer.

**What this means concretely:**

- **P1 alarm fires** → PagerDuty (or AWS SNS → SMS) reaches Ozan within 5 minutes. Acknowledgement target: 15 minutes.
- **P1 ack and triage** → 1 hour to first useful diagnostic; 4 hours to first customer communication.
- **Vacation/unavailable** → P1 customers are informed in advance via the status page; pilot contracts include a max-2-week no-coverage window per quarter. Phase 1 customers know we're solo; they signed for it.
- **Status page** at `status.relowa.com` (planned in M5) shows incident state. Even when Ozan is asleep, the customer sees "investigating" within 15 minutes via automated alarm-triggered status updates.

**Phase 2 trigger:** Once paying customer count crosses 10, or any single contract requires <2h P1 response, a second on-call hire is required before the contract signs.

## 4. KVKK request handling

KVKK m.13 grants data subjects six rights. Each has an operational flow.

| KVKK Right | What customer requests | Operational flow | SLA | Owner |
|---|---|---|---|---|
| Bilgi alma (information) | "What data do you have on me?" | Generate machine-readable export via `GET /me/data-export`; email when ready | 7 days | self-serve + monitored by `compliance-officer` |
| Erişim (access) | Same as above | Same | 7 days | Same |
| Düzeltme (rectification) | "Fix my address" | Self-serve via `/ayarlar` UI | Immediate | self |
| Silme (erasure) | "Delete my account" | `compliance-officer` reviews → `super-admin` executes via soft delete + Cognito delete + audit anonymization (ADR-0005 §7) | 30 days | `compliance-officer` + `super-admin` |
| İşlemenin sınırlandırılması (restriction) | "Stop processing my data temporarily" | Mark `users.is_active = false` + `org_members` suspended | 7 days | `compliance-officer` |
| İtiraz (objection) | "I object to automated decision-making" | Currently no automated decisions affecting users adversely (AI scan is advisory only). Documented response template. | 14 days | `compliance-officer` |

### KVKK request intake

Three channels, all funneled to the same queue:

1. **In-app form** at `/ayarlar/kvkk-talep` (planned M5) — captures request type, context, identity verification.
2. **Email** to `kvkk@relowa.com` — manually filed by `support-agent`.
3. **Postal mail** — required by KVKK; manually filed.

Every request creates a `kvkk_requests` row (schema deferred to M5):

```sql
CREATE TYPE kvkk_request_type AS ENUM (
  'information', 'access', 'rectification', 'erasure', 'restriction', 'objection'
);

CREATE TABLE kvkk_requests (
  id            UUID PRIMARY KEY,
  user_id       UUID REFERENCES users(id),       -- null if pre-account
  email         TEXT NOT NULL,                    -- the requester's contact
  request_type  kvkk_request_type NOT NULL,
  status        TEXT NOT NULL,                    -- 'received' | 'verifying' | 'in_progress' | 'completed' | 'rejected'
  reason        TEXT,                             -- if rejected
  channel       TEXT NOT NULL,                    -- 'app' | 'email' | 'mail'
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at  TIMESTAMPTZ,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

Every request status change writes to `admin_audit_log` with the responsible staff member's reason.

### Templates

Stock responses in `docs/compliance/templates/`:

- `kvkk-acknowledgement.md` — "we received your request, here's the SLA"
- `kvkk-information-response.md` — covers the export delivery
- `kvkk-erasure-confirmation.md` — covers the deletion confirmation, retention notice (audit log retained per regulatory minimum)
- `kvkk-rejection-with-reason.md` — when request is outside our scope

All templates Turkish-primary, English secondary. Lawyers review templates before first use.

## 5. Incident response

When production breaks, the agent team's `lead-orchestrator` is the human-facing voice; the cross-cutting `tester` + `db-operator` + `realtime-debugger` + `compliance-specialist` are invoked depending on the incident.

### Severity classification (mirrors SLA)

- **P1 / SEV1** — Outage, data leak suspected, money flow stuck.
- **P2 / SEV2** — Degraded for many users.
- **P3 / SEV3** — Bug affecting individual users.

### P1 runbook (lives in `docs/runbook/incident-response.md`, written in M0)

```
1. ACKNOWLEDGE (within 15 min)
   - PagerDuty / SMS ack
   - Status page update: "investigating"

2. ASSEMBLE (within 30 min)
   - Open incident channel (Slack or comparable)
   - Invoke lead-orchestrator with: "P1 incident, [description]"
   - Lead dispatches relevant specialist agents

3. DIAGNOSE (within 60 min)
   - db-operator runs perf + lock diagnostics
   - realtime-debugger checks event flow
   - audit-trail-verifier confirms no tampering
   - compliance-specialist evaluates PII / KVKK exposure

4. MITIGATE (within 4h)
   - Apply the smallest possible fix
   - Rollback if uncertain
   - Communicate ETA on status page

5. RESOLVE
   - Confirm fix
   - Status page: "monitoring" → "resolved"
   - Customer comms to affected accounts within 24h

6. POSTMORTEM (within 7 days)
   - docs/postmortems/YYYY-MM-DD-<slug>.md
   - Blameless format: what happened, contributing factors, action items
   - Action items have owners + dates
```

### Postmortem template

```markdown
# YYYY-MM-DD — <title>

**Severity:** P1 / P2 / P3
**Detected at:** <UTC time>
**Resolved at:** <UTC time>
**Duration:** Xh Ym
**Customer impact:** <number affected, what they experienced>

## Summary
<2-3 sentences>

## Timeline
- <UTC time>: <event>
- <UTC time>: <event>
- ...

## Root cause
<the actual cause, in 1-2 paragraphs>

## What went well
- <bullet>

## What went poorly
- <bullet>

## Action items
- [ ] <action> — owner: <agent> — due: <date>
- ...

## Customer communications
- <date> — <channel> — <summary of what was sent>
```

Postmortems are not blameful. The agent team is named ("realtime-debugger missed the outbox lag indicator"); humans are not blamed.

## 6. Customer-facing communications

How we talk to customers when something goes wrong:

| Situation | Channel | Template | Time |
|---|---|---|---|
| P1 outage | Status page + in-app banner | "We are investigating an issue affecting [X]. ETA <when>." | 15 min |
| Individual user blocker | Direct email | Personalized, references their specific case | 4–8h |
| KVKK request received | Email auto-reply | `kvkk-acknowledgement.md` | Immediate |
| KVKK request resolved | Email | `kvkk-{type}-response.md` | Per SLA |
| Provider outage (Iyzico down) | In-app banner | "Payments temporarily unavailable. We're tracking with Iyzico. Tenders unaffected." | 30 min |
| Security incident (data leak) | Direct email + KVKK notification | Special — outside counsel reviews before sending | Within 72h per KVKK m.12 |
| Planned maintenance | In-app banner + email 48h before | Standard template | 48h pre-event |

### Tone

- **Honest.** "We made a mistake" beats "service interruption."
- **Direct.** Plain Turkish. Avoid corporate hedging.
- **Actionable.** Always say what the customer should do (or that they don't need to do anything).
- **Empathetic.** Money is involved. People are stressed.

## 7. Operational metrics (tracked in PostHog + CloudWatch)

What we measure to know if Operations is working:

| Metric | Target | Source |
|---|---|---|
| P1 first-response time | < 4h | PagerDuty + manual ticket review |
| P3 first-response time | < 24h | Help Center ticket metadata |
| P3 resolution time | < 5 business days | Same |
| Avg KVKK request resolution | < 14 days (SLA: 30) | `kvkk_requests` table |
| P1 incidents per quarter | < 2 | Postmortem count |
| Status page uptime communications | 100% on real outages | Manual audit |
| Customer-impacting bugs per month | < 5 | Bug labels in issue tracker |

Quarterly review by `compliance-specialist` + Ozan. Trends > absolute numbers.

## Consequences

### Positive

- **Honest SLA.** "Best-effort solo" is uncomfortable to publish but it's the truth, and customers trust it more than fake commitments.
- **KVKK flows are operational, not aspirational.** Every right has a named owner + SLA + template.
- **Postmortems are blameless and named.** The agent team is the unit of accountability; humans don't get personally blamed.
- **Escalation is logged.** No "I emailed engineering" — every tier handoff is in `admin_audit_log` or the ticket system.
- **Templates exist before they're needed.** Drafting KVKK responses under time pressure is when mistakes happen.

### Negative

- **Solo on-call is a real risk.** Mitigation: status page automation; pilot customers signed in knowing.
- **Postmortem discipline is hard solo.** Mitigation: it's a single-author exercise, no meeting needed.
- **Templates can become stale.** Quarterly review owned by `compliance-specialist`.

## Future plans

- **Second on-call hire** triggered by paid customer count crossing 10 OR any contract demanding <2h P1 response.
- **24/7 P1 coverage** Phase 2.
- **Knowledge base auto-generation** — postmortems and ticket resolutions feed into a searchable internal KB. Phase 2.
- **AI-assisted ticket triage** — categorize P1 vs P3 from ticket content. Phase 2.
- **Customer Health Score** — a dashboard for `account-manager` showing which orgs are at risk (declining usage, repeated tickets). Phase 2.
- **External pen test gate before launch** (mentioned in milestones M5).
- **VERBİS registration** — Turkish data-controller registry. Engineering-adjacent paperwork; legal handles.
- **External counsel relationship** — established before pilot, available for KVKK escalation, contract templates, and data-leak response.

## Reference

- ADR-0005 — Cognito authentication (KVKK consent flow)
- ADR-0014 — Internal staff RBAC (who can do what)
- ADR-0015 — Admin tooling isolation (where Tier 3 lives)
- ADR-0020 — Observability (where alarms fire)
- ADR-0021 — Backup & DR (incident response substrate)
- PRD-0001 — Vision (KVKK + EU residency commitments)
- `docs/compliance/templates/` — KVKK and customer-comms templates
- `docs/runbook/incident-response.md` — P1 runbook (planned M0)
- `docs/postmortems/` — blameless incident records
