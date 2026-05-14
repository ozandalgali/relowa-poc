# ADR-0013 — Map Provider Abstraction

**Status:** Accepted
**Date:** 2026-05-13
**Decision-makers:** Ozan (lead)

## Context

Two Figma flows depend on maps:

1. **Operations tracking** (`Relowa - Operasyonel Takip *`, `Relowa - Recycler Aktif Lojistik Detay`) — live route between pickup and delivery with vehicle position, ETA, and route-deviation alerts.
2. **Address selection modal** (`Relowa - Recycler Taşıyıcı İlanı (Adres Modalı)`) — pick pickup/dropoff with reverse-geocoding.

Beyond rendering, the Logistics module (ADR-0010) needs:

- **Geocoding** — address → coordinates.
- **Reverse geocoding** — coordinates → address.
- **Routing** — driving directions between two or more points, distance, estimated duration, optional alternatives.
- **Tile rendering** — basemap for the operator UI.

We have three viable providers (MapLibre GL + open tiles, Mapbox, AWS Location Service) and a single hard constraint: the POC must be free, but we must be able to swap to a paid provider with minimal code change. Routing quality is the most cost-sensitive piece (open routing engines are weaker than Mapbox/AWS for Turkey-specific data).

## Decision

We split mapping into **two interfaces**, each with **three adapters**, behind a single env-var-driven factory in `packages/maps`:

```
packages/maps/
├── tiles/
│   ├── interface.ts                    ← MapProvider
│   ├── maplibre.adapter.ts             ← OSS, free, default in POC
│   ├── mapbox.adapter.ts               ← polish
│   └── aws-location.adapter.ts         ← integrated AWS billing
├── routing/
│   ├── interface.ts                    ← RouteProvider, GeocodeProvider
│   ├── osrm.adapter.ts                 ← free, public OSRM (POC only)
│   ├── mapbox.adapter.ts               ← Directions + Geocoding API
│   └── aws-location.adapter.ts         ← AWS Routes + Places (production default)
├── react/
│   ├── MapPanel.tsx                    ← consumer-facing component
│   ├── RouteLayer.tsx
│   └── Marker.tsx
└── index.ts
```

### 1. Environment-driven selection

Two env vars, independent:

```
MAP_TILE_PROVIDER=maplibre|mapbox|aws        # default: maplibre
MAP_ROUTING_PROVIDER=osrm|mapbox|aws         # default: osrm (POC), aws (production)
```

The factory reads them at module load and instantiates the right adapter. UI components import from `@relowa/maps/react` and stay provider-agnostic.

### 2. Adapter contracts

Every tile adapter implements:

```ts
interface MapProvider {
  styleUrl(theme: 'light' | 'dark'): string;
  attribution: string;          // mandatory; required by OSM/MapTiler/Mapbox license terms
  maxZoom: number;
  init(container: HTMLElement, opts: MapInitOptions): MapInstance;
}
```

Every routing/geocoding adapter implements:

```ts
interface RouteProvider {
  route(req: { from: LngLat; to: LngLat; waypoints?: LngLat[]; mode: 'driving-truck' | 'driving' }): Promise<RouteResult>;
}

interface GeocodeProvider {
  search(q: string, opts: { country: 'TR'; limit?: number }): Promise<GeocodeResult[]>;
  reverse(p: LngLat): Promise<GeocodeResult>;
}

type RouteResult = {
  distanceMeters: number;
  durationSeconds: number;
  geometry: GeoJSON.LineString;
  legs: Leg[];
  alternatives?: RouteResult[];
};
```

These are minimal — they cover the entire surface used by the Figma screens. We add capabilities (traffic-aware ETAs, isochrones) only when a feature requires them.

### 3. Cost model

Ballpark for the Phase 1 pilot scale (50–100 producers, ~1k shipments/month, ~30k map loads/month):

| Provider | Tiles | Routing | Geocoding | Monthly estimate |
|---|---|---|---|---|
| **MapLibre + OSM/MapTiler free + public OSRM** | $0 (with attribution + rate limit) | $0 | $0 | **$0** |
| **Mapbox** | 50k loads free, then $5/1k | $0.50/1k requests | $0.75/1k requests | ~$50–150 |
| **AWS Location Service** | 10k free, then $0.50/1k | $0.50/1k | $0.50/1k | ~$30–80 |

Routing quality in Turkey: AWS (HERE-backed) > Mapbox > OSRM public. The OSS routing engine is acceptable for the POC where exact ETAs aren't customer-facing; production deserves better.

### 4. Recommended deployment

| Environment | Tiles | Routing & Geocoding |
|---|---|---|
| Local dev / POC | `maplibre` (MapTiler free tier or OSM tiles via CDN) | `osrm` (public demo server) |
| Phase 1 production | `aws-location` (HERE-backed maps) | `aws-location` (Routes + Places) |
| Demo / marketing | `mapbox` if visual polish matters | `mapbox` |

The same component code runs in all three configurations — only env vars change.

### 5. KVKK / data residency

AWS Location Service is available in `eu-central-1` (Frankfurt) and is the only provider that keeps geocoding queries inside our AWS account boundary by default. Mapbox routes queries through their US infra unless on the EU plan. MapLibre + OSM has no central server — the tiles are CDN-served and queries don't leave the browser. For production, **AWS Location is preferred for KVKK alignment**; this isn't strictly required by KVKK but reduces SCC paperwork.

### 6. Component contract

```tsx
import { MapPanel, RouteLayer, Marker } from '@relowa/maps/react';

<MapPanel
  center={[29.06, 41.02]}
  zoom={11}
  theme="light"          // 'light' | 'dark'
  className="h-96 rounded-lg"
>
  <Marker position={pickup} label="Pickup" />
  <Marker position={dropoff} label="Dropoff" />
  <RouteLayer from={pickup} to={dropoff} mode="driving-truck" />
</MapPanel>
```

Consumers never import `maplibre-gl` or `@mapbox/*` directly. If a provider-specific feature is needed, the adapter exposes it through a typed extension surface — but `RouteLayer` and `Marker` cover everything the Figma flows need.

## Consequences

### Positive

- POC ships with $0 mapping cost.
- Provider swap is an env var, not a refactor.
- KVKK story for production is straightforward (AWS Location in `eu-central-1`).
- Cost is observable per provider via CloudWatch + Mapbox dashboard, not buried in a monolithic vendor bill.
- Routing engine separable from tile engine — we can use AWS Routes with MapLibre tiles if AWS tile aesthetics underwhelm us.

### Negative

- Three adapters to maintain. Mitigated by the narrow interface (3 methods × 2 interfaces).
- OSRM public demo server has no SLA and rate-limits aggressively — POC routing is "good enough for screenshots," not production load.
- Adapter abstraction adds a thin runtime layer; negligible perf cost.

## Future plans

- **Truck-routing constraints** (Phase 2) — weight/height limits, hazardous material restrictions. AWS Location supports this via the `Truck` travel mode; expose through `mode` enum.
- **Real-time vehicle tracking** (Phase 2) — carrier driver app pushes positions; map subscribes via AppSync. The `<Marker>` API stays the same; the data source becomes a subscription instead of a one-shot.
- **Isochrone / coverage maps** (Phase 3) — recyclers want to see "what tenders are within X minutes." AWS Location and Mapbox both support; add `IsochroneProvider` interface.
- **Self-hosted OSRM / Valhalla** (Phase 3 if cost matters at scale) — route 90% of queries through a self-hosted instance, fall back to AWS for edge cases. Only worth it if shipment volume crosses ~50k routes/month.
- **Open Mapbox alternative** — if Mapbox pricing changes adversely, swap the adapter, no UI changes.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Single provider only (Mapbox or AWS) | No POC budget for paid mapping during validation; also locks us into a provider before we know what features we'll need. |
| Google Maps | Pricing is the most expensive of all options; KVKK / EU data residency story is worst. |
| HERE direct | AWS Location already wraps HERE with simpler billing through our AWS account. No reason to take HERE directly. |
| Leaflet | Older API; MapLibre is the modern OSS choice and is a near-drop-in for Mapbox GL. |

## Reference

- ADR-0010 — Carrier sub-auction (the consumer of routing/distance/ETA)
- ADR-0011 — UI kit & design tokens (`MapPanel` uses `--surface` and `--brand-*` tokens)
- ADR-0012 — Frontend app architecture (where `packages/maps` is consumed)
- MapLibre GL: https://maplibre.org
- AWS Location Service: https://aws.amazon.com/location/
- Mapbox pricing: https://www.mapbox.com/pricing
