# ADR-0010 — Carrier Sub-Auction (Logistics Module)

**Status:** Accepted
**Date:** 2026-05-13
**Decision-makers:** Ozan (lead)

## Context

The Figma flow "Recycler Taşıyıcı İlanı" (batch-05b) reveals a second auction loop inside the platform that PRD-0002 did not explicitly scope:

> After a recycler wins a waste tender, they open a *carrier ad* (`Taşıyıcı İlanı`) describing the route, weight, and pickup/dropoff. Carriers see the ad in their feed, submit price + ETA bids, and the recycler picks a winner. The chosen carrier transports the waste.

This is a separate auction from the waste-tender auction. The actors flip (recycler is now the *buyer*, carrier is the *seller*), the price field is different (transport price, not per-ton waste price), the temporal pattern differs (no anti-sniping needed; recycler picks manually), and the AI-augmentation is different (suggesting "AI: Best Value" and "AI: Fastest" candidates rather than purity scoring).

PRD-0002 said carrier assignment is "operationally managed" in Phase 1 — meaning Relowa staff would manually coordinate carriers via phone/email. The Figma flow assumes a productized sub-auction. The discrepancy is real: this ADR resolves it by **planning the model now** (per Q6 decision: "even its phase 2 I want it to be planned beforehand"), even though shipping the UI may slide to Phase 2 if M4/M5 capacity runs short.

## Decision

We commit the **carrier sub-auction data model in M1** (alongside the tender/bid model) and a **simplified version of the API in M2** (create ad, list, pick winner — no live bid push). Full UI and real-time push land in M3/M5 unless cut. The schema is forward-compatible with the full Figma flow including AI scoring.

### 1. Conceptual model

```
Tender (existing — Producer → Recyclers)
  Producer creates → Recyclers bid → server closes → winner_bid_id set
                                                            │
                                                            ▼
                                                    Tender becomes WON
                                                            │
                                  ┌─────────────────────────┴─────────────────────────┐
                                  │                                                   │
                  CarrierAd (new — Recycler → Carriers)             Shipment (new — represents physical transport)
                  Recycler creates → Carriers bid → Recycler picks → Shipment created
```

A CarrierAd may be opened **before** escrow funds settle (so carriers can plan), but transport doesn't start until escrow is `FUNDS_LOCKED` (ADR-0007). The flow is decoupled to allow parallel logistics planning.

### 2. Schema (M1)

```sql
CREATE TYPE carrier_ad_status AS ENUM (
  'open',          -- accepting carrier bids
  'closing',       -- recycler is reviewing
  'awarded',       -- carrier picked, shipment created
  'cancelled',     -- recycler cancelled
  'expired'        -- expired without award
);

CREATE TYPE carrier_bid_status AS ENUM (
  'submitted',
  'withdrawn',
  'rejected',
  'accepted'       -- the winning bid
);

CREATE TYPE shipment_status AS ENUM (
  'pending',       -- carrier picked, awaiting pickup window
  'in_transit',    -- driver started route
  'delivered',     -- recycler confirmed receipt
  'disputed',      -- damage/quantity dispute
  'completed'      -- after dispute window
);

CREATE TABLE carrier_ads (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id          UUID NOT NULL REFERENCES tenders(id) ON DELETE RESTRICT,
  recycler_org_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  pickup_lat         numeric(9,6) NOT NULL,
  pickup_lng         numeric(9,6) NOT NULL,
  pickup_address     text NOT NULL,
  dropoff_lat        numeric(9,6) NOT NULL,
  dropoff_lng        numeric(9,6) NOT NULL,
  dropoff_address    text NOT NULL,
  weight_kg          integer NOT NULL,
  vehicle_type       text NOT NULL,                -- 'truck_3_5t' | 'truck_7_5t' | 'truck_24t' | 'tanker' | ...
  pickup_window_start timestamptz NOT NULL,
  pickup_window_end   timestamptz NOT NULL,
  notes              text,
  status             carrier_ad_status NOT NULL DEFAULT 'open',
  closes_at          timestamptz NOT NULL,
  winner_bid_id      uuid,                          -- FK added after carrier_bids exists
  awarded_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX carrier_ads_tender_idx     ON carrier_ads(tender_id);
CREATE INDEX carrier_ads_recycler_idx   ON carrier_ads(recycler_org_id);
CREATE INDEX carrier_ads_status_idx     ON carrier_ads(status);
CREATE INDEX carrier_ads_pickup_geo_idx ON carrier_ads(pickup_lat, pickup_lng);

CREATE TABLE carrier_bids (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_ad_id      UUID NOT NULL REFERENCES carrier_ads(id) ON DELETE CASCADE,
  carrier_org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  bidder_user_id     UUID NOT NULL REFERENCES users(id),
  price              numeric(14,2) NOT NULL,        -- total transport price, not per-km
  estimated_eta      timestamptz NOT NULL,
  vehicle_capacity_kg integer NOT NULL,
  ai_score_value     numeric(4,2),                  -- 0.00-1.00, optional
  ai_score_speed     numeric(4,2),
  ai_label           text,                          -- 'best_value' | 'fastest' | null
  status             carrier_bid_status NOT NULL DEFAULT 'submitted',
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE carrier_ads
  ADD CONSTRAINT carrier_ads_winner_bid_fk
  FOREIGN KEY (winner_bid_id) REFERENCES carrier_bids(id);

CREATE INDEX carrier_bids_ad_idx       ON carrier_bids(carrier_ad_id);
CREATE INDEX carrier_bids_carrier_idx  ON carrier_bids(carrier_org_id);
CREATE INDEX carrier_bids_status_idx   ON carrier_bids(status);

CREATE TABLE shipments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id          UUID NOT NULL REFERENCES tenders(id) ON DELETE RESTRICT,
  carrier_ad_id      UUID REFERENCES carrier_ads(id) ON DELETE SET NULL,
  carrier_org_id     UUID NOT NULL REFERENCES organizations(id),
  recycler_org_id    UUID NOT NULL REFERENCES organizations(id),
  producer_org_id    UUID NOT NULL REFERENCES organizations(id),
  agreed_price       numeric(14,2) NOT NULL,
  status             shipment_status NOT NULL DEFAULT 'pending',
  pickup_at          timestamptz,
  delivered_at       timestamptz,
  irsaliye_no        text,                           -- delivery note number, Turkish regulatory
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shipments_tender_idx   ON shipments(tender_id);
CREATE INDEX shipments_carrier_idx  ON shipments(carrier_org_id);
CREATE INDEX shipments_recycler_idx ON shipments(recycler_org_id);
CREATE INDEX shipments_status_idx   ON shipments(status);

CREATE TABLE shipment_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id   UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  event_type    text NOT NULL,         -- 'pickup_arrived' | 'pickup_complete' | 'in_transit_ping' | 'delivered' | ...
  actor_user_id UUID REFERENCES users(id),
  lat           numeric(9,6),
  lng           numeric(9,6),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shipment_events_shipment_idx ON shipment_events(shipment_id, created_at);
```

All tables have RLS enabled with policies analogous to existing tender/bid policies. Detailed policies live in the migration side-car.

### 3. RLS policies (summary)

| Table | Producer | Recycler | Carrier |
|---|---|---|---|
| `carrier_ads` | read own tender's ads | read+write own ads | read open ads (all) |
| `carrier_bids` | no access | read bids on own ads | read+write own bids |
| `shipments` | read shipments for own tender | read own | read own |
| `shipment_events` | read for own | read for own | read+write for own |

Cross-tenant invariant: no producer ever sees a recycler-carrier price; no carrier ever sees another carrier's bid until the ad is awarded (and even then, only winning bid + winner identity).

### 4. API endpoints (M2 simplified, M3 expanded)

**M2 (synchronous, no live push):**

```
POST   /carrier-ads                         (recycler)  create ad
GET    /carrier-ads                         (recycler)  my own
GET    /carrier-ads/:id                     (recycler+) detail with bids if owner
POST   /carrier-ads/:id/cancel              (recycler)  cancel
GET    /carriers/feed                       (carrier)   open ads filtered by region/vehicle
POST   /carrier-ads/:id/bids                (carrier)   submit bid
PATCH  /carrier-ads/:id/bids/:bidId         (carrier)   withdraw own bid
POST   /carrier-ads/:id/award               (recycler)  pick a winning bid, creates shipment row
POST   /shipments/:id/events                (carrier)   submit pickup/in-transit/delivered event
PATCH  /shipments/:id/confirm-delivery      (recycler)  confirm receipt
```

Every mutation accepts `Idempotency-Key`. Every mutation writes `audit_events`. Carrier bids fire an EventBridge event `carrier_bid.placed` (used by the AI scoring job later); awards fire `carrier_ad.awarded`; shipment events fire `shipment.<event_type>`.

**M3 additions:**

- AppSync subscriptions `onCarrierBidPlaced(carrier_ad_id)` and `onShipmentEvent(shipment_id)` via the outbox pattern (ADR-0006).
- AI scoring Lambda: triggered by `carrier_bid.placed`, computes `ai_score_value` and `ai_score_speed` against historical carrier performance, updates the bid row.

### 5. AI scoring labels

The Figma badges `AI: BEST VALUE` and `AI: FASTEST` come from a scoring job that runs per bid:

- **value score** — function of `price` vs. ad's expected market price, weighted by carrier's historical on-time delivery rate.
- **speed score** — function of `estimated_eta` vs. ad's `pickup_window_start`, weighted by carrier's historical adherence to ETA.
- `ai_label` is set to `'best_value'` for the highest value-score bid, `'fastest'` for the lowest ETA, only if confidence > 0.7. Labels are exclusive (a bid is either best-value or fastest, not both — if it would be both, prefer best-value).

The scoring function lives in `apps/ai-proxy` or inline if simple enough; not a P1 priority. The schema accommodates it; P1 ships nulls in those columns and renders no badges.

### 6. No anti-sniping

Unlike the waste-tender auction, carrier ads don't extend on late bids. Reason: carriers may legitimately submit a price minutes before close — there's no pricing-game incentive comparable to tender bidding because the *recycler* picks the winner manually (not an automatic high-price-wins rule). The recycler can pick any bid, not necessarily the lowest.

`closes_at` is a soft deadline. After `closes_at`, the ad moves to `closing` status (no new bids) and the recycler has 24h to award; if not awarded, ad expires.

### 7. Award flow (the manual pick)

Unlike the waste tender (server-authoritative auto-close), the carrier ad is **recycler-authoritative**. The recycler explicitly picks a winner:

```
POST /carrier-ads/:id/award
  body: { winning_bid_id: uuid }

In one transaction:
  1. UPDATE carrier_ads SET status='awarded', winner_bid_id=$, awarded_at=now()
  2. UPDATE carrier_bids SET status='accepted' WHERE id=$
  3. UPDATE carrier_bids SET status='rejected' WHERE carrier_ad_id=$ AND id!=$
  4. INSERT INTO shipments (...)
  5. INSERT INTO audit_events (...)
COMMIT

Then publish:
  - carrier_ad.awarded
  - shipment.created
  - email to winning carrier
  - email to losing carriers (rejection)
```

The recycler does have a UX confirmation step in the Figma (`Relowa - Taşıyıcı Seçim Onayı.png`) — a modal asking "are you sure?" because award is irreversible. The schema reflects this: no cancel after award; disputes go through the shipment dispute flow, not back to award.

### 8. Cross-module touchpoints

- **Escrow (ADR-0007)** — shipment's `agreed_price` for the carrier is held within the larger tender escrow. Producer pays recycler (waste price), recycler pays carrier (transport price). The escrow state machine treats these as separate disbursements at `delivered` status.
- **ESG (ADR-0008 indirect)** — shipment events feed `carbon_calculations` (km × vehicle CO₂ coefficient). A shipment's contribution to ESG is finalized at `completed` status.
- **Notifications (M3)** — every carrier ad open/award fires email to relevant parties via SQS → Lambda → SES.

## Consequences

### Positive

- Phase 1 substrate supports the full Figma flow even if the UI ships in Phase 2.
- Carrier role gains a real product surface (the feed + bidding) without forcing the Phase 1 timeline.
- Schema separates carrier transport price from waste tender price cleanly — no overloading `bids` table with two semantics.
- Same event-driven primitives reused: EventBridge + audit + idempotency on every mutation.

### Negative

- More tables in P1 schema (4 new tables). Migration cost: ~50 lines of side-car RLS SQL. Acceptable.
- Two auction loops increase cognitive load for new contributors. Mitigated by this ADR being the canonical explainer.
- Recycler-authoritative award means we can't run the same anti-sniping pattern; not a real downside, just a different model.
- AI scoring is hand-wavy in P1; the schema accepts nulls and the UI renders without badges. Honest about the limit.

## Future plans

- **Carrier reputation scoring** — `carriers.reputation_score` derived from on-time delivery, damage rate, dispute frequency. Surfaces in the carrier ad detail view. Phase 2.
- **Multi-leg shipments** — for waste that needs intermediate transfer (e.g. consolidation depots), break a shipment into legs with separate carriers per leg. Phase 2/3.
- **Reverse auction mode** — instead of "carriers bid down," a "Dutch auction" where price starts high and drops every N minutes until a carrier accepts. Phase 3 experiment.
- **Live GPS tracking** — carrier driver app pushes `shipment_events` with type `in_transit_ping` every 60s; map (ADR-0013) renders live. Phase 2 (depends on driver app).
- **Truck-routing constraints** — `vehicle_type` ↔ routing engine `truck_profile` mapping (e.g. ADR-truck routes for hazardous waste). Connects to ADR-0013 future plans.
- **Real-time outbid notifications for carriers** — push notification when a competing bid lower than theirs is submitted. Phase 2.
- **Recycler favorites / preferred carriers list** — recurring routes get auto-suggested carrier shortlist. Phase 2.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Reuse `bids` table for carrier bids | Overloads schema with two semantics (per-ton waste price vs. flat transport price); confuses RLS policies. |
| No carrier auction; manual coordination (PRD-0002 original) | Doesn't match Figma; falls back to phone/email for the most logistically complex piece. We commit to productizing it. |
| Pure server-authoritative pick (lowest price wins) | Strips the recycler's judgment (carrier reputation, vehicle fit, special handling). Manual pick is a real product requirement. |
| Inline carrier in tender (same auction, carrier as third party) | Conflates two distinct exchanges. The pricing structures don't compose. |
| Step Functions for carrier-ad lifecycle | Overkill; the lifecycle is short (hours to days) with no multi-day waits. Reserve Step Functions for escrow (ADR-0007). |

## Reference

- ADR-0009 — Tender auction (the waste-side auction this complements)
- ADR-0007 — Step Functions escrow (the payment flow that includes carrier disbursement)
- ADR-0013 — Map provider abstraction (used by `carrier_ads` map UI and shipment tracking)
- ADR-0006 — Outbox/AppSync (for live bid push, M3 addition)
- PRD-0004 — Module Map (Logistics & Operations bucket)
- Figma batch 05a/05b — `docs/figma/extracted/batch-05a-operations.json`, `batch-05b-carrier-bids.json`
