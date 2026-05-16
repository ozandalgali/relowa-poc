# ADR-0027 — Route Engine Abstraction (VRP Substrate Seat)

**Status:** Accepted
**Date:** 2026-05-16
**Decision-makers:** Ozan (lead)

## Context

The CEO's Phase 1 M3 calls out "VRP algorithm integration" as a deliverable. The supplementary briefing names **Google OR-Tools** as the engine of choice. Our current ADR-0010 (carrier sub-auction) and ADR-0013 (map provider) describe carrier matching and basic routing but not the multi-stop optimization layer.

A real VRP engine is non-trivial:

- **Time complexity:** the academic VRP is NP-hard. OR-Tools uses metaheuristics (Tabu Search, Guided Local Search, Simulated Annealing) to get near-optimal solutions in seconds.
- **Engineering complexity:** the engine consumes a fleet (vehicles + drivers + depots), a demand set (shipments with windows), and constraints (capacity, time windows, driver shift limits, vehicle type compatibility). Output is an optimized route per vehicle.
- **Real-time requirement:** dispatch decisions happen on the order of minutes. A 5-minute optimization run is acceptable; 5 hours is not.
- **Continuous re-optimization:** when a new order arrives or a driver runs late, the routing should re-optimize. The engine cannot be a one-shot batch job.

Phase 1 ships **substrate-only** (per Q4 decision). The schema, interface, and Manual implementation land in M3. The real OR-Tools integration lands in Phase 2.

This substrate-first approach has three benefits:

1. **No schema migration cliff** when Phase 2 lands.
2. **The carrier sub-auction can already create route records** — they're just trivially computed (straight line A → B).
3. **The UI for "View route" works in Phase 1** — it shows the Manual route. When Phase 2 lands, the same UI shows the OR-Tools optimized route.

## Decision

We adopt a **RouteEngine adapter** abstraction with:

- A canonical interface (`RouteEngine`) for any routing implementation.
- A `ManualRouteEngine` in P1 (straight-line shipping, no optimization).
- A `ORToolsRouteEngine` in P2 (Google OR-Tools, real VRP).
- A `OSRMRouteEngine` as a Phase 2 alternative (open-source road network routing).
- Schema for fleet (vehicles, drivers), routes (route_optimizations, route_legs), and depot bindings.
- Integration with carrier sub-auction (ADR-0010), orders (ADR-0026), and shipments.

### 1. Schema (M3 — lands with carrier sub-auction expansion)

```sql
CREATE TYPE vehicle_type AS ENUM (
  'truck_3_5t',         -- light commercial vehicle
  'truck_7_5t',
  'truck_18t',          -- standard medium truck
  'truck_24t',          -- standard heavy truck
  'truck_40t',          -- semi-trailer
  'tanker',             -- liquid waste
  'roro',               -- container truck
  'van',                -- small payload
  'pickup',
  'other'
);

CREATE TYPE vehicle_status AS ENUM (
  'available',
  'on_route',
  'maintenance',
  'out_of_service'
);

-- Fleet inventory (per carrier org). Bound to a depot facility.
CREATE TABLE vehicles (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  depot_facility_id    UUID REFERENCES facilities(id),         -- home depot
  vehicle_type         vehicle_type NOT NULL,
  plate_number         TEXT NOT NULL,                           -- TR plate
  capacity_kg          INTEGER NOT NULL,
  fuel_type            TEXT,                                    -- 'diesel' | 'electric' | 'hybrid'
  co2_g_per_km         numeric(8,2),                            -- for ESG reporting
  hazmat_certified     BOOLEAN NOT NULL DEFAULT false,          -- can carry hazardous waste
  notes                TEXT,
  status               vehicle_status NOT NULL DEFAULT 'available',
  is_active            BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at       TIMESTAMPTZ,
  CONSTRAINT vehicles_plate_unique_per_org UNIQUE (org_id, plate_number)
);

CREATE INDEX vehicles_org_idx        ON vehicles(org_id);
CREATE INDEX vehicles_status_idx     ON vehicles(status) WHERE is_active = true;
CREATE INDEX vehicles_depot_idx      ON vehicles(depot_facility_id);

-- Driver profiles (per carrier org). One driver may operate multiple vehicles.
CREATE TABLE driver_profiles (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID UNIQUE REFERENCES users(id),    -- if driver has app login
  org_id                   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name                TEXT NOT NULL,
  phone                    TEXT NOT NULL,
  license_number           TEXT,                                -- TR driver's license
  license_class            TEXT,                                -- 'C', 'D', 'E', etc.
  license_expiry           DATE,
  k1_certified             BOOLEAN NOT NULL DEFAULT false,      -- hazmat
  shift_start              TIME,                                -- typical working hours
  shift_end                TIME,
  preferred_region         TEXT,
  is_active                BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at           TIMESTAMPTZ
);

CREATE INDEX driver_profiles_org_idx ON driver_profiles(org_id);

-- Result of a route optimization run. Persisted for audit + history.
CREATE TABLE route_optimizations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   UUID NOT NULL REFERENCES organizations(id),
  triggered_by             TEXT NOT NULL,                        -- 'order.created' | 'manual' | 'reoptimize.scheduled'
  triggered_by_user_id     UUID REFERENCES users(id),
  engine_name              TEXT NOT NULL,                        -- 'manual' | 'or_tools' | 'osrm'
  engine_version           TEXT,                                 -- '9.8.0' for or_tools
  -- Input snapshot (what we asked the engine to solve)
  input_orders             jsonb NOT NULL,                        -- list of order_ids and stop info
  input_vehicles           jsonb NOT NULL,
  input_constraints        jsonb,                                -- capacity, time windows, hazmat
  -- Output
  status                   TEXT NOT NULL,                        -- 'computing' | 'completed' | 'failed'
  total_distance_km        numeric(10,2),
  total_duration_minutes   numeric(10,2),
  total_co2_grams          numeric(12,2),
  vehicles_used            INTEGER,
  optimization_score       numeric(5,2),                          -- engine's quality metric
  computed_at              TIMESTAMPTZ,
  failure_reason           TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX route_optimizations_org_idx ON route_optimizations(org_id, created_at DESC);

-- A single vehicle's route within an optimization run.
CREATE TABLE route_legs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_optimization_id    UUID NOT NULL REFERENCES route_optimizations(id) ON DELETE CASCADE,
  vehicle_id               UUID NOT NULL REFERENCES vehicles(id),
  driver_id                UUID REFERENCES driver_profiles(id),
  leg_order                INTEGER NOT NULL,                     -- 0 = first leg of route
  -- The actual stop sequence
  stops                    jsonb NOT NULL,                        -- [{stop_type, facility_id, order_id, eta, dwell_min}, ...]
  start_facility_id        UUID REFERENCES facilities(id),       -- usually depot
  end_facility_id          UUID REFERENCES facilities(id),       -- usually back to depot
  distance_km              numeric(8,2),
  duration_minutes         numeric(8,2),
  co2_grams                numeric(10,2),
  polyline                 TEXT,                                  -- encoded polyline for map display
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX route_legs_optimization_idx ON route_legs(route_optimization_id, leg_order);
CREATE INDEX route_legs_vehicle_idx       ON route_legs(vehicle_id);

-- Per-shipment stop details. Already specified in ADR-0010 but extended here.
ALTER TABLE shipments ADD COLUMN route_leg_id UUID REFERENCES route_legs(id);
ALTER TABLE shipments ADD COLUMN sequence_in_leg INTEGER;

CREATE TABLE shipment_stops (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id              UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  stop_order               INTEGER NOT NULL,
  stop_type                TEXT NOT NULL,                        -- 'pickup' | 'dropoff' | 'transfer'
  facility_id              UUID NOT NULL REFERENCES facilities(id),
  expected_at              TIMESTAMPTZ,
  actual_at                TIMESTAMPTZ,
  status                   TEXT NOT NULL DEFAULT 'pending',      -- 'pending' | 'arrived' | 'completed' | 'skipped'
  notes                    TEXT
);

CREATE INDEX shipment_stops_shipment_idx ON shipment_stops(shipment_id, stop_order);
```

### 2. RLS

```sql
-- Vehicles: only carrier org sees own; super_admin sees all
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_select_own_org ON vehicles
  FOR SELECT USING (org_id = auth.org_id());

-- Drivers: same
ALTER TABLE driver_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_profiles_select_own_org ON driver_profiles
  FOR SELECT USING (org_id = auth.org_id());

-- Route optimizations: org-scoped
ALTER TABLE route_optimizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY route_optimizations_select_own_org ON route_optimizations
  FOR SELECT USING (org_id = auth.org_id());

-- Route legs: visible if user can see the optimization
ALTER TABLE route_legs ENABLE ROW LEVEL SECURITY;
CREATE POLICY route_legs_select_via_optimization ON route_legs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM route_optimizations ro
      WHERE ro.id = route_legs.route_optimization_id
        AND ro.org_id = auth.org_id()
    )
  );
```

### 3. RouteEngine adapter interface

```ts
// packages/route-engine/provider.interface.ts
export interface RouteEngine {
  readonly name: 'manual' | 'or_tools' | 'osrm';
  readonly version: string;

  /**
   * Solve a vehicle routing problem.
   * Returns one route per vehicle, with stops in optimized order.
   */
  optimize(req: OptimizeRequest): Promise<OptimizeResult>;

  /**
   * Quick distance/duration calculation between two points.
   * Used for marketplace matching ("show me orders within 100km").
   */
  estimateDistance(req: {
    from: { lat: number; lng: number };
    to: { lat: number; lng: number };
    vehicle?: { type: VehicleType };
  }): Promise<{
    distanceKm: number;
    durationMinutes: number;
  }>;

  /**
   * Re-optimize an existing route plan when conditions change.
   * (Phase 2)
   */
  reoptimize?(req: ReoptimizeRequest): Promise<OptimizeResult>;
}

export interface OptimizeRequest {
  orgId: string;
  triggeredBy: string;
  triggeredByUserId?: string;
  orders: OrderForRouting[];                     // pickup + dropoff per order
  vehicles: VehicleForRouting[];
  constraints?: RoutingConstraints;
}

export interface OrderForRouting {
  orderId: string;
  pickupFacility: { id: string; lat: number; lng: number };
  dropoffFacility: { id: string; lat: number; lng: number };
  weightKg: number;
  pickupWindowStart?: Date;
  pickupWindowEnd?: Date;
  expectedDeliveryAt?: Date;
  vehicleTypeRequired?: VehicleType[];
  hazmat?: boolean;
}

export interface VehicleForRouting {
  vehicleId: string;
  depotFacility: { id: string; lat: number; lng: number };
  capacityKg: number;
  type: VehicleType;
  hazmatCertified: boolean;
  availableFrom?: Date;
  availableUntil?: Date;
}

export interface RoutingConstraints {
  maxRouteDurationMinutes?: number;
  maxRouteDistanceKm?: number;
  driverShiftMinutes?: number;
  optimizationGoal?: 'minimize_distance' | 'minimize_duration' | 'minimize_co2' | 'balanced';
}

export interface OptimizeResult {
  routeOptimizationId: string;
  status: 'completed' | 'partial' | 'failed';
  routes: VehicleRoute[];
  totalDistanceKm: number;
  totalDurationMinutes: number;
  totalCo2Grams: number;
  unassignedOrders: string[];                    // orders that couldn't fit
  failureReason?: string;
}

export interface VehicleRoute {
  vehicleId: string;
  stops: RouteStop[];
  distanceKm: number;
  durationMinutes: number;
  co2Grams: number;
  polyline?: string;
}

export interface RouteStop {
  stopType: 'depot_start' | 'pickup' | 'dropoff' | 'depot_end';
  facilityId: string;
  orderId?: string;                              // null for depot stops
  arriveAt: Date;
  dwellMinutes?: number;
  departAt: Date;
}
```

### 4. ManualRouteEngine — P1 implementation

The Manual engine implements the interface with no optimization. For each order, it creates a one-stop-pickup → one-stop-dropoff route on the first available vehicle of the required type:

```
function optimize(req):
  routes = []
  unassigned = []
  for order in req.orders:
    candidate = req.vehicles.find(v =>
      v.capacityKg >= order.weightKg AND
      (order.hazmat ? v.hazmatCertified : true) AND
      v.type in (order.vehicleTypeRequired ?? all)
    )
    if !candidate:
      unassigned.push(order.orderId)
      continue
    distance = haversine(candidate.depotFacility, order.pickupFacility)
             + haversine(order.pickupFacility, order.dropoffFacility)
             + haversine(order.dropoffFacility, candidate.depotFacility)
    routes.push({
      vehicleId: candidate.vehicleId,
      stops: [depot_start, pickup, dropoff, depot_end],
      distanceKm: distance,
      durationMinutes: distance / 50 * 60,        // assume 50 km/h average
      co2Grams: distance * (candidate.co2_g_per_km ?? 200)
    })
  return { routeOptimizationId, status: 'completed', routes, ... }
```

This is naive but **complete** — every API call works, the route table populates, the UI renders routes. When Phase 2 swaps in OR-Tools, no surrounding code changes.

### 5. The decision points where the engine is invoked

| Trigger | Action |
|---|---|
| `order.created` | Background Lambda runs `optimize()` for the carrier org's unassigned orders (re-running every N orders or every X minutes) |
| Carrier user clicks "Plan today's routes" | Synchronous `optimize()` over today's open orders |
| New vehicle added | Re-optimize (re-balance loads) |
| Driver runs late | `reoptimize()` triggered (Phase 2) |
| Manual carrier assignment | Bypass optimizer; recycler picked specific carrier; engine generates trivial single-stop route |

### 6. Operational fit with carrier sub-auction (ADR-0010)

The carrier sub-auction predates routing. They coexist:

- Recycler creates a carrier ad (transport job).
- Carriers bid. Recycler picks a winner.
- The winning carrier's app shows the order on their list.
- When carrier user opens "Today's routes," the route engine optimizes across all their assigned orders.
- A single optimization run may include orders from multiple recyclers if the same carrier won multiple ads.

### 7. KVKK / data residency

- Vehicle plate numbers + driver license numbers are PII for KVKK purposes.
- Route engine processing happens in `eu-central-1`; no data leaves region.
- OR-Tools runs in-process (Lambda or container); no external API call.
- OSRM (Phase 2 alternative) runs self-hosted in our VPC; no external data flow.
- Driver location pings (when they have the app) tracked in `shipment_events` per ADR-0010; data subject rights honored same as other PII.

### 8. Cost model

- Manual engine: zero cost (in-process function).
- OR-Tools: $0 software cost; $20–100/mo compute (Lambda or ECS depending on optimization volume).
- OSRM tile data: 5 GB OSM Turkey extract; minor S3 cost.
- AWS Location routing (ADR-0013): separate, used for distance estimation if not running OSRM.

### 9. Substrate-vs-implementation table

| Element | P1 ships | P2 ships |
|---|---|---|
| Schema (vehicles, drivers, route_optimizations, route_legs, shipment_stops) | ✅ Full schema | (no change) |
| RouteEngine interface | ✅ Defined | (no change) |
| ManualRouteEngine | ✅ Operational | Kept for tests + degraded mode |
| ORToolsRouteEngine | — | ✅ Real VRP |
| Re-optimization scheduling | — | ✅ Lambda triggers |
| Driver mobile app integration | — | ✅ Routes pushed to driver app |
| Live traffic-aware ETA | — | ✅ Via AWS Location traffic API |

## Consequences

### Positive

- **Phase 1 has working route data** — every order produces a route record (even if trivial).
- **Schema commits now; no migration cliff** when OR-Tools lands.
- **Carrier app development can begin in Phase 1** with the Manual engine output.
- **ESG calculations work from M3** — co2 grams per leg recorded.
- **Marketplace matching gets distance estimates** — `estimateDistance` works even with Manual engine.
- **Multiple engines coexist** — OR-Tools for complex multi-stop, OSRM for simple A-to-B, AWS Location for high-traffic real-time.

### Negative

- **Manual engine produces sub-optimal routes** — that's by design in P1. Customers know they're getting "basic routing"; Pro/Enterprise unlock real optimization in P2.
- **Schema has 5 new tables + extensions** in M3. Mitigated by clear separation from auction logic.
- **Re-optimization isn't real until P2** — recycler/carrier user workflows assume routes are static. Acceptable for pilot.

## Future plans

- **ORToolsRouteEngine (P2)** — Python sidecar service (`apps/route-engine/`) running OR-Tools via gRPC/HTTP.
- **OSRMRouteEngine (P2)** — self-hosted OSRM container; real road network routing.
- **AWS Location routing engine** — for traffic-aware ETAs at production scale.
- **Multi-objective optimization** — minimize cost + carbon + time as combined objective (Phase 3).
- **ML-augmented routing** — historical traffic patterns, driver performance, customer service-time prediction (Phase 3).
- **Cross-org carrier consolidation** — one Relowa-managed mega-route across multiple carriers (Phase 3).
- **Real-time route adaptation** — driver runs late → reoptimize and notify affected recyclers (Phase 2 stretch).
- **Drone / autonomous vehicle planning** — different vehicle_type with different cost model (Phase 4+).
- **Carbon offsetting calculations** — per-route carbon footprint feeds into ESG certificate (Phase 2).

## Alternatives considered

| Option | Rejected because |
|---|---|
| No route engine in P1 | Carrier app has no routes to display; ESG calculations have no per-leg co2; future migration painful. |
| Build OR-Tools directly in P1 | Solo lead time-sink; ManualRouteEngine sufficient for pilot. |
| Use third-party routing SaaS (Routific, Onfleet, etc.) | Adds vendor + per-request fee + data egress; we want this in-VPC. |
| Skip vehicles/drivers schema; bind shipments directly to carriers | Phase 2 retrofit; fleet management is a core carrier capability. |
| Single global "best route" SaaS | Doesn't match our multi-tenant per-carrier-org model. |

## Reference

- ADR-0010 — Carrier sub-auction (orders flow through here before routing)
- ADR-0013 — Map provider abstraction (used for tile rendering of routes; can also provide distance estimation as alternative to RouteEngine)
- ADR-0025 — Facilities (depot, pickup, dropoff are all facilities)
- ADR-0026 — Orders (the unit of routing demand)
- PRD-0008 — Pricing engine (route distance feeds into transport fee calculation)
- Google OR-Tools VRP: https://developers.google.com/optimization/routing
- OSRM: http://project-osrm.org
- AWS Location: https://docs.aws.amazon.com/location/
