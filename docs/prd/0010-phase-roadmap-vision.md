# PRD-0010 — Phase 2/3/4 Vision & Roadmap

**Status:** Accepted (forward-looking)
**Date:** 2026-05-16
**Decision-makers:** Ozan (lead)

## Why this document exists

PRD-0003 covers Phase 1 milestones (M0–M6) in execution-ready detail. PRD-0001 establishes the long-term vision but lacks operational specifics for what comes after Phase 1 ships.

This PRD bridges the gap. It captures the CEO's 4-phase product roadmap (B2B Exchange → Smart Containers → Smart Analysis → Data Integration + Carbon Credits + Partnerships) as actionable phases with feature breakdowns, schema commits, ADR backing, and revenue impact.

It also names the **strategic differentiation**: Relowa is the only platform unifying the three vertical pillars (Rubicon operations + Sensoneo IoT + Greyparrot AI). This is the Phase 1 thesis; Phases 2–4 deliver it.

## Strategic Vision

```
                        RELOWA WOS — Hybrid Waste Operating System

         Year 1                  Year 2-3              Year 3-4              Year 4+
        ──────────              ──────────             ──────────            ──────────
        Phase 1                  Phase 2                Phase 3               Phase 4
        Marketplace              Smart Field            Smart Analysis        Data + Carbon
                                                                              + Partnerships

Pillar fusion progress:
  Marketplace (Rubicon-style)    ████████████████████████████████████████████   100% by P1
  IoT (Sensoneo-style)           ▓▓▓▓████▓▓▓▓████████████████████████████████   substrate P1 → live P2
  AI (Greyparrot-style)          ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓████████████████████████████   substrate P1 → live P2-P3
  Compliance + Carbon            ████████████████▓▓▓▓████████████████████████   anchoring P1 → tradeable P4
  Data partnerships              ░░░░░░░░░░░░░░░░░░░░░░░░░░░░████████████████   P4
```

## Phase 1 — Marketplace & Operations (Months 1-4, M0-M5)

**Status:** Planning complete (this document set). Code begins M0.

### What ships

1. Producer / Recycler / Carrier marketplace.
2. Tender → bid → order → escrow → settlement → ESG certificate.
3. Carrier sub-auction for transport.
4. Multi-facility org support (ADR-0025).
5. Orders separate from tenders (ADR-0026).
6. Subscription tiers — Free, Pro, Enterprise (ADR-0024).
7. Pricing engine with tiered + split + per-tenant overrides (PRD-0008).
8. Daily Merkle root anchoring on Arbitrum One (ADR-0008).
9. Hash-chained audit trail (concept + ADR-0001).
10. Manual provider implementations for escrow, e-fatura, AI scan (PRD-0006).
11. Substrate seats reserved for routing (ADR-0027), IoT (ADR-0028), edge AI (ADR-0029).
12. Operator web app + admin panel (apps/web + apps/admin).
13. KVKK / CSRD / ESPR / WSR compliance scaffolding.

### Revenue model (Phase 1)

- **SaaS subscriptions** — Free (acquisition) + Pro (₺1 999 – ₺3 499 / mo per segment) + Enterprise (custom).
- **Marketplace commission** — 2-7% per transaction, scaled by subscription tier.

### Target pilot scale

50 – 100 producers, 10 – 20 recyclers, 20 – 50 carriers. Single region (Marmara). 4-month launch.

## Phase 2 — Smart Field / IoT Live (Months 5-12)

**Goal:** First physical Sensoneo-style hardware deployment. HaaS revenue line goes live.

### What ships

1. **Live IoT ingestion** — first Sensoneo (or branded equivalent) sensors deployed at pilot customers' container locations. ADR-0028 schema goes live.
2. **HaaS billing line items** — automated monthly billing per deployed device (ADR-0024 §13).
3. **Real VRP engine** — Google OR-Tools deployed (ADR-0027 future plan).
4. **Driver mobile app** (React Native, separate from PWA carrier UI in Phase 1) — route navigation, QR delivery scan, photo capture for delivery proof.
5. **Multi-stop optimization** for carriers with multiple orders.
6. **Dynamic re-routing** when conditions change.
7. **Carbon footprint tracking** per shipment (from VRP distance + vehicle co2_g_per_km).
8. **Gas + heat sensors** at recycler warehouses for safety alerts.
9. **Web Push for real-time alarms** (already specced in ADR-0018; lights up with live IoT).
10. **Iyzico production integration** (ADR-0027 — escrow real provider).
11. **Nilvera production integration** (ADR-0028 — e-fatura real provider).
12. **Greyparrot cloud API** integration for tender photo analysis (PRD-0006 real adapter).
13. **Visual regression testing in CI** (P2 graduation per ADR-0017).
14. **Performance / load testing** (P2 graduation per ADR-0017).
15. **Session replay** (PostHog, with explicit consent) for UX debugging.

### Revenue model addition (Phase 2)

- **HaaS** — 1500 ₺/mo per smart sensor deployed.
- **Higher conversion to Pro tier** — IoT capabilities create stickiness; Free → Pro conversion target 25%+ (vs 15% Phase 1).

### Target scale

200 – 500 producers, 50 – 100 recyclers, 100 – 200 carriers, 1000+ smart sensors deployed. Expand to second region (Aegean coast).

### New ADRs anticipated

- ADR-0030: Driver mobile app architecture (React Native, offline-first, GPS background)
- ADR-0031: PayTR fallback escrow adapter (if Iyzico approval issues)
- ADR-0032: Real-time WebSocket alarms (vs polling-only AppSync)
- ADR-0033: Carbon calculation engine
- ADR-0034: PostHog session replay with KVKK consent

## Phase 3 — Smart Analysis / Edge AI Live (Year 2-3)

**Goal:** First on-premise Greyparrot-equivalent inference units at recycler MRFs. Quality scoring drives marketplace economics.

### What ships

1. **Edge AI inference units** deployed at first Enterprise-tier recycling facility.
2. **In-facility purity scoring** via conveyor-belt cameras.
3. **Quality-driven pricing** — purity score directly affects fee_schedule_tiers via `material_quality_multiplier` (an addition to PRD-0008 schema).
4. **Edge AI HaaS billing** at Enterprise scale (₺25 000 / mo per line).
5. **3D depth / LiDAR depot intake** verification (volume confirmation at gate).
6. **Anomaly detection ML models** on IoT telemetry.
7. **Custom-trained material classification models** (per-facility or per-segment).
8. **Smart inventory with RFID** for container tracking (₺500 / tag per CEO matrix).
9. **Predictive maintenance** for IoT fleet.
10. **TimescaleDB migration** (if device count > 50k).
11. **Multi-region active-active** preparation (if Phase 3 expansion goes EU).
12. **EU expansion enablers** — i18n: German / French; EUR currency support; SEPA payment integration.
13. **First international pilot** (Czech Republic via Sensoneo network, or Germany direct).

### Revenue model addition (Phase 3)

- **Edge AI HaaS** — ₺25 000 / mo per Greyparrot-style line.
- **Higher Enterprise tier adoption** — AI scanning creates 5-10x ROI for recyclers; conversion accelerates.
- **International tier** — EUR-denominated subscriptions.

### Target scale

1000+ producers, 200+ recyclers (5+ Enterprise tier), 500+ carriers, 5000+ IoT devices, 10+ edge AI units. Operating in TR + 1 EU country.

### New ADRs anticipated

- ADR-0035: GreyparrotEdgeAdapter (real hardware integration)
- ADR-0036: Quality-driven pricing engine extension
- ADR-0037: TimescaleDB migration
- ADR-0038: Multi-region active-active (if pursued)
- ADR-0039: Multi-currency (EUR)
- ADR-0040: Federated model training (cross-customer ML without data sharing)

## Phase 4 — Data Platform + Carbon + Partnerships (Year 3-4+)

**Goal:** Relowa becomes a data platform, not just a transaction platform. Carbon credits are tradeable. Enterprise customers embed Relowa APIs in their own ERP.

### What ships

1. **Tradeable carbon credits** — material recovery + transport savings calculated as tCO2e; minted as on-chain certificates; sellable on secondary markets.
2. **Carbon credit marketplace** — separate from waste marketplace; buyers are corporations needing offsets for their own ESG.
3. **Corporate partnership API** — Fortune-1000 / BIST-30 clients integrate Relowa data into their own ERP (SAP, Oracle, IFS).
4. **ERP integration adapters** — SAP module, Oracle Fusion, IFS connector.
5. **Smart City module** — municipality integration (per Rubicon SmartCity pattern); waste-collection-route-as-data for road monitoring, pothole detection.
6. **Data licensing** — anonymized aggregate market data sold to industry analysts (waste price indices, recovery rates by region).
7. **Recycling supply chain transparency** — full provenance of a recovered material from producer → carrier → recycler → end-product, blockchain-anchored.
8. **AI-driven matching engine** — predictive supply/demand; suggested deals before tenders are even posted.
9. **Embedded fintech** — invoice factoring, working capital loans, with risk scoring driven by platform transaction history.
10. **Multi-modal logistics** — sea + rail + road combinations.
11. **Autonomous vehicle compatibility** — protocol for autonomous trucks at recycler depots.
12. **Drone-based inventory inspection** for outdoor depot scenarios.
13. **Open data standards** — Relowa publishes data formats (waste classification, ESG metrics) for industry-wide adoption.

### Revenue model addition (Phase 4)

- **Carbon credit transaction fee** — 5-10% of carbon credit secondary-market price.
- **Corporate API tier** — per-API-call or flat enterprise contract (₺50 000+ / mo).
- **Data licensing** — per-report or subscription (industry analysts, government bodies).
- **Embedded fintech revenue share** — % of working capital interest (partnership with banks).
- **Smart City contracts** — municipality fees (per Rubicon SmartCity model).

### Target scale

10 000+ producers, 1000+ recyclers, 5000+ carriers. Operating in 5+ countries. 10+ smart city contracts. 50+ enterprise API customers. Carbon credit volume in 100 000+ tCO2e / year.

### New ADRs anticipated

- ADR-0041: Carbon credit minting + secondary market
- ADR-0042: ERP integration adapters
- ADR-0043: Smart City module (municipality API)
- ADR-0044: Data licensing platform
- ADR-0045: Embedded fintech (working capital, invoice factoring)
- ADR-0046: Multi-modal logistics
- ADR-0047: Open data standards (industry-spec contributions)

## Cross-cutting investments (apply across all phases)

| Investment | Phase | Notes |
|---|---|---|
| AWS native + EU residency | All | Established Phase 1 |
| KVKK / CSRD / ESPR / WSR compliance | All | Established Phase 1 |
| Agent team for AI-assisted development | All | Established Phase 1 |
| Adapter pattern for all providers | All | Established Phase 1; new providers slot in |
| Audit hash chain + Merkle anchoring | All | Established Phase 1; carbon credits depend on this in P4 |
| 16-agent specialist team | All | Established Phase 1; new specialists added (e.g. `iot-engineer`, `ml-engineer`) in P2+ |

## What stays consistent

The Phase 1 substrate decisions must hold across Phases 2-4:

- Postgres as system of record (ADR-0001) — never bifurcate.
- RLS as security boundary (ADR-0003) — never bypass.
- Audit hash chain (concept + ADR-0001) — append-only forever.
- Idempotency on every mutation — escrow / billing / IoT inputs / AI inputs all require it.
- Provider-agnostic adapters — every new external integration goes through an interface.
- Substrate-first for new modules — schema commits before implementation lands.
- KVKK / EU residency — non-negotiable as expansion grows.

## What the Phase 1 substrate must support without rewrite

The reason ADRs 0024-0029 commit schema in Phase 1 even though implementation lands later:

- **`subscription_tiers` + `org_subscriptions`** (ADR-0024) — when first paid customer signs Pro, tier is queryable, fee resolution works.
- **`facilities`** (ADR-0025) — when first Enterprise customer with 5 plants signs, no migration.
- **`orders`** (ADR-0026) — when first multi-winner tender happens, no migration.
- **`vehicles` / `drivers` / `route_optimizations`** (ADR-0027) — when Phase 2 ships VRP, schema waits.
- **`devices` / `device_telemetry`** (ADR-0028) — when first sensor deploys, ingestion path exists.
- **`ai_inference_units` / `inference_jobs`** (ADR-0029) — when first edge unit installs, control plane exists.
- **Pricing engine with overrides** (PRD-0008) — when first negotiated Enterprise contract lands, the data model accepts custom rates without code change.

This is the **substrate-now-implementation-later** discipline. It's the difference between "we'll figure it out later" (technical debt) and "the architecture accepts this without rewrite" (foresight).

## Risk register (cross-phase)

| Risk | Phase | Mitigation |
|---|---|---|
| Iyzico approval slips | 1, 2 | ManualProvider fully functional; PayTR fallback ADR drafted |
| Greyparrot pricing prohibits Enterprise deals | 3 | Relowa-branded self-hosted units (P3 future plan in ADR-0029) |
| Sensoneo hardware availability | 2 | Multiple LPWAN-compatible vendors; adapter pattern |
| EU expansion regulatory friction | 3 | Phase 3 begins with Czech (Sensoneo-friendly) or DE (single-country pilot) |
| Carbon credit market regulation changes | 4 | Anchor in EU ETS standards which are stable |
| Smart City municipal sales cycle | 4 | Long; start sales conversations early Phase 3 |
| Competitor (Evreka, Rubicon EU) responds | 1, 2 | Differentiation is the 5-layer fusion; impossible to match without years of investment |
| Solo lead bandwidth | All | Documented in PRD-0007; hire trigger at 10 paying customers |
| KVKK / CSRD regulation tightens | All | Architecture is compliance-ready; pivots are documentation-only |

## Validation milestones

| Milestone | Target | Phase |
|---|---|---|
| First paid Pro subscription | Within 3 months of M5 launch | P1 |
| First Enterprise contract signed | Within 6 months of M5 launch | P1-P2 |
| 10 paying customers across all tiers | Within 9 months of M5 launch | P2 trigger |
| First HaaS device deployed in production | Phase 2 month 3 | P2 |
| ₺1M ARR | End of Phase 2 | P2 |
| First Edge AI unit production | Phase 3 month 6 | P3 |
| First EU country live | Phase 3 month 12 | P3 |
| ₺10M ARR | End of Phase 3 | P3 |
| First carbon credit sold | Phase 4 month 6 | P4 |
| First Smart City contract | Phase 4 month 12 | P4 |
| ₺100M ARR | End of Phase 4 | P4 |

## Reference

- PRD-0001 — Vision (long-term)
- PRD-0002 — Phase 1 scope (this PRD's predecessor)
- PRD-0003 — Phase 1 milestones (execution detail)
- PRD-0008 — Pricing engine (revenue mechanics across phases)
- PRD-0009 — Onboarding (subscription tier conversion funnel)
- ADR-0024 — Subscription tiers
- ADR-0025-0029 — Substrate seats for future phases
- CEO's roadmap slides (image set in handoff context)
- CEO's competitive matrix slide
- CEO's pricing matrix slide
