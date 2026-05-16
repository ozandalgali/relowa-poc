# ADR-0026 — Orders Separate from Tenders

**Status:** Accepted
**Date:** 2026-05-16
**Decision-makers:** Ozan (lead)

## Context

Current schema treats a `tenders` row with `status='won'` as both the auction record AND the active fulfillment record. This conflation has costs:

- **Tender is conceptually an auction event** (DRAFT → PUBLISHED → CLOSING → WON). It has a start, a close, and a winner.
- **What happens AFTER the win** is the *order* — escrow funds, carrier coordinates pickup, recycler accepts delivery, quality inspection, settlement. This phase has its own lifecycle and can outlive the auction by weeks.
- **A single tender can spawn multiple orders** — e.g. a producer's 100-ton tender wins multiple bids partially (Recycler A buys 60t, Recycler B buys 40t), creating two distinct orders. Current schema can't represent this.
- **Quality inspections, dispute resolutions, partial deliveries, refunds** all belong to the order, not the auction.

The CEO's ERD shows `orders` and `order_parties` as separate from `bids` and `awards`. This is the right architecture.

Additionally, this conflation is **invisible in the API today** because every tender has exactly one order (1:1). The bug emerges at:

- Partial bid wins (multi-recycler split).
- Re-auctions after a failed delivery (one tender, two attempted orders).
- Multi-installment orders (large producer ships in weekly batches).
- Carrier assignment that's deferred (order created on tender win; carrier picked later via separate ADR-0010 flow; the carrier ad is bound to the order, not the tender).

We commit the model now, in M1 schema, to prevent retrofit pain. Implementation lands progressively.

## Decision

We adopt **orders** as a distinct entity, separate from tenders. One tender → one or more orders. An order is the **persistent fulfillment record**: it holds escrow attachment, carrier assignment, quality inspection, settlement, and dispute history.

### 1. Conceptual model

```
Tender (auction event — owned by producer)
  │
  │   PUBLISHED → CLOSING → WON (one or more winning bids selected)
  │
  ▼
Order (fulfillment record — owned by producer + recycler)
  │   One order per (tender, winning_bid). Most tenders have 1 order.
  │   Multi-winner tenders have N orders.
  │
  │   PENDING → AWAITING_CARRIER → ESCROW_FUNDED → IN_TRANSIT
  │   → DELIVERED → INSPECTED → SETTLED  (happy path)
  │   → DISPUTED → RESOLVED                (dispute branch)
  │   → CANCELLED                          (mutual cancellation)
  │
  ├── escrow_order (1:1)                — money flow
  ├── carrier_ad (0:N)                   — recycler creates ads after order exists
  ├── shipment (0:N)                     — physical transport (potentially multi-leg)
  ├── quality_inspection (0:N)           — at delivery
  ├── delivery_proof (0:1)               — final receipt
  └── invoices (2:N)                     — waste invoice + transport invoice + Relowa platform invoice
```

### 2. Schema (M1)

```sql
CREATE TYPE order_status AS ENUM (
  'pending',                 -- created on tender win; awaiting recycler payment
  'awaiting_carrier',        -- escrow funded; recycler is now matching with a carrier
  'escrow_funded',           -- escrow holds the funds; carrier picked
  'in_transit',              -- carrier en route
  'delivered',               -- delivered to recycler facility
  'inspected',               -- quality inspection completed (pass or pending dispute)
  'settled',                 -- escrow released to all parties; closed
  'disputed',                -- under super_admin / mediator review
  'resolved',                -- dispute resolved (becomes settled or refunded)
  'cancelled',               -- mutual cancellation pre-funding
  'refunded'                 -- escrow returned to recycler post-dispute
);

CREATE TABLE orders (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number             TEXT NOT NULL UNIQUE,           -- 'RLW-2026-00042', human-friendly
  tender_id                UUID NOT NULL REFERENCES tenders(id) ON DELETE RESTRICT,
  winning_bid_id           UUID NOT NULL REFERENCES bids(id),
  -- Quantities (a partial-win tender splits into multiple orders, each with its share)
  quantity_tons            numeric(12,3) NOT NULL,
  price_per_ton            numeric(14,2) NOT NULL,
  total_amount             numeric(14,2) NOT NULL,         -- quantity × price
  currency                 TEXT NOT NULL DEFAULT 'TRY',
  -- Parties (denormalized for query speed and audit clarity)
  producer_org_id          UUID NOT NULL REFERENCES organizations(id),
  recycler_org_id          UUID NOT NULL REFERENCES organizations(id),
  carrier_org_id           UUID REFERENCES organizations(id),  -- set when carrier assigned
  pickup_facility_id       UUID NOT NULL REFERENCES facilities(id),
  dropoff_facility_id      UUID NOT NULL REFERENCES facilities(id),
  -- Lifecycle
  status                   order_status NOT NULL DEFAULT 'pending',
  status_reason            TEXT,                            -- e.g. for cancellation, dispute
  pickup_window_start      TIMESTAMPTZ,
  pickup_window_end        TIMESTAMPTZ,
  expected_delivery_at     TIMESTAMPTZ,
  delivered_at             TIMESTAMPTZ,
  settled_at               TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  -- Cross-references
  escrow_order_id          UUID,                            -- FK to escrow_orders (set on funding)
  delivery_proof_id        UUID,                            -- FK to delivery_proofs (set on delivery)
  -- Audit
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT orders_partial_win_unique
    UNIQUE (tender_id, winning_bid_id)
);

CREATE INDEX orders_tender_idx        ON orders(tender_id);
CREATE INDEX orders_producer_idx      ON orders(producer_org_id);
CREATE INDEX orders_recycler_idx      ON orders(recycler_org_id);
CREATE INDEX orders_carrier_idx       ON orders(carrier_org_id);
CREATE INDEX orders_status_idx        ON orders(status);
CREATE INDEX orders_pickup_facility   ON orders(pickup_facility_id);

-- Parties involved in an order, with their relationship.
-- Often denormalized into orders columns above for hot queries, but this
-- gives us flexibility for multi-party orders (consolidation, sub-recyclers).
CREATE TABLE order_parties (
  order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  org_id              UUID NOT NULL REFERENCES organizations(id),
  role                TEXT NOT NULL,                       -- 'producer' | 'recycler' | 'carrier' | 'inspector' | 'sub_recycler'
  share_percentage    numeric(5,2),                         -- for multi-recycler split (optional)
  notes               TEXT,
  added_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, org_id, role)
);

-- Order workflow audit: every status transition logged
CREATE TABLE order_status_transitions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status         order_status,
  to_status           order_status NOT NULL,
  triggered_by_user_id UUID REFERENCES users(id),
  triggered_by_event  TEXT,                                  -- 'escrow.funded' | 'shipment.delivered' | etc.
  reason              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX order_status_transitions_order_idx
  ON order_status_transitions(order_id, created_at);

-- Quality inspection (referenced by CEO's ERD as a first-class table)
CREATE TYPE inspection_outcome AS ENUM (
  'pending',
  'passed',
  'failed',
  'partial_pass',
  'inconclusive'
);

CREATE TABLE quality_inspections (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  facility_id          UUID NOT NULL REFERENCES facilities(id),  -- inspection location
  inspector_user_id    UUID REFERENCES users(id),
  inspector_org_id     UUID REFERENCES organizations(id),         -- typically the recycler
  inspection_started_at TIMESTAMPTZ NOT NULL,
  inspection_ended_at   TIMESTAMPTZ,
  outcome              inspection_outcome NOT NULL DEFAULT 'pending',
  declared_tons        numeric(12,3) NOT NULL,
  actual_tons          numeric(12,3),
  purity_score         numeric(4,3),                            -- 0.000-1.000
  contamination_flags  jsonb,
  ai_scan_id           UUID,                                     -- FK to ai_analyses (cloud or edge)
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quality_inspection_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id           UUID NOT NULL REFERENCES quality_inspections(id) ON DELETE CASCADE,
  material_type           material_type NOT NULL,
  declared_tons           numeric(12,3),
  measured_tons           numeric(12,3),
  contamination_pct       numeric(5,2),
  notes                   TEXT
);

-- Delivery proof (signed paperwork, photos, GPS log at delivery moment)
CREATE TABLE delivery_proofs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shipment_id         UUID NOT NULL REFERENCES shipments(id),
  delivered_at        TIMESTAMPTZ NOT NULL,
  signed_by_user_id   UUID REFERENCES users(id),                 -- recycler representative
  delivery_lat        numeric(9,6),
  delivery_lng        numeric(9,6),
  irsaliye_number     TEXT,                                       -- Turkish delivery note number
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE delivery_proof_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_proof_id   UUID NOT NULL REFERENCES delivery_proofs(id) ON DELETE CASCADE,
  doc_type            TEXT NOT NULL,                              -- 'photo' | 'signature' | 'irsaliye_pdf' | 'gps_log'
  s3_key              TEXT NOT NULL,
  caption             TEXT,
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3. RLS

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_select_involved ON orders
  FOR SELECT USING (
    producer_org_id = auth.org_id()
    OR recycler_org_id = auth.org_id()
    OR carrier_org_id = auth.org_id()
  );

CREATE POLICY orders_insert_system ON orders
  FOR INSERT WITH CHECK (
    -- Orders are created by tender-close Lambda, not by user mutation directly
    auth.has_role('system') OR auth.has_role('admin')
  );

CREATE POLICY orders_update_status_involved ON orders
  FOR UPDATE USING (
    producer_org_id = auth.org_id()
    OR recycler_org_id = auth.org_id()
    OR carrier_org_id = auth.org_id()
  );
```

Quality inspections and delivery proofs RLS-scoped via their order.

### 4. The tender→order transition

When a tender's auction closes (auction-close Lambda per ADR-0009):

```
For each winning bid:
  1. Generate order_number (RLW-YYYY-NNNNN)
  2. INSERT INTO orders (
       tender_id, winning_bid_id, quantity_tons,
       price_per_ton, total_amount, producer_org_id,
       recycler_org_id, pickup_facility_id, dropoff_facility_id,
       status, status_reason
     )
  3. INSERT INTO order_status_transitions (
       order_id, to_status='pending', triggered_by_event='tender.won'
     )
  4. INSERT INTO order_parties (... producer, recycler)
  5. Publish outbox event: 'order.created'
  6. Notify both parties: 'order.created.to_producer', 'order.created.to_recycler'
```

If the tender has multiple winning bids (multi-winner mode), the above runs per winning bid.

### 5. Order → escrow attachment (ADR-0007)

When the recycler funds the escrow:

- `escrow_orders` row created, references `orders.id`.
- `orders.escrow_order_id` set.
- `orders.status = 'escrow_funded'`.
- Carrier ad becomes available (recycler can post one).

### 6. Order → carrier ad → shipment chain (ADR-0010)

Carrier ads bind to `orders`, not directly to tenders:

```sql
ALTER TABLE carrier_ads
  ADD COLUMN order_id UUID REFERENCES orders(id) ON DELETE RESTRICT;
-- tender_id stays for compatibility but is derived (orders.tender_id)
```

When recycler awards a carrier:

- `orders.carrier_org_id = winning_carrier_bid.carrier_org_id`
- `orders.status = 'awaiting_carrier'` → still pre-pickup
- shipments row created with `order_id`

### 7. Order → quality inspection → settlement

At delivery:

```
1. Carrier marks shipment.delivered
2. Recycler facility inspector creates quality_inspection record
3. AI scan (if available) populates purity_score
4. Inspector marks outcome: 'passed' | 'partial_pass' | 'failed'
5. On 'passed' or 'partial_pass':
     - delivery_proof generated with signatures + photos
     - orders.status = 'inspected'
     - 72h dispute window opens
6. On 'failed':
     - orders.status = 'disputed'
     - super_admin notified
7. After dispute window (no dispute):
     - escrow Step Function ReleaseFunds triggers
     - orders.status = 'settled'
     - orders.settled_at = now()
     - Carbon certificate generated
     - Daily Merkle root anchored (ADR-0008)
```

### 8. Multi-order tenders (partial wins)

When `tenders.allow_partial_award = true` (new column, default false):

- The auction-close Lambda picks top N bids whose summed quantity reaches the tender quantity.
- Each winning bid spawns an order with its share.
- The pricing engine resolves fees per-order (not per-tender).
- Carrier ads, shipments, escrow all scope to the individual order.

Phase 1 ships with `allow_partial_award = false` (single-winner only). Multi-winner is Phase 2.

### 9. Backward compatibility

Existing API endpoints continue to work:

- `GET /tenders/:id` returns the tender + its associated orders.
- `GET /tenders/:id/orders` lists orders for a tender (returns 1 in single-winner mode).
- `GET /orders/:id` is the new canonical order detail endpoint.
- `GET /orders?producer_org_id=...` etc.

UI updates progressively:

- M1: Backend ships; UI continues to refer to "won tenders" (alias for "orders").
- M2: Add `/siparisler` route for the order list (operator view).
- M3-M5: Migrate UI components to reference "siparis" (order) terminology where the distinction matters.

### 10. Why this matters

| Without `orders` table | With `orders` table |
|---|---|
| Tender status conflated with fulfillment status | Clean separation |
| Multi-winner impossible | Trivial |
| Order belongs to one ESCROW only (1:1 forced) | Order has its own identity |
| Quality inspection has nowhere to attach | Belongs to order |
| Delivery proof has nowhere to attach | Belongs to order |
| Re-auction on failed delivery requires duplicating tender | Just create a new order |
| Settlement audit shows tender status changes | Settlement audit shows order lifecycle |

## Consequences

### Positive

- **Architectural clarity** — tender is the auction, order is the fulfillment.
- **Enables partial wins** (Phase 2) without schema migration.
- **Quality inspection has a home.**
- **Delivery proof has a home.**
- **Multi-leg / consolidation shipments** become representable.
- **Multi-tender orders** (e.g. carrier consolidation of multiple orders on one route) become representable in Phase 2.
- **Better aligns with Turkish business law** — irsaliye attaches to a delivery, not an auction event.

### Negative

- **Schema additions in M1** — 4 new tables, 1 new enum. Mitigated by clear domain model.
- **API additions** — `/orders/*` endpoints alongside existing `/tenders/*`. Both supported.
- **UI terminology drift** — "İhalelerim" vs "Siparişlerim" — different views. Mitigated by route additions, not replacements.
- **More joins in some queries** — tender + order + escrow + shipment. Indexed; performance acceptable at our scale.

## Future plans

- **Partial-win tenders** — `tenders.allow_partial_award = true`. Phase 2.
- **Multi-tender consolidation** — one carrier picks up 5 orders going same direction. Phase 2.
- **Order amendments** — quantity adjustment after pickup (e.g. less weight than declared). Phase 2.
- **Order cloning** — re-auction after failure. Phase 2.
- **Order templates** — recurring orders for standing relationships. Phase 3.
- **Order-level smart contracts** — escrow + delivery proof + Merkle proof as one on-chain artifact. Phase 3.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Keep tenders as both auction + fulfillment | Multi-winner impossible; quality inspection has no home; dispute resolution becomes hacky. |
| Use a JSONB column on tenders | Can't query / FK / index efficiently. |
| Orders only for multi-winner cases | Inconsistent UX; Phase 2 retrofit cliff. |
| Orders as views over tenders + bids | Loses the lifecycle state; loses the order_status_transitions audit. |
| Use a separate "fulfillment" microservice | Overkill; we don't need service boundaries here. |

## Reference

- ADR-0007 — Step Functions escrow (attaches to orders, not tenders)
- ADR-0009 — Tender auction (creates orders on close)
- ADR-0010 — Carrier sub-auction (binds to orders)
- ADR-0025 — Facilities (orders reference pickup/dropoff facility)
- PRD-0008 — Pricing engine (per-order fee resolution)
