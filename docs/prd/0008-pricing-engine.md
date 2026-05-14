# PRD-0008 — Pricing Engine & Business Model

**Status:** Accepted
**Date:** 2026-05-14
**Decision-makers:** Ozan (lead)

## Why this document exists

Relowa's revenue model is **transaction fees only** — no subscriptions, no per-seat licenses, no upfront integration fees in Phase 1. Producers, recyclers, and carriers join for free; Relowa earns a commission on settled transactions.

The challenge: the *exact shape* of those fees has not been validated with real customers. Different enterprise customers will likely negotiate different rates. The PRD-0001 commitment to "production-quality, no MVP-then-rewrite" means we cannot hard-code a single `platform_fee_pct` constant and rebuild later.

The Figma already shows this model concretely. The Recycler Financial screen displays "Platform Fee Deduction — System Debit — -$45.00" as a transparent line item in transaction history. We need the engine that produces those line items.

This PRD specifies a **pricing engine**, not a single price. The engine supports:

- Tiered percentage schedules (5% on first ₺X, 3% next, 1% above)
- Flat fees as a degenerate tier case
- Asymmetric splits (e.g. 1.5% buyer + 1.5% seller, or 2% + 1%)
- Different schedules per transaction type (waste tender, carrier ad)
- Per-tenant overrides for enterprise contracts
- Effective date ranges (rate changes scheduled in advance)
- Caps and floors per side per transaction
- Full transparency in user-facing transaction history
- Audit traceability of every fee computation

This is "fee schedule + overrides" as a real data model.

## Scope

**In scope (this PRD):**
- Schema for fee schedules, tiers, overrides, and per-transaction fee applications.
- The fee engine TypeScript module (interface, computation, breakdown).
- Default fee schedules for Phase 1 (editable in M6 admin UI).
- Integration points with escrow (ADR-0007) and admin RBAC (ADR-0014).
- Transparent user-facing surfacing.

**Out of scope (deferred):**
- Subscription / seat-based pricing (Phase 3, if at all).
- Volume rebates (Phase 2 if needed).
- Promotional / referral codes (Phase 2 if needed).
- Currency hedging for cross-border transactions (Phase 3 EU expansion).
- Per-material-type fees (Phase 2 if needed — the schema accommodates adding `material_type` to schedule selection).

## Decision

We adopt a **fee schedule + override** data model with a TS computation engine. Default schedules ship with sensible Phase 1 rates; overrides are configurable per-tenant by `super_admin` only. **Schema is fully specified now but migration ships in M4** alongside the escrow tables (per Option B decision).

### 1. Data model (lands in M4 alongside escrow)

```sql
-- Who pays this fee slice. Multiple slices per transaction = split fees.
CREATE TYPE fee_target AS ENUM (
  'producer',          -- the waste seller
  'recycler',          -- the buyer
  'carrier',           -- the transport provider
  'platform_only'      -- Relowa retains; not invoiced to any party
);

-- A fee schedule. Multiple tiers per schedule. One default per transaction_type.
CREATE TABLE fee_schedules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,                       -- e.g. "P1 default — waste tender"
  transaction_type  TEXT NOT NULL,                       -- 'waste_tender' | 'carrier_ad'
  description       TEXT,
  is_default        BOOLEAN NOT NULL DEFAULT false,
  effective_from    TIMESTAMPTZ NOT NULL,
  effective_until   TIMESTAMPTZ,                          -- null = open-ended
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES internal_staff(id),
  -- Only one default per (transaction_type, effective range)
  CONSTRAINT fee_schedules_one_default
    EXCLUDE USING gist (
      transaction_type WITH =,
      tstzrange(effective_from, COALESCE(effective_until, 'infinity'::timestamptz)) WITH &&
    ) WHERE (is_default)
);

CREATE INDEX fee_schedules_tx_type_idx ON fee_schedules(transaction_type)
  WHERE is_default;

-- Tiers within a schedule. Each tier names ONE fee_target.
-- To split fees between buyer and seller, create two tiers with the same
-- amount range but different targets.
CREATE TABLE fee_schedule_tiers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id       UUID NOT NULL REFERENCES fee_schedules(id) ON DELETE CASCADE,
  fee_target        fee_target NOT NULL,
  tier_min_amount   numeric(14,2) NOT NULL,              -- inclusive
  tier_max_amount   numeric(14,2),                        -- exclusive, null = open
  percentage        numeric(7,6),                         -- 0.030000 = 3.0%
  flat_amount       numeric(14,2),                        -- alternative to percentage
  min_fee           numeric(14,2),                        -- floor per transaction per target
  max_fee           numeric(14,2),                        -- cap per transaction per target
  display_order     INTEGER NOT NULL DEFAULT 0,
  CHECK (percentage IS NOT NULL OR flat_amount IS NOT NULL),
  CHECK (percentage IS NULL OR flat_amount IS NULL),
  CHECK (tier_min_amount >= 0),
  CHECK (tier_max_amount IS NULL OR tier_max_amount > tier_min_amount)
);

CREATE INDEX fee_schedule_tiers_schedule_idx
  ON fee_schedule_tiers(schedule_id, fee_target, tier_min_amount);

-- Per-org override of a default schedule. Set by super_admin only.
CREATE TABLE fee_schedule_overrides (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schedule_id       UUID NOT NULL REFERENCES fee_schedules(id),
  transaction_type  TEXT NOT NULL,
  effective_from    TIMESTAMPTZ NOT NULL,
  effective_until   TIMESTAMPTZ,
  reason            TEXT NOT NULL,                        -- contract ref, e.g. "Acme MSA 2026-Q3"
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID NOT NULL REFERENCES internal_staff(id),
  -- Prevent overlapping overrides for the same org + transaction_type
  CONSTRAINT fee_overrides_no_overlap
    EXCLUDE USING gist (
      org_id WITH =,
      transaction_type WITH =,
      tstzrange(effective_from, COALESCE(effective_until, 'infinity'::timestamptz)) WITH &&
    )
);

CREATE INDEX fee_schedule_overrides_org_idx
  ON fee_schedule_overrides(org_id, transaction_type, effective_from);

-- Audit of an actual fee computation. One row per fee_target applied to an escrow.
-- This is the source of truth for "what fee did we charge on this transaction."
CREATE TABLE fee_applications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_order_id     UUID NOT NULL REFERENCES escrow_orders(id) ON DELETE RESTRICT,
  fee_schedule_id     UUID NOT NULL REFERENCES fee_schedules(id),
  fee_target          fee_target NOT NULL,
  gross_amount        numeric(14,2) NOT NULL,              -- the amount the fee was computed against
  computed_amount     numeric(14,2) NOT NULL,
  capped_by           TEXT,                                -- 'min_fee' | 'max_fee' | null
  computation_payload jsonb NOT NULL,                      -- full per-tier breakdown
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX fee_applications_escrow_idx ON fee_applications(escrow_order_id);
```

**RLS:**

- `fee_schedules`, `fee_schedule_tiers`, `fee_schedule_overrides` — RLS disabled; only `relowa_admin` DB role reads/writes them.
- `fee_applications` — RLS enabled; producers/recyclers/carriers see their own org's fees (joined via `escrow_orders`). This is what powers the "Platform Fee Deduction" line items in their transaction history.

### 2. Effective-date resolution

The engine resolves the applicable schedule at the moment of the **transaction's creation**, not the moment of settlement. This means:

- A tender created today, settling next week → uses today's rate.
- A rate change scheduled for next month → does not retroactively affect in-flight transactions.

The escrow order stores the resolved `fee_schedule_id` at `createEscrow` time. The fee is recomputed only if the schedule itself is amended (admin action), which is uncommon and creates a new schedule version rather than mutating tiers.

### 3. The fee engine — TypeScript module

```ts
// packages/pricing/fee-engine.ts

export type TransactionType = 'waste_tender' | 'carrier_ad';
export type FeeTarget = 'producer' | 'recycler' | 'carrier' | 'platform_only';

export interface FeeContext {
  /** The org whose transaction this is. Used for override lookup. */
  orgId: string;

  /** Which transaction model applies. */
  transactionType: TransactionType;

  /** The base amount the fee is computed against. */
  grossAmount: number;

  /** Resolution timestamp. Defaults to now(); the escrow order pins to createdAt. */
  at?: Date;

  /** Optional metadata for future material/region-based schedules. */
  metadata?: Record<string, string>;
}

export interface TierBreakdown {
  tierMin: number;
  tierMax: number | null;
  rate: number | null;        // percentage as decimal, e.g. 0.03 for 3%
  flat: number | null;
  appliedAmount: number;       // the slice of gross_amount this tier saw
  tierFee: number;             // the fee from this tier alone
}

export interface FeeBreakdown {
  scheduleId: string;
  feeTarget: FeeTarget;
  grossAmount: number;
  computedAmount: number;
  cappedBy: 'min_fee' | 'max_fee' | null;
  perTierBreakdown: TierBreakdown[];
}

/**
 * Computes all fees for a transaction. Returns one breakdown per fee_target
 * defined in the resolved schedule. A schedule with both producer + recycler
 * tiers returns two breakdowns (split fee).
 */
export async function computeFees(ctx: FeeContext): Promise<FeeBreakdown[]>;

/**
 * Persists fee_applications rows. Called by escrow Step Function on createEscrow.
 */
export async function applyFees(
  escrowOrderId: string,
  breakdowns: FeeBreakdown[],
  tx: Transaction
): Promise<void>;
```

### 4. Computation algorithm

```
function computeFees(ctx: FeeContext):
  1. resolvedAt = ctx.at ?? now()
  2. Find override: SELECT FROM fee_schedule_overrides
                    WHERE org_id = ctx.orgId
                      AND transaction_type = ctx.transactionType
                      AND effective_from <= resolvedAt
                      AND (effective_until IS NULL OR effective_until > resolvedAt)
                    ORDER BY effective_from DESC LIMIT 1
  3. If override exists: use override.schedule_id
     Else: SELECT FROM fee_schedules
           WHERE transaction_type = ctx.transactionType
             AND is_default = true
             AND effective_from <= resolvedAt
             AND (effective_until IS NULL OR effective_until > resolvedAt)
           LIMIT 1
  4. Load tiers FROM fee_schedule_tiers WHERE schedule_id = ... ORDER BY fee_target, tier_min_amount
  5. Group tiers by fee_target
  6. For each fee_target group:
       a. amount_remaining = ctx.grossAmount
       b. perTierBreakdown = []
       c. min_fee, max_fee = derive from highest tier with values (or null)
       d. For each tier in this target group (ordered by tier_min):
            slice_size = min(amount_remaining, tier_max - tier_min) if tier_max else amount_remaining
            slice_fee = tier.percentage * slice_size  OR  tier.flat_amount
            perTierBreakdown.push({ ... slice_fee })
            amount_remaining -= slice_size
            break if amount_remaining <= 0
       e. raw_total = sum(perTierBreakdown.map(t => t.tierFee))
       f. cappedBy = null
          If min_fee && raw_total < min_fee:  cappedBy = 'min_fee'; raw_total = min_fee
          If max_fee && raw_total > max_fee:  cappedBy = 'max_fee'; raw_total = max_fee
       g. Push FeeBreakdown { feeTarget, computedAmount: raw_total, ... }
  7. Return breakdowns
```

The algorithm is deterministic, idempotent, and pure given the schedule + context. The same `(orgId, transactionType, grossAmount, at)` always returns the same breakdowns.

### 5. Default Phase 1 schedules

Seeded in M4 migration alongside the schema:

```sql
-- Schedule: Waste tender default
INSERT INTO fee_schedules (name, transaction_type, is_default, effective_from)
VALUES ('P1 default — waste tender', 'waste_tender', true, '2026-01-01');

-- Producer side: 1.5%, max ₺2500
INSERT INTO fee_schedule_tiers (schedule_id, fee_target, tier_min_amount, tier_max_amount, percentage, max_fee, display_order)
VALUES (
  (SELECT id FROM fee_schedules WHERE name = 'P1 default — waste tender'),
  'producer', 0, NULL, 0.015000, 2500.00, 1
);

-- Recycler side: 1.5%, max ₺2500
INSERT INTO fee_schedule_tiers (schedule_id, fee_target, tier_min_amount, tier_max_amount, percentage, max_fee, display_order)
VALUES (
  (SELECT id FROM fee_schedules WHERE name = 'P1 default — waste tender'),
  'recycler', 0, NULL, 0.015000, 2500.00, 2
);

-- Schedule: Carrier ad default
INSERT INTO fee_schedules (name, transaction_type, is_default, effective_from)
VALUES ('P1 default — carrier ad', 'carrier_ad', true, '2026-01-01');

-- Recycler pays 1.5% on transport, max ₺1000
INSERT INTO fee_schedule_tiers (schedule_id, fee_target, tier_min_amount, tier_max_amount, percentage, max_fee, display_order)
VALUES (
  (SELECT id FROM fee_schedules WHERE name = 'P1 default — carrier ad'),
  'recycler', 0, NULL, 0.015000, 1000.00, 1
);
```

**Phase 1 default rates summary:**

| Transaction | Producer | Recycler | Carrier | Total platform take |
|---|---|---|---|---|
| Waste tender (e.g. ₺100,000) | 1.5% capped ₺2500 → ₺1500 | 1.5% capped ₺2500 → ₺1500 | — | ~3% of GMV |
| Carrier ad (e.g. ₺5,000) | — | 1.5% capped ₺1000 → ₺75 | — | ~1.5% of transport spend |

These are starting defaults. Adjustable per-tenant by super_admin without code changes.

### 6. Escrow integration

The escrow Step Function (ADR-0007) consumes the fee engine on two states:

**On `CreateEscrowOrder`:**
- Compute fees via `computeFees`.
- Insert `fee_applications` rows.
- Sum the platform_only + split-fee shares; this is the platform retention.
- Compute net disbursement targets:
  - Producer receives: `wasteAmount - fee_applications[producer].computedAmount`
  - Carrier receives: `transportAmount - fee_applications[carrier].computedAmount` (often 0 in Phase 1)
  - Platform retains: `sum(fee_applications.computedAmount)` minus the carrier+producer portions

**On `ReleaseFunds` (parallel state):**
- Three disbursement branches:
  - `ReleaseToProducer` — net of producer-side fee
  - `ReleaseToCarrier` — net of carrier-side fee
  - `RetainToPlatform` — total platform share

Each branch creates one `escrow_transactions` row referencing the corresponding `fee_applications` row.

This is the **ADR-0007 amendment** — the `release` state fans out into three branches, not two. The schema for `escrow_transactions.tx_type` already supports `'platform_fee_retention'` as one of its values.

### 7. Per-tenant override workflow

The Figma admin panel (M6) exposes the override UI:

```
super_admin opens /admin/organizations/:id
  → Click "Pricing"
  → See current effective schedule + history
  → "Create override" form:
       - Select schedule (existing or "create new")
       - Effective from (must be >= now())
       - Effective until (optional)
       - Reason (required, contract reference)
  → On submit:
       - Insert fee_schedule_overrides row
       - Write admin_audit_log entry with reason + override_id
       - Compliance-specialist auto-invoked (money flow trigger)
```

Backdating is rejected: `effective_from >= now() - INTERVAL '24 hours'`. Audit immutability is preserved.

### 8. Schedule versioning

Schedules are **immutable once created**. To change rates:

1. Create a new `fee_schedules` row with a new `effective_from`.
2. Set the new schedule as `is_default = true` for its transaction_type.
3. The previous default's `effective_until` is auto-set by trigger to the new schedule's `effective_from`.

Tiers cannot be edited in place — only added/removed before the schedule has `effective_from` reached, or by creating a fresh schedule. This guarantees that **a fee_application's referenced schedule + tier values never change post-application**. Auditability is total.

### 9. RBAC additions to ADR-0014

| Permission | Risk | Role assignments |
|---|---|---|
| `pricing:read` | low | super_admin, compliance_officer, financial_analyst |
| `pricing:manage` | critical | super_admin only |
| `pricing:override` | critical | super_admin only |
| `pricing:audit` | medium | super_admin, compliance_officer |

ADR-0014's `staff_permissions` table seed gets four new rows. `compliance-specialist` is auto-invoked on any pricing change.

### 10. Transparent UX

Per the Figma escrow screen:

- **Recycler's "Available Funds" / "Funds Locked"** — net of platform fee already deducted.
- **Transaction history** — every payment shows the fee as its own line:
  - "Payment Received — Trade #BJ-X1Y1 — +₺92,500.00"
  - "Platform Fee Deduction — System Debit — -₺1,500.00"
  - "Logistics Fee Deduction — System Debit — -₺75.00"
- **Hover on the line item** → shows the per-tier breakdown computed by the engine, including schedule name (helpful for enterprise customers comparing against their MSA).
- **Pricing page** in `/ayarlar/pricing` (M6) — shows the org's current effective schedule for both transaction types, with a "next change" date if a future override is scheduled.

### 11. Reporting

Two reports for Relowa's internal use:

- **Daily revenue** — `SUM(computed_amount) GROUP BY DATE(created_at), fee_target` from `fee_applications`. Powers a CloudWatch dashboard.
- **Per-org take rate** — `SUM(computed_amount) / SUM(gross_amount)` GROUP BY org. Useful for understanding which enterprise customers are negotiating down.

These exist as Drizzle queries in the admin app; no separate materialized view in P1.

## Consequences

### Positive

- **Flexibility before validation.** Business model can pivot to per-tier, split, or per-tenant rates without code changes.
- **Total auditability.** Every fee charged is one row in `fee_applications` with its full computation. Compliance review can reproduce any number.
- **No code constants for fees.** The single source of truth is the DB, editable in M6.
- **Per-tenant pricing is structural.** Enterprise contracts get honored automatically.
- **The schema doesn't pollute escrow's core.** Fee tables are separate; escrow flows reference them through Step Function input.
- **Transparency wins customer trust.** "We don't hide fees" is shown line-by-line.

### Negative

- **5 new tables** in M4. Mitigation: they're well-scoped and audited.
- **GiST exclusion constraints** require `btree_gist` extension. Already common; no extra setup beyond `CREATE EXTENSION btree_gist;`.
- **Fee engine adds complexity** in the escrow flow. Mitigation: pure function with deterministic input/output; tested in isolation.
- **Backdating is forbidden** — operationally restrictive (if a customer asks for "credit back last month's fees," it's a separate refund flow, not a backdated override). This is intentional.

## Future plans

- **Volume rebates** — recyclers exceeding ₺X GMV/quarter get retroactive credits via a separate `volume_rebates` table.
- **Promotional codes** — first-tender-free promos via a `promotions` table that adjusts effective rates per qualifying transaction.
- **Per-material-type schedules** — add `material_type` to the schedule selection key. Schema accommodates.
- **Per-region schedules** — same pattern. Useful for cross-border (Phase 3).
- **Subscription tier add-on** — IF business validates a SaaS layer, add a `subscriptions` table; pricing engine extends to deduct subscription credit before transaction fees.
- **Multi-currency support** — currently `TRY` only. EUR (Phase 3) requires per-currency schedules.
- **Webhook on pricing change** — enterprise customers receive notification when their override changes. Phase 2.
- **Pricing simulator** — UI tool that takes a hypothetical transaction and shows what each side would pay. Useful for sales conversations. Phase 2.
- **AI-suggested override rates** — based on org's transaction volume, propose retention rates. Phase 3.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Hard-code `PLATFORM_FEE_PCT = 0.03` constant | First enterprise contract breaks this. Rewrite cost > engine cost. |
| `escrow_orders.platform_fee_pct` column | Fine for one rate per transaction; cannot handle splits or per-tenant overrides without schema bloat. |
| External pricing service (e.g. Stripe Tax-style) | Adds a third-party. We don't want pricing decisions outside our boundary. |
| Build a generic rule engine (Drools-style) | Massive over-engineering. The fee model has known dimensions. |
| Fee on tender creation, not settlement | Customers haven't received value yet. Charging on settlement aligns incentives. |
| Subscription-only model (no transaction fees) | Forces customers to pay before validating value. Hard sell in this segment. |

## Migration plan

- **M1 (now):** Spec captured here. No schema changes yet.
- **M4 (weeks 14–16):** Migration lands alongside escrow tables. Includes:
  - Extensions: `btree_gist`
  - Tables: `fee_schedules`, `fee_schedule_tiers`, `fee_schedule_overrides`, `fee_applications`
  - Seeds: P1 default schedules
  - `packages/pricing/` module with engine implementation
  - Integration with escrow Step Function release state
  - RLS policies for `fee_applications`
  - `staff_permissions` rows for `pricing:read|manage|override|audit`
- **M5 (weeks 17–18):** Frontend integration — transparent transaction history line items.
- **M6 (post-launch):** Admin UI for schedule + override management.

## Reference

- ADR-0007 — Step Functions escrow (the consumer of this engine)
- ADR-0014 — Internal staff RBAC (super_admin owns overrides)
- ADR-0015 — Admin tooling isolation (where pricing UI lives)
- PRD-0001 — Vision (transaction-fee commitment)
- PRD-0006 — Provider integration (platform fee is one of three disbursement targets)
- Figma escrow screen — `docs/figma/screens/.../Relowa - Recycler Finansal Veriler & Güvenli Havuz (Escrow).png`
- Figma invoices screen — `docs/figma/screens/.../Relowa - Faturalar (Düzeltilmiş Yerleşim).png`
