# PRD-0006 — Provider Integration Specs

**Status:** Accepted
**Date:** 2026-05-14
**Decision-makers:** Ozan (lead)

## Why this document exists

Phase 1 depends on three external providers, each carrying material risk:

- **Iyzico Marketplace** — escrow and payouts (ADR-0007). Risk #1 in PRD-0002 risk register.
- **Nilvera / Foriba** — e-fatura submission to GİB. Mandatory by Turkish regulation.
- **Greyparrot** — AI image analysis for waste classification. Risk #2 in PRD-0002.

We do not have sandbox access for any of them yet. Writing detailed provider-specific integration specs without sandbox time produces docs that 60% match reality and silently degrade. We learned from past projects that "the docs said X, the API actually does Y" is a recurring cost.

This PRD codifies a **two-stage strategy**:

1. **Now (this PRD):** specify the **adapter interfaces** and a deep **`Manual` reference implementation** for each provider. The system runs end-to-end on `Manual` adapters; we can demo, test, and even pilot without any external integration live.
2. **Later (per-provider ADRs ADR-0027 / 0028 / 0029):** after we obtain sandbox access and run real calls, write focused ADRs with verified specifics — auth flow gotchas, webhook signature quirks, error handling, sandbox setup steps, KVKK / contract requirements.

Per ADR-0017 §6, deferred work has a placeholder home. This PRD is that home for provider specifics.

## Decision

We adopt **three adapter interfaces** with **three `Manual` implementations** as the baseline for Phase 1. Production providers slot in behind the same interface contracts.

```
packages/
├── escrow/
│   ├── provider.interface.ts    ← EscrowProvider
│   ├── manual.adapter.ts        ← P1 default
│   ├── iyzico.adapter.ts        ← P1 production (ADR-0027 when sandbox lands)
│   └── paytr.adapter.ts         ← P2 fallback (ADR-0030)
├── efatura/
│   ├── provider.interface.ts    ← EFaturaProvider
│   ├── manual.adapter.ts        ← P1 default
│   ├── nilvera.adapter.ts       ← P1 production (ADR-0028)
│   └── foriba.adapter.ts        ← alternative (ADR-0031)
└── ai-scan/
    ├── provider.interface.ts    ← AIScanProvider
    ├── manual.adapter.ts        ← P1 default — null analysis
    └── greyparrot.adapter.ts    ← P1 production (ADR-0029)
```

### 1. Selection at runtime

```
ESCROW_PROVIDER=manual|iyzico|paytr            # default: manual
EFATURA_PROVIDER=manual|nilvera|foriba         # default: manual
AI_SCAN_PROVIDER=manual|greyparrot             # default: manual
```

Factories read the env vars at module load. No code path knows the provider; everything talks to the interface.

### 2. Escrow provider — full contract

The `EscrowProvider` interface is the operating contract between the Step Functions escrow workflow (ADR-0007) and any payment processor.

```ts
// packages/escrow/provider.interface.ts
export interface EscrowProvider {
  readonly name: 'manual' | 'iyzico' | 'paytr';

  /**
   * Create a new escrow order with the provider.
   * The provider returns its own order ID, which we persist on escrow_orders.
   */
  createEscrow(req: {
    orderId: string;                    // our internal ID, used as idempotency key
    buyerOrgId: string;
    sellerOrgId: string;
    carrierOrgId?: string;
    wasteAmount: number;                // recycler → producer
    transportAmount?: number;           // recycler → carrier (optional)
    platformFeeAmount?: number;         // ADR-0007 + PRD-0008 fee engine
    currency: 'TRY';
    metadata: Record<string, string>;   // tender_id, shipment_id, contract refs
  }): Promise<{
    providerOrderId: string;
    paymentUrl?: string;                // where recycler is redirected to fund
    expiresAt: Date;
  }>;

  /**
   * Disburse funds to a party. Called by escrow Step Functions release state.
   * Idempotency key MUST be honored — the same key with the same params returns
   * the original transaction; same key with different params returns 409.
   */
  releaseToParty(req: {
    providerOrderId: string;
    target: 'seller' | 'carrier' | 'platform';
    amount: number;
    iban?: string;                      // null for platform_only (sweeps to Relowa account)
    idempotencyKey: string;
  }): Promise<{
    providerTxId: string;
    settledAt: Date;
  }>;

  /**
   * Refund the buyer. Used in dispute resolution.
   * Same idempotency contract as releaseToParty.
   */
  refundBuyer(req: {
    providerOrderId: string;
    amount: number;
    reason: string;
    idempotencyKey: string;
  }): Promise<{
    providerTxId: string;
    refundedAt: Date;
  }>;

  /**
   * Validate a webhook from the provider. Called by the webhook handler
   * BEFORE persisting to provider_webhooks. The signature_valid column is
   * the result of this check.
   *
   * The returned eventType is the provider-agnostic name. The adapter is
   * responsible for mapping vendor-specific event names to our canonical set:
   *   'funded' | 'released' | 'refunded' | 'disputed' | 'failed'
   */
  verifyWebhook(req: {
    headers: Record<string, string>;
    body: string;
  }): Promise<{
    valid: boolean;
    eventId: string;                    // provider's idempotency key
    orderId: string;                    // our orderId from createEscrow
    eventType: 'funded' | 'released' | 'refunded' | 'disputed' | 'failed';
    payload: unknown;
  }>;

  /**
   * Optional — only required for providers that support split disbursement
   * in one API call. Manual + Iyzico both support; PayTR may not.
   */
  releaseAtomicSplit?(req: {
    providerOrderId: string;
    splits: Array<{ target: 'seller' | 'carrier' | 'platform'; amount: number; iban?: string }>;
    idempotencyKey: string;
  }): Promise<{ providerTxIds: string[]; settledAt: Date }>;
}
```

### 3. ManualProvider escrow — reference implementation

`ManualProvider` is **fully functional** for dev, demo, integration tests, and the PRD-0002 fallback if Iyzico approval slips. It writes to dedicated tables that simulate the provider's state:

```sql
-- Created in M1 alongside escrow tables (note: schema actually lands M4 per PRD-0008)
CREATE TABLE manual_escrow_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  our_order_id          UUID NOT NULL,                  -- maps to escrow_orders.id
  funded_amount         numeric(14,2) NOT NULL DEFAULT 0,
  expected_amount       numeric(14,2) NOT NULL,
  status                TEXT NOT NULL,                  -- 'pending' | 'funded' | 'released' | 'refunded'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  funded_at             TIMESTAMPTZ,
  released_at           TIMESTAMPTZ
);

CREATE TABLE manual_escrow_txs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manual_order_id       UUID NOT NULL REFERENCES manual_escrow_orders(id),
  idempotency_key       TEXT NOT NULL,
  tx_type               TEXT NOT NULL,                  -- 'fund' | 'release_seller' | 'release_carrier' | 'release_platform' | 'refund'
  target_iban           TEXT,                            -- hashed at rest (KVKK)
  amount                numeric(14,2) NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (manual_order_id, idempotency_key)
);
```

The `ManualProvider`:

- **`createEscrow`** — inserts a `manual_escrow_orders` row with status `pending`. Returns a `paymentUrl` of `https://app.relowa.com/dev/manual-fund?orderId=<provider_order_id>` (a fake-payment page in dev) or auto-funds in test.
- **`releaseToParty`** — inserts a `manual_escrow_txs` row with the appropriate `tx_type`. Idempotency enforced via unique constraint on `(manual_order_id, idempotency_key)`. Returns a synthetic `providerTxId`.
- **`refundBuyer`** — inserts a `manual_escrow_txs` with `tx_type = 'refund'`.
- **`verifyWebhook`** — accepts a signed (HMAC SHA-256) JSON body posted to `POST /webhooks/manual`. The HMAC key is in the dev `.env`. Production never enables this — the env-var guard refuses.

This is enough to run the full escrow Step Functions workflow end-to-end with no external dependency. The state machine, the audit chain, the outbox, and the e-fatura integration all exercise the same code paths whether the underlying provider is Manual or Iyzico.

### 4. ManualProvider testing affordances

The Manual adapter exposes test endpoints in dev (gated by `NODE_ENV !== production`):

```
POST /dev/manual/escrow/:orderId/fund        - simulate buyer funding
POST /dev/manual/escrow/:orderId/release     - simulate provider release confirmation
POST /dev/manual/escrow/:orderId/refund      - simulate provider refund confirmation
POST /dev/manual/escrow/:orderId/dispute     - inject a dispute event
POST /dev/manual/escrow/:orderId/fail        - inject a provider failure event
```

These trigger the same webhook → SQS → Lambda → state-machine-resume flow as a real provider would. `tests/escrow-flow.sh` uses these.

### 5. E-fatura provider — full contract

```ts
// packages/efatura/provider.interface.ts
export interface EFaturaProvider {
  readonly name: 'manual' | 'nilvera' | 'foriba';

  /**
   * Submit an invoice for issuance. The provider returns its issued UUID
   * and the GIB submission status.
   */
  submitInvoice(req: {
    ourInvoiceId: string;                       // our internal ID, idempotency key
    invoiceType: 'satis' | 'iade' | 'tevkifat'; // sale / refund / withholding
    issuer: PartyInfo;                          // seller (recycler for transport; producer for waste)
    receiver: PartyInfo;                        // buyer
    lines: InvoiceLine[];
    currency: 'TRY';
    issueDate: Date;
    metadata: Record<string, string>;           // tender_id, escrow_order_id refs
  }): Promise<{
    providerInvoiceId: string;
    efaturaUuid: string;                        // GİB UUID
    pdfUrl?: string;                            // signed URL or null if async
    status: 'submitted' | 'accepted' | 'rejected';
  }>;

  /**
   * Query the latest GİB-accepted status. Used by the e-fatura state poll.
   */
  getStatus(req: { providerInvoiceId: string }): Promise<{
    status: 'submitted' | 'accepted' | 'rejected' | 'cancelled';
    rejectionReason?: string;
    pdfUrl?: string;
  }>;

  /**
   * Cancel an issued invoice (only allowed within Turkish 8-day window).
   */
  cancelInvoice(req: {
    providerInvoiceId: string;
    reason: string;
    idempotencyKey: string;
  }): Promise<{ cancelledAt: Date }>;

  /**
   * Validate inbound webhook.
   */
  verifyWebhook(req: {
    headers: Record<string, string>;
    body: string;
  }): Promise<{
    valid: boolean;
    eventId: string;
    invoiceId: string;
    eventType: 'accepted' | 'rejected' | 'cancelled';
    payload: unknown;
  }>;
}

export interface PartyInfo {
  taxId: string;                                // vergi_no
  taxOffice?: string;
  legalName: string;
  address: string;
  city: string;
  country: 'TR';
  email?: string;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unit: 'KG' | 'TON' | 'ADET' | 'HIZMET';
  unitPrice: number;
  vatRate: number;                              // 0.20 for 20%
  vatExemptionReasonCode?: string;
}
```

### 6. ManualProvider e-fatura — reference implementation

The Manual e-fatura adapter:

- Generates a deterministic `providerInvoiceId` from `ourInvoiceId` (e.g. `MANUAL-<sha1>`).
- Generates a fake `efaturaUuid` in UUID v4 format.
- Returns immediately with `status: 'accepted'` (no GİB roundtrip in dev).
- Stores the invoice in `manual_efatura_invoices` table.
- Generates a PDF via a stub template if `pdfUrl` is requested.

This unblocks any UI / flow that depends on an e-fatura being issued, without GİB infrastructure.

### 7. AI scan provider — full contract

```ts
// packages/ai-scan/provider.interface.ts
export interface AIScanProvider {
  readonly name: 'manual' | 'greyparrot';

  /**
   * Submit a tender photo for AI analysis. Returns immediately with a job ID;
   * results arrive via webhook or are polled.
   */
  submitScan(req: {
    ourScanId: string;                          // our ai_analyses.id, idempotency key
    imageUrl: string;                           // S3 presigned URL
    materialHint?: 'plastic' | 'paper' | 'metal' | 'electronic' | 'chemical' | 'other';
    metadata: Record<string, string>;           // tender_id, etc.
  }): Promise<{
    providerScanId: string;
    status: 'pending' | 'scanning' | 'verified' | 'failed';
  }>;

  /**
   * Fetch result. Used by the scan-status poll Lambda.
   */
  getResult(req: { providerScanId: string }): Promise<{
    status: 'pending' | 'scanning' | 'verified' | 'needs_review' | 'failed';
    purityScore?: number;                       // 0.00 - 1.00
    compositionBreakdown?: Record<string, number>;
    contaminationFlags?: string[];
    confidence?: number;
    failureReason?: string;
  }>;

  verifyWebhook(req: {
    headers: Record<string, string>;
    body: string;
  }): Promise<{
    valid: boolean;
    eventId: string;
    scanId: string;
    eventType: 'progress' | 'completed' | 'failed';
    payload: unknown;
  }>;
}
```

### 8. ManualProvider AI scan — reference implementation

Manual AI scan returns deterministic placeholder data based on the `materialHint`:

```ts
const MANUAL_RESULTS: Record<string, ScanResult> = {
  plastic: { purityScore: 0.92, compositionBreakdown: { hdpe: 0.85, ldpe: 0.07, contaminants: 0.08 }, confidence: 0.95 },
  paper:   { purityScore: 0.88, compositionBreakdown: { mixed_paper: 0.88, ink: 0.12 }, confidence: 0.93 },
  metal:   { purityScore: 0.95, compositionBreakdown: { ferrous: 0.95, nonferrous: 0.05 }, confidence: 0.97 },
  // ...
};
```

This is good enough to drive the AI scan UI (Figma batch 04, the tender-create step 2). It returns immediately — no async polling needed in dev. The UI shows the same "scanning" animation; the timing is faked in the Manual adapter.

### 9. Schema for ai_analyses (deferred to M4)

```sql
CREATE TYPE ai_scan_status AS ENUM ('pending', 'scanning', 'verified', 'needs_review', 'failed');

CREATE TABLE ai_analyses (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id                UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  provider                 TEXT NOT NULL,                -- 'manual' | 'greyparrot'
  provider_scan_id         TEXT NOT NULL,
  image_s3_key             TEXT NOT NULL,
  status                   ai_scan_status NOT NULL DEFAULT 'pending',
  purity_score             numeric(4,3),                 -- 0.000 - 1.000
  composition_breakdown    jsonb,
  contamination_flags      jsonb,
  confidence               numeric(4,3),
  failure_reason           TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at             TIMESTAMPTZ
);

CREATE INDEX ai_analyses_tender_idx ON ai_analyses(tender_id);
CREATE INDEX ai_analyses_status_idx ON ai_analyses(status) WHERE status IN ('pending', 'scanning');
```

### 10. Per-provider future ADRs (the deferred work)

When sandbox access lands for each provider, write a focused ADR:

| ADR | Provider | Scope |
|---|---|---|
| ADR-0027 | Iyzico Marketplace | sub-merchant onboarding, payment-form embed, webhook HMAC, payout hold mechanics, KVKK paperwork |
| ADR-0028 | Nilvera | API auth, XML-UBL invoice format, GİB submission semantics, status polling, cancellation 8-day window |
| ADR-0029 | Greyparrot | API auth, image upload size limits, supported materials, accuracy thresholds, rate limits, pricing |
| ADR-0030 | PayTR (fallback) | Same as Iyzico if Iyzico approval slips |
| ADR-0031 | Foriba (alternative) | Same as Nilvera if Nilvera contract terms unfavorable |

Each ADR follows the standard template + a **"Sandbox setup"** section documenting what credentials, what whitelist requirements, what test data was used. The ADR is written AFTER the first successful sandbox call, not before.

## Consequences

### Positive

- **POC + early demos run on Manual adapters with zero external dependencies.** Iyzico approval can slip without blocking the build.
- **Adapter interface is the contract.** Real providers slot in by implementing the interface; no surrounding code changes.
- **Tests stay deterministic.** Manual adapters have predictable output; integration tests don't flake on external services.
- **KVKK / contract paperwork is decoupled from architecture.** Legal can start the Iyzico paperwork while engineering ships M1–M3 on Manual.
- **Single integration boundary per provider.** Mocking is at the adapter, not scattered through application code.

### Negative

- **Per-provider ADRs are deferred** — there's a small risk that an interface field is wrong (e.g. a provider requires a parameter we didn't model). Mitigated by the interfaces being generous (`metadata` jsonb on every call lets providers carry extra fields).
- **`ManualProvider`s must be maintained** even after real providers land — they remain the test and dev workhorses.
- **Some provider-specific behaviors are hard to model behind a generic interface** (e.g. Iyzico's specific KVKK consent flow). Those leak into the adapter implementation, which is fine.

## Future plans

- **ADR-0027 / 0028 / 0029** as described above.
- **Sandbox account in M0** — even before integration, get the dev sandbox credentials and document the API limits.
- **Provider-agnostic dispute flow** — currently each adapter handles disputes its own way. If we end up running multiple providers in production, factor dispute handling out.
- **Chargeback handling** — provider reports a chargeback weeks after release. Each adapter needs to translate to our canonical `disputed` state.
- **Multi-currency support** — currently `TRY` only. EUR support (Phase 3) is an adapter capability question.
- **Webhook replay tooling** — a small admin UI to re-trigger a stored `provider_webhooks` row, useful for forensics. Phase 2.

## Reference

- ADR-0007 — Step Functions escrow (the consumer of `EscrowProvider`)
- ADR-0011 / 0012 — UI surface for AI scan (`AIInsightCard`, tender create step 2)
- PRD-0002 — Phase 1 scope (provider integration deferrals)
- PRD-0008 — Pricing engine (platform fee is a target of escrow disbursement)
- Iyzico API: https://docs.iyzico.com/marketplace/
- Nilvera API: https://docs.nilvera.com/
- Greyparrot API: https://docs.greyparrot.com/ (commercial — terms required)
