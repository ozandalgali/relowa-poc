# ADR-0007 — Step Functions Escrow State Machine

**Status:** Accepted
**Date:** 2026-05-13
**Decision-makers:** Ozan (lead)

## Context

Phase 1 requires that money flow safely through the platform:

```
Recycler wins waste tender → funds escrow with their payment
                                    │
                                    ▼
                          Funds held by provider (Iyzico / PayTR)
                                    │
                                    ▼
                          Carrier picks up and delivers (ADR-0010)
                                    │
                                    ▼
                          Producer confirms delivery
                                    │
                                    ▼
              ┌─────────────────────┴─────────────────────┐
              │                                           │
       No dispute (24-72h window)                  Dispute raised
              │                                           │
              ▼                                           ▼
       Release to producer + carrier             Manual resolution
                                                     │
                                          ┌──────────┴──────────┐
                                          │                     │
                                     Release as agreed       Refund recycler
```

This is a **multi-day, multi-actor, multi-provider** workflow with strong correctness requirements:

1. **No double-charge.** A retry must not charge twice. Idempotency on every provider call.
2. **No funds-leak.** If a release fails, funds stay held — never silently lost.
3. **Audit-ready.** Every state transition writes to `audit_events` with a verifiable timestamp (and via ADR-0008, anchored to Arbitrum).
4. **Provider-agnostic.** Iyzico is the P1 provider but PayTR is a fallback per PRD-0002 risk register. Code shouldn't hardwire either.
5. **Recoverable.** A stuck escrow needs visibility and a manual override path (super_admin via ADR-0014).
6. **KVKK-aware.** IBAN at rest is hashed; raw IBAN flows through provider call sites only briefly.

Building this in application code (a long-running cron + DB state column) is possible but fragile: every state transition needs its own retry logic, the dispute window timer must survive process restarts, and the manual-override path is bolt-on.

This ADR fixes the orchestration substrate.

## Decision

We use **AWS Step Functions** for the escrow state machine, with a **provider-agnostic adapter interface** that allows swapping between `ManualProvider` (dev / fallback), `IyzicoProvider` (P1 production), and future providers.

Step Functions is right because:

- Long-running waits (up to 1 year per state) are first-class.
- Built-in retry, exponential backoff, and DLQ per state.
- Standard workflows are auditable: every transition is a CloudWatch log line, and Step Functions stores execution history for 90 days.
- Manual operator intervention via `SendTaskSuccess` / `SendTaskFailure` (the super_admin "force release" path).
- Cost is $0.025 / 1000 transitions — negligible at our scale.

### 1. Escrow data model (M1 schema)

```sql
CREATE TYPE escrow_status AS ENUM (
  'pending',         -- created, awaiting funding
  'funds_locked',    -- recycler paid, provider holding
  'in_transit',      -- shipment moving
  'delivered',       -- producer confirmed receipt, dispute window open
  'released',        -- disbursed to producer + carrier
  'refunded',        -- funds returned to recycler
  'disputed',        -- under manual review
  'failed'           -- provider error, manual intervention needed
);

CREATE TABLE escrow_orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id          UUID NOT NULL REFERENCES tenders(id) ON DELETE RESTRICT,
  shipment_id        UUID REFERENCES shipments(id),
  buyer_org_id       UUID NOT NULL REFERENCES organizations(id),    -- the recycler (pays)
  seller_org_id      UUID NOT NULL REFERENCES organizations(id),    -- the producer (receives)
  carrier_org_id     UUID REFERENCES organizations(id),             -- gets transport disbursement
  waste_amount       numeric(14,2) NOT NULL,                        -- recycler → producer
  transport_amount   numeric(14,2),                                 -- recycler → carrier
  currency           text NOT NULL DEFAULT 'TRY',
  provider           text NOT NULL,                                 -- 'iyzico' | 'manual' | future
  provider_order_id  text,                                          -- reference in provider's system
  state_machine_arn  text,                                          -- the SFN execution ARN
  status             escrow_status NOT NULL DEFAULT 'pending',
  created_at         timestamptz NOT NULL DEFAULT now(),
  funded_at          timestamptz,
  delivered_at       timestamptz,
  released_at        timestamptz,
  dispute_opened_at  timestamptz,
  dispute_reason     text
);

CREATE INDEX escrow_orders_tender_idx   ON escrow_orders(tender_id);
CREATE INDEX escrow_orders_buyer_idx    ON escrow_orders(buyer_org_id);
CREATE INDEX escrow_orders_seller_idx   ON escrow_orders(seller_org_id);
CREATE INDEX escrow_orders_carrier_idx  ON escrow_orders(carrier_org_id);
CREATE INDEX escrow_orders_status_idx   ON escrow_orders(status);

CREATE TABLE escrow_transactions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_order_id    UUID NOT NULL REFERENCES escrow_orders(id) ON DELETE RESTRICT,
  tx_type            text NOT NULL,            -- 'fund' | 'release' | 'refund' | 'dispute' | 'partial_release'
  amount             numeric(14,2) NOT NULL,
  provider_tx_id     text,
  status             text NOT NULL,            -- 'pending' | 'completed' | 'failed'
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX escrow_tx_order_idx ON escrow_transactions(escrow_order_id, created_at);

CREATE TABLE provider_webhooks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           text NOT NULL,
  provider_event_id  text NOT NULL,           -- provider's idempotency key
  payload            jsonb NOT NULL,
  signature_valid    boolean NOT NULL,
  processed_at       timestamptz,
  related_escrow_id  uuid REFERENCES escrow_orders(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX provider_webhooks_unprocessed_idx ON provider_webhooks(created_at)
  WHERE processed_at IS NULL;
```

The `provider_webhooks` unique constraint on `(provider, provider_event_id)` is the **idempotency key for webhook replays** — the provider can resend the same event 10 times, only the first persists.

### 2. State machine (ASL skeleton)

```
StartAt: CreateEscrowOrder
States:
  CreateEscrowOrder:
    Type: Task                                  // calls provider.createEscrow()
    Resource: arn:...:lambda:createEscrow
    Retry: [provider 5xx → 3x exp backoff]
    Next: WaitForFunding

  WaitForFunding:
    Type: Task
    Resource: arn:...:waitForCallback           // SFN waits, webhook resumes
    HeartbeatSeconds: 86400                     // 24h to fund or fail
    Catch: [Timeout → MarkFailed]
    Next: FundsLocked

  FundsLocked:
    Type: Pass
    Result: { status: 'funds_locked' }
    Next: WaitForShipment

  WaitForShipment:
    Type: Task
    Resource: arn:...:waitForCallback           // shipment status = 'delivered'
    HeartbeatSeconds: 604800                    // 7 days max in transit
    Catch: [Timeout → OpenDispute]
    Next: DisputeWindow

  DisputeWindow:
    Type: Wait
    Seconds: 259200                             // 72h dispute window after delivery
    Next: CheckDispute

  CheckDispute:
    Type: Choice
    Choices:
      - Variable: $.dispute_raised
        BooleanEquals: true
        Next: ManualReview
    Default: ReleaseFunds

  ReleaseFunds:
    Type: Parallel
    Branches:
      - StartAt: ReleaseToProducer
        States:
          ReleaseToProducer:
            Type: Task
            Resource: arn:...:lambda:releaseToProducer
            End: true
      - StartAt: ReleaseToCarrier
        States:
          ReleaseToCarrier:
            Type: Task
            Resource: arn:...:lambda:releaseToCarrier
            End: true
    Next: MarkReleased

  MarkReleased:
    Type: Task
    Resource: arn:...:lambda:updateOrderStatus
    Parameters: { status: 'released' }
    End: true

  ManualReview:
    Type: Task
    Resource: arn:...:waitForCallback           // super_admin resolves via admin panel
    Catch: [Timeout → MarkFailed]
    Next: PostManualReview

  PostManualReview:
    Type: Choice
    Choices:
      - Variable: $.resolution
        StringEquals: 'release'
        Next: ReleaseFunds
      - Variable: $.resolution
        StringEquals: 'refund'
        Next: RefundBuyer
    Default: MarkFailed

  RefundBuyer:
    Type: Task
    Resource: arn:...:lambda:refundBuyer
    Next: MarkRefunded

  MarkRefunded:
    Type: Task
    Resource: arn:...:lambda:updateOrderStatus
    Parameters: { status: 'refunded' }
    End: true

  OpenDispute:
    Type: Task
    Resource: arn:...:lambda:openDispute
    Next: ManualReview

  MarkFailed:
    Type: Task
    Resource: arn:...:lambda:updateOrderStatus
    Parameters: { status: 'failed' }
    End: true
```

Each `Task` Lambda is small (< 100 lines), single-responsibility, idempotent (checks `escrow_orders.status` before acting), and writes one `audit_events` row.

### 3. The provider adapter

```ts
// packages/escrow/provider.interface.ts
export interface EscrowProvider {
  readonly name: 'iyzico' | 'paytr' | 'manual';

  createEscrow(req: {
    orderId: string;
    buyerOrgId: string;
    sellerOrgId: string;
    carrierOrgId?: string;
    wasteAmount: number;
    transportAmount?: number;
    currency: 'TRY';
    metadata: Record<string, string>;
  }): Promise<{ providerOrderId: string; paymentUrl?: string }>;

  releaseToSeller(req: { providerOrderId: string; amount: number; idempotencyKey: string }):
    Promise<{ providerTxId: string }>;

  releaseToCarrier(req: { providerOrderId: string; amount: number; idempotencyKey: string }):
    Promise<{ providerTxId: string }>;

  refundBuyer(req: { providerOrderId: string; amount: number; reason: string; idempotencyKey: string }):
    Promise<{ providerTxId: string }>;

  verifyWebhook(req: { headers: Record<string, string>; body: string }):
    Promise<{ valid: boolean; eventId: string; orderId: string; eventType: string; payload: any }>;
}
```

Three implementations in P1:

- **`ManualProvider`** — for dev and the PRD-0002 fallback. Records the "intent" in the DB; admin marks transitions manually. The test suite uses this exclusively.
- **`IyzicoProvider`** — wraps Iyzico Marketplace API (sub-merchant pattern + payout hold). The primary P1 production provider.
- **`PayTRProvider`** — risk-register fallback. Spec'd but not built until Iyzico's onboarding is confirmed.

The factory reads `ESCROW_PROVIDER=manual|iyzico|paytr` env var; multiple providers per environment is not supported in P1 (deferred to future plans).

### 4. Webhook handling

Providers report state changes via webhooks. The flow:

```
POST /api/webhooks/iyzico  (public, signed)
  1. Verify signature using shared secret
  2. INSERT INTO provider_webhooks (uses unique idempotency)
     - if already exists → return 200 (idempotent ack)
  3. SQS publish: process-webhook with provider_webhook.id
  4. Return 200

(separate Lambda)
process-webhook:
  1. Load provider_webhooks row
  2. Identify related escrow_order
  3. Validate event type makes sense for current state
  4. SendTaskSuccess(state_machine_arn, payload)
     OR write transition to DB and let SFN poll
  5. UPDATE provider_webhooks SET processed_at=now()
```

Critical invariant: the webhook handler **never** mutates `escrow_orders` directly. It only resumes the state machine, which calls the Task Lambdas, which update the DB. Single source of state transitions = the state machine.

### 5. Super admin manual override

Per ADR-0014, super_admin has `escrow:manual_release` permission. UI in `apps/admin`:

```
GET /admin/escrow/disputes
  → list of escrow_orders WHERE status='disputed' OR status='failed'

POST /admin/escrow/orders/:id/resolve
  body: { resolution: 'release' | 'refund', reason: string }

  1. Verify super_admin permission + reason present (ADR-0014 RBAC)
  2. SendTaskSuccess to ManualReview state with $.resolution
  3. Write admin_audit_log row
  4. State machine continues to ReleaseFunds or RefundBuyer
```

Manual override **never bypasses the state machine** — it provides input to a waiting state. This keeps the audit trail intact.

### 6. KVKK / sensitive data handling

- **IBANs at rest:** stored as `sha256(iban + tenant_salt)` in our DB. Raw IBAN flows through the provider call only.
- **Provider PII:** Iyzico holds the cardholder PII; we hold only `iyzico_buyer_id` reference. Same for payouts.
- **Aydınlatma metni:** at recycler payment time, KVKK consent is logged in `audit_events` before the provider call.
- **e-fatura:** Nilvera/Foriba integration emits an invoice on each release transaction. e-fatura number stored in `escrow_transactions.payload.efatura_no`.

### 7. Dev mode

In dev (`ESCROW_PROVIDER=manual`):

- `ManualProvider` is a stub that always succeeds.
- Step Functions runs against **Step Functions Local** (`amazon/aws-stepfunctions-local`) in the docker-compose stack.
- Wait states are configurable; tests inject 1-second waits via env var.
- The webhook endpoint accepts simulated provider events from `tests/escrow-flow.sh`.

### 8. Integration with pricing engine (PRD-0008) — amendment 2026-05-14

The `ReleaseFunds` Parallel state fans out into **three branches**, not two, when the pricing engine resolves a non-zero platform share:

```
ReleaseFunds (Parallel):
  Branch 1: ReleaseToProducer    → net of fee_applications[producer].computed_amount
  Branch 2: ReleaseToCarrier     → net of fee_applications[carrier].computed_amount
  Branch 3: RetainToPlatform     → sum of platform_only + buyer-side + seller-side fees
```

The `escrow_transactions.tx_type` enum supports a `'platform_fee_retention'` value (added in M4 alongside the pricing schema). Each fee_applications row referenced by an escrow_transactions row creates a fully-auditable trail from "the platform took ₺X" → "computed from schedule Y at time Z."

The state machine reads from `packages/pricing/fee-engine.ts` at the `CreateEscrowOrder` state to determine fee_applications rows. Those rows are persisted before any state transition past `WaitForFunding`. By the time release runs, the disbursement amounts are deterministic.

See PRD-0008 for the full pricing engine spec.

### 9. Integration with carrier sub-auction (ADR-0010)

The escrow only enters `funds_locked` once the recycler pays for the tender win. The carrier ad can be created in parallel; the carrier is selected (`shipments` row created) independent of escrow state. When shipment.delivered fires, the state machine resumes from `WaitForShipment`. If the carrier ad isn't awarded yet, the shipment doesn't exist, so the state machine waits at `WaitForShipment` for the heartbeat timeout — at which point Relowa staff manually intervenes (the "operationally managed carrier" backup path from PRD-0002).

## Consequences

### Positive

- **Multi-day waits as first-class state:** no cron job to run, no DB poll to scale.
- **Audit trail at three levels:** `audit_events` (per transition), Step Functions execution history (per state), `escrow_transactions` (per money movement).
- **Provider-agnostic:** swap Iyzico → PayTR by changing one env var and writing the adapter.
- **Manual override is part of the design, not a hack:** super_admin uses `SendTaskSuccess` to resolve disputes; no out-of-band SQL.
- **Idempotency end-to-end:** API idempotency keys, provider idempotency keys, webhook unique constraint, Lambda DB-state checks. No double-charge surface remains.
- **Webhook safety:** signature verification + unique constraint + decoupled processing.

### Negative

- **Step Functions Local in dev** has feature gaps vs. real SFN (notably waitForCallback patterns). We patch the gaps in dev with a polling fallback.
- **Iyzico Marketplace API onboarding** is the highest-risk piece (PRD-0002 risk register #1). Mitigation: `ManualProvider` is fully functional for dev/demo; production deploy can defer if Iyzico approval slips.
- **One Lambda per state** is ~10 Lambdas. Mitigation: each is < 100 lines; shared utility package keeps boilerplate low.
- **SFN execution history retention** is 90 days. After that, we rely on `audit_events` for forensic queries. Documented in runbook.
- **Cost at scale:** if P3 grows to 100k escrows/month, SFN transition cost ≈ $30/mo. Bearable.

## Future plans

- **Multi-provider per environment** — route different tenants to different providers (Iyzico for SMB, custom B2B agreement for enterprise). Adapter already supports this; orchestration needs a `provider_routing_rules` table. Defer until enterprise sales arrives.
- **Partial release** — release a fraction of escrow to producer immediately on pickup confirmation, hold rest until delivery. Useful for high-trust repeat producers. Phase 2.
- **Currency hedging** — escrow holding period creates currency exposure for cross-border (Phase 3 EU expansion). Provider-level FX or platform-level hedge.
- **Refund automation** — currently `RefundBuyer` requires super_admin click; add automatic refund for clear-cut cases (carrier no-show with proof). Phase 2.
- **Streaming escrow updates to producer** — "your funds are locked in escrow, expected release date X" as a live status. UI exists in Figma (`Relowa - Recycler Finansal Veriler & Güvenli Havuz (Escrow).png`), backend just needs the AppSync subscription (ADR-0006).
- **Step Functions Express workflows** — for fast paths (instant settlement on small amounts). Different pricing model, sub-second execution. Phase 2 optimization.
- **Multi-leg disbursement** — when shipments have multiple carriers (intermediate transfers from ADR-0010 future), escrow disburses to each leg. State machine grows a `ReleaseToCarrier` parallel branch per leg.
- **Chargeback handling** — provider reports a chargeback weeks after release; state machine opens a `Chargeback` state. Defer until first real chargeback case.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Application-level cron + DB state column | Fragile across deploys; retry logic per-transition; manual-override is bolt-on. We've all built this; we know how it breaks. |
| Temporal Cloud | Excellent product; adds a third-party in the trust chain and a per-action cost. AWS-native preferred per PRD-0001. |
| AWS Lambda only (no SFN) | "Long-running wait" is the killer feature SFN provides. Without it, we re-invent waitForCallback in DynamoDB. |
| Direct provider lock-in (Iyzico SDK in Hono handlers) | Couples auction flow to escrow flow; can't swap providers; doesn't survive provider 5xx. |
| Custom-built workflow engine | Solo lead time-sink with zero customer value. |
| Database-only state machine (CQRS) | Wait states require cron; retry semantics per transition; harder to reason about than SFN's ASL. |

## Reference

- ADR-0001 — Postgres as system of record
- ADR-0006 — Outbox/AppSync (escrow status pushed to UI via outbox)
- ADR-0010 — Carrier sub-auction (shipment.delivered is an SFN callback trigger)
- ADR-0014 — Internal staff RBAC (super_admin dispute resolution)
- ADR-0008 — Arbitrum anchoring (escrow audit events join the daily Merkle root)
- PRD-0002 — Phase 1 scope (Iyzico primary, PayTR fallback)
- AWS Step Functions: https://docs.aws.amazon.com/step-functions/
- Iyzico Marketplace: https://www.iyzico.com/en/marketplace-api
- Step Functions Local: https://docs.aws.amazon.com/step-functions/latest/dg/sfn-local.html
