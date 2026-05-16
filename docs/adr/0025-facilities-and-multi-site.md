# ADR-0025 — Facilities & Multi-Site Model

**Status:** Accepted
**Date:** 2026-05-16
**Decision-makers:** Ozan (lead)

## Context

Current schema treats `organizations` as a single entity with one `address` and one `region`. The CEO's database ERD (and real enterprise customers) reveal this is wrong: **one organization has many physical facilities**.

Examples:

- **Acme A.Ş.** — corporate entity. Plants in Istanbul, Ankara, İzmir. Each plant generates waste independently. Each has its own Çevre Lisansı, contact, address.
- **EkoMetal Geri Dönüşüm Holding** — parent. Operates three recycling facilities (Kocaeli plastic, Ankara metal, Bursa paper). Each facility has its own ISO 14001 cert, its own EAEK accepted-waste-codes, its own dock for delivery.
- **HızlıTrans Lojistik** — parent. Multiple regional depots. Each depot has its own vehicle pool.

Without a facilities concept:

- A tender's pickup location is just text; can't be properly authorized or geographically queried.
- An account manager cannot be assigned "just the Istanbul plant" of a multi-site org.
- Recycling facility's accepted-waste-codes can't be set per-facility (one site might do plastic, another metal).
- Fleet management (Layer 3 logistics) cannot bind vehicles to a home depot.
- Compliance documents (Çevre Lisansı) need per-facility validity.
- ESG reporting becomes meaningless (carbon footprint per facility, not per org).
- The Enterprise tier promises "multi-facility management" — we can't deliver without this.

Retrofit cost grows weekly. We commit the model now (M1 schema), implement progressively.

## Decision

We adopt a **`facilities` table separate from `organizations`** with `org_id` foreign key. Tenders, shipments, carrier ads, vehicles, devices, AI inference units, and licenses all bind to a facility, not an org directly.

### 1. Schema (M1)

```sql
CREATE TYPE facility_type AS ENUM (
  'producer_plant',          -- waste-generating industrial site
  'recycling_facility',      -- recycling plant (MRF, granulator, etc.)
  'carrier_depot',           -- logistics depot / hub
  'producer_collection_point', -- smaller collection point (e.g. warehouse)
  'storage_intermediate',    -- intermediate ara depo
  'office_only'              -- non-operational (HQ); excluded from operational queries
);

CREATE TABLE facilities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  facility_type       facility_type NOT NULL,
  name                TEXT NOT NULL,                     -- 'Istanbul Plant 1', 'Kocaeli Recycling'
  short_code          TEXT NOT NULL,                     -- 'IST-01', 'KOC-REC'
  address             TEXT NOT NULL,
  city                TEXT NOT NULL,
  region              TEXT NOT NULL,                     -- 'Kocaeli', 'İstanbul'
  postal_code         TEXT,
  country             TEXT NOT NULL DEFAULT 'TR',
  lat                 numeric(9,6),                       -- for VRP, geo queries
  lng                 numeric(9,6),
  contact_user_id     UUID REFERENCES users(id),           -- facility manager
  contact_phone       TEXT,
  contact_email       TEXT,
  operational_hours   jsonb,                               -- {'mon': '08:00-17:00', ...}
  capacity_tons_month numeric(12,3),                       -- processing capacity per month (for recyclers)
  accepted_waste_codes TEXT[],                             -- EAEK codes (for recyclers)
  notes               TEXT,
  is_primary          BOOLEAN NOT NULL DEFAULT false,      -- the org's main / default facility
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at      TIMESTAMPTZ,
  CONSTRAINT facilities_unique_short_code_per_org
    UNIQUE (org_id, short_code)
);

CREATE INDEX facilities_org_idx              ON facilities(org_id);
CREATE INDEX facilities_type_idx             ON facilities(facility_type);
CREATE INDEX facilities_region_idx           ON facilities(region);
CREATE INDEX facilities_geo_idx              ON facilities(lat, lng);
CREATE UNIQUE INDEX facilities_one_primary_per_org
  ON facilities(org_id) WHERE is_primary;

-- A trigger ensures every active org has exactly one primary facility.

-- Per-facility documents (Çevre Lisansı, K1, ISO 14001 etc.)
ALTER TABLE org_documents ADD COLUMN facility_id UUID REFERENCES facilities(id);

-- A document may be org-level (e.g. Vergi Levhası) or facility-level (Çevre Lisansı).
-- facility_id IS NULL means org-level.
```

### 2. RLS

`facilities` table has these policies:

```sql
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY facilities_select_own_org ON facilities
  FOR SELECT USING (org_id = auth.org_id());

CREATE POLICY facilities_select_marketplace ON facilities
  FOR SELECT USING (
    facility_type = 'recycling_facility'
    AND is_active = true
    -- Public-facing facility info visible to all authenticated users for marketplace matching
  );

CREATE POLICY facilities_insert_admin ON facilities
  FOR INSERT WITH CHECK (
    org_id = auth.org_id() AND auth.has_role('admin')
  );

CREATE POLICY facilities_update_admin_or_ops ON facilities
  FOR UPDATE USING (
    org_id = auth.org_id()
    AND (auth.has_role('admin') OR auth.has_role('operations'))
  );

-- No DELETE policy. Use deactivation (is_active=false).
```

Staff RBAC extends:

- `staff_org_assignments` gets a nullable `facility_id` column. When set, the staff member's scope is **only that facility** within the org.
- A super_admin can still see all facilities of any org.
- Account managers can be assigned to specific facilities — useful when an enterprise customer has multiple plants managed by different territory reps.

### 3. Migration of existing schema

Tables that currently bind to `organizations` get an optional `facility_id` foreign key:

```sql
-- Tenders bind to a facility (the pickup location)
ALTER TABLE tenders ADD COLUMN pickup_facility_id UUID REFERENCES facilities(id);
-- For migration: backfill from address by creating an implicit "primary" facility per org.

-- Shipments have pickup and dropoff facilities
ALTER TABLE shipments
  ADD COLUMN pickup_facility_id UUID REFERENCES facilities(id),
  ADD COLUMN dropoff_facility_id UUID REFERENCES facilities(id);

-- Carrier ads bind to pickup + dropoff facilities
ALTER TABLE carrier_ads
  ADD COLUMN pickup_facility_id UUID REFERENCES facilities(id),
  ADD COLUMN dropoff_facility_id UUID REFERENCES facilities(id);

-- Future tables (vehicles, devices, ai_inference_units) bind to facility natively.
```

`tenders.pickup_address` and `tenders.pickup_region` become **derived/legacy** — facility is the new source of truth. New tenders REQUIRE `pickup_facility_id`; legacy rows backfill.

### 4. Onboarding flow updates (PRD-0009 amendment)

Registration form gets:

- After org creation: **mandatory primary facility creation** with same form fields (address, region, type-specific extras).
- For recyclers: per-facility EAEK codes + Çevre Lisansı + processing capacity.
- For carriers: per-depot vehicle types + service regions + K1 license.
- For producers: per-plant material types + expected output.

**Multi-facility orgs add additional facilities later** via `/ayarlar/tesisler`. Pricing tier matters:

- **Free / Pro tiers:** 1 facility only.
- **Enterprise tier:** unlimited facilities (per the CEO matrix feature flag).

Feature flag enforced: `tier.features.multi_facility = true | false`.

### 5. Auth & JWT impact

The JWT does not carry a `facility_id` claim by default (operator has access to all their org's facilities). But:

- A future "facility switcher" UI (Phase 2) can issue JWTs with `active_facility_id` for visual context.
- Staff impersonation can set `acting_facility_id` to scope a session to one facility.

ADR-0005 (Cognito) is unchanged. Facility scoping is application-layer, not RLS-layer (RLS scopes by org).

### 6. UI implications

The Figma screens largely show single-facility orgs. Multi-facility additions:

- **Settings:** new "Tesisler" tab (currently shown as "Lokasyonlar" implicit). List with add/edit/deactivate, primary indicator.
- **Tender create:** facility dropdown (instead of free-text address); pre-fills address from facility.
- **Operations tracking:** filter by facility (multi-select).
- **ESG reports:** drillable by facility (per-facility carbon footprint).
- **Dashboard:** Enterprise-tier orgs see a facility-comparison widget.

Free / Pro tiers see no UI change (single facility, mostly invisible). Enterprise tier sees facility-aware features.

### 7. Geo queries — the immediate Phase 1 benefit

Even before VRP (ADR-0027), facility lat/lng enables:

- **Marketplace matching:** "show me tenders within 100km of my facility" (ST_DWithin via PostGIS).
- **Carrier ad matching:** "show me transport jobs starting near my depot."
- **Service area filtering:** carrier indicates service regions; producer facility's region matches.

PostGIS extension added to `init.sql` to support these queries:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
ALTER TABLE facilities ADD COLUMN geom geometry(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED;
CREATE INDEX facilities_geom_idx ON facilities USING GIST (geom);
```

### 8. Compliance per facility

- Çevre Lisansı validity is **per-facility** (M1 already requires this — PRD-0009).
- An expiring Çevre Lisansı blocks new tenders from that specific facility (not the whole org).
- ISO 14001 certs are per-facility, with expiry tracking.
- Per-facility KVKK aydınlatma metni acceptance is not required; org-level is sufficient.

### 9. Cost model

- Single additional table (`facilities`) + 4-5 columns added to existing tables.
- PostGIS extension is free, included in RDS Postgres images.
- Migration cost: small one-time backfill per existing org (creates primary facility from address).
- Storage: negligible (50–200 facilities expected at pilot).

## Consequences

### Positive

- **Enterprise tier delivers on its promise** — multi-facility management is a real product surface.
- **Geo queries enabled today** — marketplace matching improves immediately.
- **Per-facility compliance** prevents blanket org suspension for one facility's expired license.
- **VRP (ADR-0027) has the substrate** — vehicles bind to facility, shipments have pickup/dropoff facilities.
- **ESG reporting becomes meaningful** at the facility level.
- **Account manager scoping** can be per-facility (territory rep model).

### Negative

- **Schema churn on existing tables** — 4 tables get new facility_id columns. M1 migration, mitigated by single-facility default.
- **UI complexity for multi-facility orgs** — facility switcher / filters add UI surface.
- **Backfill on existing data** — every existing org gets one "primary" facility synthesized from address.
- **PostGIS adds 100MB to RDS image** — negligible at our scale.

## Future plans

- **Facility groups / regions** — group facilities into territories for territory-rep assignment. Phase 2.
- **Facility-level user permissions** — an "Istanbul plant manager" role with auth only over that facility. Phase 2.
- **Facility-level analytics** — drill-down dashboards. Phase 2.
- **Cross-facility transfers** — internal logistics between same-org facilities. Phase 3.
- **Franchise / sub-tenant model** — facility is itself a smaller tenant. Phase 3.
- **Geo-fencing alerts** — when a vehicle enters a facility's geofence, auto-trigger pickup event. Phase 3.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Stay with single `organizations.address` | Multi-site orgs unsupported; promised by Enterprise tier. |
| Encode facilities as a JSONB array on `organizations` | Can't FK to it; can't RLS on it; can't index efficiently. |
| Facilities as `org_locations` with no type | Conflates carrier depots with producer plants; type differentiation is meaningful for the routing engine and waste-codes constraints. |
| Per-facility tenant isolation (separate orgs per site) | Operationally absurd; breaks "single login, multi-site" UX. |

## Reference

- ADR-0003 — RLS with JWT-GUC (facility-level extends but uses org as the boundary)
- ADR-0014 — Internal staff RBAC (staff_org_assignments gets facility_id)
- ADR-0027 — Route engine (vehicles bind to facility)
- ADR-0028 — IoT ingestion (devices bind to facility)
- PRD-0008 — Pricing engine (multi_facility feature flag)
- PRD-0009 — Onboarding (facility creation flow)
- PostGIS: https://postgis.net
