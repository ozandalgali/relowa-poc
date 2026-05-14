# Agent Team Handbook

> How a real feature flows through the 16-agent team. Use this when "I don't know which agents apply to this work" is the actual blocker.

## The shape of a feature

Every feature is one or more of these flows. The walkthroughs below are concrete.

```
A. New table + RLS + endpoint + UI
B. New event-driven workflow
C. UI-only change
D. Performance investigation
E. Compliance review (PR-triggered or scheduled)
F. CI / deploy infrastructure change
```

---

## Walkthrough A — "Add the carrier ad endpoint"

A representative end-to-end feature. Touches data, API, events, frontend, tests, compliance.

**Goal:** Implement `POST /carrier-ads` per ADR-0010 and surface the recycler-facing screen.

### Step 1 — Plan (lead-orchestrator)

The human says: "Build the carrier ad endpoint with bid submission, recycler-side UI, and event publishing per ADR-0010."

The `lead-orchestrator` produces:

```
Plan: Carrier Ad Endpoint + UI

Dependencies graph:
  [migration-author] → [rls-test-runner]
                    ↓
         [endpoint-writer] ←→ [event-bridge-wiring]
                    ↓
                [tester]
                    ↓
   [feature-component-builder] → [route-page-builder]
                    ↓
                [tester]
                    ↓
       [compliance-specialist]
                    ↓
                [doc-keeper]

Steps:
  1. migration-author:
     - Add carrier_ads, carrier_bids, shipments, shipment_events tables
     - Add RLS policies per ADR-0010 §3
     - Update RAW_SQL_FILES in migrate.ts
     Artifact: packages/db/src/schema.ts diff + 0002_carrier_ads_rls.sql

  2. rls-test-runner:
     - Extend tests/rls-isolation.sh with carrier-ad scenarios
       (producer cannot see other recycler's ads; carrier cannot see other carrier's bids)
     Artifact: tests/rls-isolation.sh diff, all green

  3. endpoint-writer:
     - POST /carrier-ads (recycler creates)
     - GET /carrier-ads (recycler lists own)
     - POST /carrier-ads/:id/bids (carrier submits)
     - POST /carrier-ads/:id/award (recycler picks winner, creates shipment)
     Artifact: apps/api/src/routes/carrier-ads.ts + OpenAPI spec

  4. event-bridge-wiring:
     - Add rules: carrier_ad.created, carrier_bid.placed, carrier_ad.awarded
     - Outbox publisher writes corresponding rows per ADR-0006
     Artifact: scripts/setup-events.sh diff + outbox publisher updates

  5. tester:
     - Integration test: create→bid→award full flow
     - Verify outbox rows materialize
     - Verify audit_events chain intact
     Artifact: tests/carrier-ad-flow.sh

  6. feature-component-builder:
     - BidOfferCard (was already in inventory, may need extension)
     - Carrier ad create form
     - Carrier ad detail page sections
     Artifact: components in apps/web/(app)/tasiyici-ilanlari/_components/

  7. route-page-builder:
     - /tasiyici-ilanlari (list)
     - /tasiyici-ilanlari/[id] (detail with bids)
     - /tasiyici-ilanlari/yeni (create form)
     Artifact: apps/web/(app)/tasiyici-ilanlari/* pages with i18n keys

  8. tester:
     - Playwright E2E: log in as recycler, create ad, log in as carrier, bid
     Artifact: tests/e2e/carrier-ad.spec.ts

  9. compliance-specialist:
     - No IBAN handling → KVKK low risk
     - Location data (pickup/dropoff coords) → confirm in audit log
     - Producer cannot see carrier price → cross-tenant isolation correct
     Artifact: docs/compliance/reviews/2026-05-NN-carrier-ad.md

 10. doc-keeper:
     - Update docs/frontend/component-inventory.md with new screens
     - Update CHANGELOG.md [Unreleased]
     - Update HANDOFF.md if architectural state changed
     Artifact: doc diffs

Estimated session count: ~3 (1 for data+API, 1 for UI, 1 for review+polish)
```

The human approves, optionally re-orders, optionally drops `compliance-specialist` if absolutely sure (the lead will warn).

### Step 2 — Execution

Each specialist runs in order. The lead reports completion at each step:

```
✓ Step 1/10 complete: migration-author
  - schema.ts: +95 lines
  - 0002_carrier_ads_rls.sql: 187 lines
  - RAW_SQL_FILES updated
  - pnpm db:reset successful

✓ Step 2/10 complete: rls-test-runner
  - 8 new scenarios added
  - All 13 RLS scenarios green
...
```

If a step fails, the lead pauses and reports.

### Step 3 — Final summary

```
Feature complete: Carrier Ad Endpoint + UI

Files added: 23
Files modified: 11
Tests added: 11 (8 RLS scenarios, 1 integration, 2 E2E)
Compliance review: passed (low risk)
ADR/PRD updates: ADR-0010 status changed from "drafted" to "implementing"

Next session: extend with realtime push (ADR-0006 outbox→AppSync subscription)
```

---

## Walkthrough B — "Add a new event-driven workflow"

**Goal:** Soft-close the carrier ad if a bid arrives in the final 60s.

### Plan

```
1. migration-author: no schema change (closes_at already exists)
2. endpoint-writer: extend POST /carrier-ads/:id/bids to bump closes_at
3. event-bridge-wiring: no new rule (scheduler already runs every 30s)
4. state-machine-author: not applicable (this is in-transaction, not SFN)
5. tester: timing-aware integration test
6. compliance-specialist: no PII/money change → skip
```

When the workflow is shorter, the plan is shorter. The lead trims.

---

## Walkthrough C — "UI-only change"

**Goal:** Change the live auction countdown to flash red in the final 30s.

### Plan

```
1. design-system-keeper: confirm we have a `--danger-flash` token or animation pattern
   → if not, add it as a token-level change in packages/ui/tokens/motion.ts
2. feature-component-builder: extend CountdownTimer to accept threshold prop
3. tester: snapshot test, a11y check (motion can be a problem)
4. doc-keeper: update component inventory
```

If step 1 lands a new token, that's a separate PR. UI work doesn't introduce design-system drift silently.

---

## Walkthrough D — "Why is the marketplace page slow?"

**Goal:** p95 of `/pazar-yeri` is 1.4s. Investigate.

### Plan

```
1. db-operator:
   - EXPLAIN ANALYZE the marketplace query
   - Check pg_stat_statements for top consumers
   - Inspect index usage on tenders(status, pickup_region)
   - Propose: add covering index, refactor query, or denormalize
2. tester:
   - Add a perf assertion: query must return in < 200ms with 10k tenders
3. doc-keeper:
   - Write a docs/memory/learned/ note with the diagnosis
```

Notice: no endpoint-writer involved. This is investigative work, not new code. db-operator owns the data-layer story.

---

## Walkthrough E — "Compliance review on demand"

**Goal:** A quarterly KVKK readiness check before pilot launch.

### Plan

```
1. compliance-specialist:
   - Scan: all tables with potential PII fields
   - Scan: all S3 buckets for Object Lock + encryption-at-rest config
   - Scan: all Cognito User Pool settings (MFA, password policy)
   - Scan: SES sending domain DKIM/SPF
   - Audit: aydınlatma metni delivery flow
   - Audit: data export & deletion endpoints
   - Audit: cross-border data flows (provider webhooks, S3 replication)
2. doc-keeper:
   - File the review under docs/compliance/reviews/YYYY-QQ-quarterly.md
   - Update HANDOFF.md "compliance status" line
```

The output is a report card with a P/F per criterion + remediation list.

---

## Walkthrough F — "Add the auction-close Lambda to deploy"

**Goal:** Wire the `apps/lambdas/tender-close-handler/` into GH Actions + AWS.

### Plan

```
1. ci-cd-engineer:
   - Add Lambda build step to .github/workflows/deploy.yml
   - Add ECR push for the Lambda image
   - Add Terraform/CDK module for the function + EventBridge scheduler rule
   - Add the IAM role with least-privilege (RDS Data API access, SQS publish only)
2. tester:
   - CI smoke test: deploy to dev account, invoke once, verify outbox row materialized
3. doc-keeper:
   - Update docs/runbook/ci-pipeline.md
```

---

## When NOT to invoke the lead orchestrator

If the change is:

- Single file
- No new tests required (a typo fix, a string update, a doc edit)
- No architectural decision implied

Invoke the relevant specialist directly. The lead is for coordination; direct invocation is for clarity. The cost of the lead's plan-then-execute round-trip is wasted on trivial work.

## When the lead pushes back

The lead orchestrator will refuse to plan if:

- The request crosses an `AGENTS.md` non-negotiable (e.g. "add `OR auth.is_admin()` to all policies")
- The request would introduce a new top-level dependency without an ADR
- The request implies bypassing tests
- The request involves money flow or PII without a clear compliance path

The lead reports the conflict and points at the relevant ADR or memory note. The human decides whether to: change the request, write a new ADR, or override (which is logged in `docs/memory/decisions/`).

## See also

- ADR-0016 — Agent Team & Orchestration (the rules)
- `docs/agents/README.md` — agent index + decision tree
- `docs/agents/sync-strategy.md` — keeping `.opencode/skills/` and `.claude/agents/` identical
- ADR-0017 — Test strategy
- AGENTS.md — the constitution every agent obeys
