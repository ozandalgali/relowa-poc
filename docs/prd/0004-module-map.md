# PRD-0004 — Module Map

> The canonical taxonomy. Nine icon-poster buckets, organized as five architectural layers, mapping to frontend modules → backend services → DB tables → Figma screens → ADRs.
> One source of truth for module scope across the whole project.

**Status:** Accepted
**Date:** 2026-05-13 (amended 2026-05-16)
**Decision-makers:** Ozan (lead)

> **Amended 2026-05-16:** After reviewing the CEO competitive matrix (Evreka / Rubicon / Greyparrot / Sensoneo / RELOWA), the 9 icon buckets are reorganized into **5 architectural layers** that mirror the strategic-pillar fusion (Rubicon-style operations × Sensoneo-style IoT × Greyparrot-style AI). IoT & Field and AI & Recognition are **promoted from "deferred"** to "Phase 2 first-class with substrate seats reserved in Phase 1." This means: schema, adapter interfaces, and integration points must exist in P1 even though the production deployment of hardware/AI units lands later. See §1a below.

## Why this document exists

Before this PRD, the project had three independent module taxonomies:

1. The **Relowa Master Icon System v2.5** poster (9 visual buckets).
2. The **Figma screen flow** (~60 screens grouped into 8 batches in `docs/figma/README.md`).
3. The **phase milestones** in `docs/prd/0003-phase1-milestones.md` (M0–M5, organized by tech layer).

These didn't reconcile. A new contributor reading the icon poster would not be able to find "where does the AI photo analysis screen live in the codebase," and a developer reading the milestones would not be able to point at "the Logistics module." This PRD reconciles all three.

The icon system poster is the most user-legible taxonomy, so we adopt its 9 buckets as canonical. Everything else maps into them.

## 1a. The five architectural layers (added 2026-05-16)

The 9 icon-poster buckets reflect a UX surface taxonomy. For engineering and product strategy, they roll up into **5 architectural layers** that map directly to the competitive matrix:

```
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 5 — Compliance & Certification                                 │
│  ESG reports, carbon certificates, Arbitrum anchoring, audit chain    │
│  Icon buckets: ESG & Sustainability                                   │
│  ADRs: 0001, 0008, 0014                                               │
├──────────────────────────────────────────────────────────────────────┤
│  LAYER 4 — Marketplace & Finance                                      │
│  Tenders, bids, orders, escrow, e-fatura, pricing engine, subs       │
│  Icon buckets: Marketplace, Finance & Compliance                      │
│  ADRs: 0007, 0009, 0010, 0024, PRD-0008                              │
├──────────────────────────────────────────────────────────────────────┤
│  LAYER 3 — Operations & Logistics  (Rubicon-style)                    │
│  Carrier ads, routing (VRP), shipments, fleet, driver app             │
│  Icon buckets: Logistics & Operations                                 │
│  ADRs: 0010, 0013, 0027 (route engine)                                │
├──────────────────────────────────────────────────────────────────────┤
│  LAYER 2 — Analytics & Intelligence  (Greyparrot-style)               │
│  AI scan, edge inference, quality scoring, anomaly detection         │
│  Icon buckets: AI & Recognition                                       │
│  ADRs: 0029 (edge AI), PRD-0006 (AI Scan adapter)                     │
├──────────────────────────────────────────────────────────────────────┤
│  LAYER 1 — Field & Data  (Sensoneo-style)                             │
│  IoT sensors, MQTT ingestion, telemetry, device fleet, HaaS billing   │
│  Icon buckets: IoT & Field                                            │
│  ADRs: 0028 (IoT ingestion), ADR-0024 (HaaS subscription)             │
└──────────────────────────────────────────────────────────────────────┘

System & Navigation, Core Utilities, User Roles span ALL layers.
```

**The strategic claim:** Relowa is the only platform unifying all 5 layers. Each layer is a $100M+ company in its own right (Rubicon, Sensoneo, Greyparrot). Our differentiation is the **vertical integration**.

**Phase 1 ships Layers 3, 4, 5.** Layers 1 and 2 ship in Phase 2/3, but **substrate seats are reserved in Phase 1**:

- **Layer 1 (IoT):** schema for `devices`, `device_telemetry`, `telemetry_aggregations`; MQTT broker interface; HaaS subscription tier (ADR-0024). No actual hardware deployed in P1, but the API can already ingest mock telemetry.
- **Layer 2 (Edge AI):** schema for `ai_inference_units`, `inference_results`; `AIScanProvider` interface (PRD-0006); Greyparrot adapter is one implementation, future self-hosted edge AI is another. No actual edge deployment in P1.

This is the difference between **deferred** ("we'll figure it out later") and **substrate-seat-reserved** ("the architecture accepts this without rewrite").

## The nine buckets

| # | Icon-poster bucket | Frontend module | Backend services / tables | Phase | Status |
|---|---|---|---|---|---|
| 1 | **System & Navigation** | `packages/ui` shell (sidebar, topbar, auth pages), `apps/web/(app)/layout.tsx` | — | P1 | 📋 Planned |
| 2 | **Core Utilities** | `packages/ui` primitives (Button, Input, Modal, Dialog, …) | — | P1 | 📋 Planned |
| 3 | **User Roles** (Producer / Recycler / Carrier) — operator tier | role-aware layouts, route guards from JWT claims | Cognito Pre-Token Lambda, `users`, `organizations`, `org_members` (exists) | P1 | ✅ Substrate done |
| 3b | **Staff Roles** (super_admin / account_manager / support_agent / compliance_officer / financial_analyst) — internal tier | `apps/admin` only, SAML SSO + VPN-gated | `internal_staff`, `staff_org_assignments`, `staff_permissions`, `staff_role_permissions`, `admin_audit_log` (ADR-0014) | P1 schema · P2 panel | 📋 Schema P1, panel deferred to M6 |
| 4 | **Marketplace** (Exchange, Auction, Contract, Wallet, Price Trend) | tenders, bids, marketplace feed, live auction, history | `apps/api` tenders/bids (ADR-0009), `apps/lambdas/tender-close-handler`, `tenders`, `bids` | P1 | 📋 Schema done, API/UI net new |
| 5 | **Logistics & Operations** | shipments, route map, carrier ads, operation tracking | new tables: `carrier_ads`, `carrier_bids`, `shipments`, `shipment_events` (ADR-0010) | P1+P2 | 📋 Net new |
| 6 | **AI & Recognition** (Greyparrot module — Layer 2) | photo upload, AI scan UI, purity/composition panel; substrate for future edge inference units | `apps/ai-proxy` Greyparrot adapter, `ai_analyses` table, `ai_inference_units`, `inference_results` (substrate-only in P1, ADR-0029) | P1 cloud (Greyparrot adapter) · P2 edge deployment · P3 self-hosted | 📋 P1 substrate, edge deploy P2 |
| 7 | **IoT & Field** (Sensoneo module — Layer 1) | bin status widgets, sensor telemetry view, fleet manifest | `devices`, `device_telemetry`, `telemetry_aggregations` (substrate-only in P1, ADR-0028); MQTT broker interface; HaaS subscription billing (ADR-0024) | P1 substrate · P2 hardware deploy · P3 fleet scale | 📋 P1 substrate seat |
| 8 | **ESG & Sustainability** | ESG dashboard, certificate viewer, carbon score, anchored proofs | `material_recovery_certificates`, `carbon_calculations`, `esg_report_runs`, `anchor_log` (ADR-0008) | P1 | 📋 Net new |
| 9 | **Finance & Compliance** (cross-cutting; sits under Marketplace icons: Escrow / Contract / Wallet / Invoices) | escrow status, invoices, e-fatura, payouts | `escrow_orders`, `escrow_transactions`, `invoices`, `provider_webhooks` (ADR-0007), Step Functions, Iyzico/Nilvera adapters | P1 | 📋 Net new |

**Legend:** ✅ done · 📋 planned for this phase · 🧊 stubbed (UI exists, no logic)

## Module ownership of Figma screens

Every screen extracted from Figma (`docs/figma/extracted/batch-XX.json`) maps to exactly one module. This table is the bridge from design to code.

| Figma batch | Screens | Owner module(s) |
|---|---|---|
| 01 — Landing & Marketing | Hero, 5-step explainer, technology, efficiency, contact form, footer | (marketing) — separate route group, no module |
| 02 — Auth & Registration | Login, OTP, role select, producer/recycler/carrier signups | System & Navigation + User Roles |
| 03 — Dashboard & Tender Lists | Recycler dashboard, marketplace, active auctions, history, producer dashboard | Marketplace |
| 04 — Tender Creation & Detail | Create wizard (2 steps), success modal, detail page, live auction, bid management | Marketplace + AI & Recognition (the AI scan step) |
| 05a — Operations Tracking | Operasyon takip (refined + list), recycler operations, pending shipments, active logistics detail, history, carrier ad open | Logistics & Operations |
| 05b — Carrier Bidding & Selection | Carrier ad success, address modal, my ads, ad detail with offers, carrier selection confirm, bid detail, bid placement modal | Logistics & Operations |
| 06 — Finance, ESG & Ratings | Escrow, financial, exit modal, ESG report (both views), raw material entry, invoices, evaluation forms | Finance & Compliance + ESG & Sustainability |
| 07 — Settings | Company profile, security, authority management, password, account close, user add, logout | System & Navigation |
| 08 — Help & Misc | Help center, live support, ticket modal, ticket creation, AI assistant, history detail | System & Navigation (Help) |

## Module → ADR / PRD index

Each module has one or more ADRs governing it. This is the "look here for the rules of this module" table.

| Module | Foundational ADRs / PRDs |
|---|---|
| System & Navigation | ADR-0011 (UI kit), ADR-0012 (frontend architecture), PRD-0005 (i18n) |
| Core Utilities | ADR-0011 (UI kit & tokens) |
| User Roles (operator) | ADR-0003 (RLS+JWT), ADR-0005 (Cognito) |
| Staff Roles (internal) | ADR-0014 (RBAC model), ADR-0015 (admin tooling isolation: VPN + SAML + private DNS) |
| Marketplace | ADR-0001 (Postgres SoR), ADR-0009 (Bidding loop), ADR-0006 (Outbox/AppSync for live bid push) |
| Logistics & Operations | ADR-0010 (Carrier sub-auction), ADR-0013 (Map provider) |
| AI & Recognition | (P1: Greyparrot adapter spec — not yet written) |
| IoT & Field | (P2 — no ADR yet; stubbed UI only) |
| ESG & Sustainability | ADR-0008 (Arbitrum anchoring) |
| Finance & Compliance | ADR-0007 (Step Functions escrow) |

## Module → milestone wiring

How the 9 modules land across the 6 milestones in `docs/prd/0003-phase1-milestones.md`:

```
            M0   M1   M2   M3   M4   M5
Sys/Nav     .    .    .    .    .    ████
Core Util   .    .    .    .    .    ████
User Roles  .    ████ .    .    .    ████
Market      .    .    ████ ████ .    ████
Logistics   .    .    .    ████ .    ████
AI Recog    .    .    .    .    ████ ████
IoT Field   .    .    .    .    .    🧊
ESG         .    .    .    ████ ████ ████
Finance     .    .    .    .    ████ ████
```

The M5 row is intentionally heavy — that's the frontend milestone where every module gets its UI implementation. The backend work is distributed M1–M4 by data dependency.

## Cross-cutting concerns (not their own module)

These appear in every module and are governed independently:

- **Audit trail** — every mutation appends to `audit_events` (ADR-0001).
- **Idempotency** — every mutation accepts `Idempotency-Key` (concept doc).
- **RLS isolation** — every table has RLS enabled before it ships (AGENTS.md §2).
- **Hash anchoring** — every audit row participates in daily Merkle root (ADR-0008).
- **Realtime push** — outbox-driven CDC to AppSync, env-var-flagged backend (ADR-0006).
- **i18n** — TR primary, EN fallback, every user-facing string keyed (PRD-0005).

## What is explicitly out of this taxonomy

- **Marketing pages** (Figma batch 01) — not a module. They live under `apps/web/(marketing)/` with no shared layout with the app.
- **Static documentation** — `docs/_site/` is the published site, not application surface.
- **Admin tooling** — lives in a separate Next.js app `apps/admin` (per ADR-0012). It cross-cuts modules but is delivered as its own deployable.

## When a new screen/feature appears

The author asks two questions:

1. **Which of the 9 buckets does this belong to?** If unclear, it probably needs a new bucket — which requires updating this PRD.
2. **What ADR governs the rules of that bucket?** If none exists, write one before writing code.

This is the discipline that keeps the taxonomy from drifting.

## Reference

- Master icon system: `docs/figma/Relowa Master Icon System - Extended.png`
- Figma extraction batches: `docs/figma/extracted/batch-{01..08}-*.json`
- Phase 1 milestones: `docs/prd/0003-phase1-milestones.md`
- AGENTS.md operating principles
