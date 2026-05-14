# ADR-0011 — UI Kit & Design Tokens

**Status:** Accepted
**Date:** 2026-05-13
**Decision-makers:** Ozan (lead)

## Context

The Figma deliverables (8 batches, ~60 screens, captured in `docs/figma/extracted/`) and the Master Icon System v2.5 poster together define Relowa's visual language. Two problems followed naturally from how Figma evolves:

1. **Color drift.** The same brand-accent green appears as `#00E573`, `#00E676`, `#00FF7F`, and `#00FF85` across screens. No single screen is "wrong" — the design simply hasn't been pinned. The same drift exists for sidebar backgrounds, neutrals, and font sizes.
2. **No code-side token contract.** Without one, every component re-decides spacing, color, radius, and shadow, and the inconsistency compounds.

The icon system poster splits the product into 9 visual buckets (PRD-0004), so the UI kit must support all of them — including dark accent surfaces (AI insight cards, escrow totals, sidebar) and the duotone icon tile treatment shown on the poster.

We also have a substrate constraint: we already migrated icons from emojis to **Lucide** (commit `ca788f0`). Lucide remains the icon engine; the poster's duotone treatment is a wrapper, not a replacement set.

## Decision

We adopt a **single design-token contract** in `packages/ui` and build the component library in three layers (primitives, patterns, module shells) on top of that contract. shadcn/ui is the starting point for primitives; everything is restyled through tokens before it ships.

### 1. Single source of truth

```
packages/ui/
├── tokens/
│   ├── colors.ts          ← brand, neutral, semantic, sidebar
│   ├── typography.ts      ← font, sizes, weights, line-heights
│   ├── spacing.ts         ← 4px scale
│   ├── radii.ts           ← 0 / 4 / 6 / 8 / 12 / 16 / 999
│   ├── shadows.ts         ← none / sm / md / lg
│   └── index.ts
├── primitives/            ← Layer 0: shadcn-derived, token-styled, no Relowa concepts
├── patterns/              ← Layer 1: Relowa composites used in 3+ screens
├── shells/                ← Layer 2: AppShell, AuthShell, LandingShell
└── icons/                 ← Lucide wrappers + duotone tile treatment for module icons
```

Tailwind CSS is the styling engine. Tokens are exposed both as TS exports and as CSS variables (in `globals.css`) so non-Tailwind contexts (chart libraries, third-party widgets) can read the same palette.

### 2. Canonical token values

Normalized from the 8 Figma batches. Drift documented at the end of this ADR.

**Brand (green)**

| Token | Value | Use |
|---|---|---|
| `--brand-50` | `#E5FCEF` | success badge background |
| `--brand-100` | `#B2F5D6` | hover wash on dark surfaces |
| `--brand-500` | `#00E676` | **primary accent — the canonical green** |
| `--brand-600` | `#00C065` | hover/pressed state of brand-500 |
| `--brand-900` | `#0A3B27` | dark accent fills (escrow KPI, AI cards) |
| `--brand-950` | `#0A2E1F` | **canonical sidebar background** |

**Neutrals (slate)**

| Token | Value | Use |
|---|---|---|
| `--bg` | `#F4F7F6` | page background |
| `--surface` | `#FFFFFF` | cards, tables, modals |
| `--surface-2` | `#F3F4F6` | inputs, muted cards |
| `--border` | `#E5E7EB` | divider lines, card borders |
| `--text` | `#111827` | primary text |
| `--text-muted` | `#6B7280` | secondary text, table cells |
| `--text-subtle` | `#9CA3AF` | placeholders, captions |

**Semantic**

| Token | Value | Use |
|---|---|---|
| `--success` | `#10B981` | non-brand success states (transit, payments) |
| `--warning` | `#F59E0B` | escrow pending, delay warnings |
| `--danger` | `#EF4444` | overdue, errors |
| `--info` | `#3B82F6` | informational badges, transit |

**Typography**

Font: Inter (system fallback). Sizes use a 4-step scale tied to Tailwind classes:

| Token | Size | Weight |
|---|---|---|
| `h1` | 24px (28px on dashboard, 32–36px on landing) | 700 |
| `h2` | 20px | 600 |
| `h3` | 16–18px | 600 |
| `body-lg` | 16px | 400/500 |
| `body` | 14px | 400 |
| `body-sm` | 12px | 400 |
| `caption` | 10–11px | 500/600 |
| `label` | 12px (uppercase, tracked) | 600 |
| `button` | 14px | 600 |

**Spacing** — 4px base scale (Tailwind defaults). Standard paddings: 16 (compact), 24 (default), 32 (spacious), 40 (landing sections).

**Radii** — `0` (landing, sharp), `4` (checkboxes), `6` (small buttons, inputs in finance), `8` (default buttons, inputs), `12` (cards), `16` (large cards, role-select), `999` (pills, avatars).

**Shadows** — `none`, `sm` (cards), `md` (AI insight cards), `lg` (modals).

**Sidebar widths** — `260` (default app), `280` (recycler operations), `320` (auth flow). Default to 260 in `AppShell`.

### 3. Component layers

**Layer 0 — Primitives** (shadcn-derived, restyled to tokens, no Relowa-specific props):

```
Button, Input, Textarea, Select, MultiSelect, Checkbox, Radio,
Switch, Tabs, SegmentedControl, Dialog, Sheet, Tooltip, Popover,
Badge, Avatar, Card, Separator, Accordion, Toaster, ScrollArea
```

**Layer 1 — Patterns** (composites that appear in 3+ Figma screens):

```
KPIStatCard           (light + dark-green variants)
StatusBadge           (driven by status-taxonomy.md)
DataTable             (tanstack-table; bottom-bordered rows, uppercase muted headers, row actions)
Stepper               (horizontal — tender create; vertical — registration; timeline — shipment)
FileDropzone          (single + multi; AI scan-animation variant)
EmptyState
PageHeader            (title + breadcrumbs + actions)
RoleSelectCard        (registration role picker)
AIInsightCard         (dark-green background, neon accents)
BidOfferCard          (carrier bid offer with AI tags)
EscrowStatusCard
MerkleProofBadge      (anchored / pending — ties to ADR-0008)
MapPanel              (provider-abstracted — see ADR-0013)
```

**Layer 2 — Shells** (page-frame components):

```
AppShell              (sidebar + topbar + main; one component, claims-driven sidebar)
AuthShell             (light sidebar stepper + form on the right)
LandingShell          (marketing topbar, no sidebar)
```

The sidebar is **one `RoleAwareSidebar` component** that renders menu items from JWT claims (`org_type`, `role`). Confirmed in Q3 of the planning conversation.

### 4. Icon strategy

Lucide is the base set. We add a thin `<Icon name="..." tone="duotone" />` wrapper that applies the poster's duotone tile treatment (filled background tile + outline glyph) for the 9 module-bucket icons. Naming follows the icon poster verbatim so designers and developers share vocabulary:

```
SmartBin, IoTSensor, BatteryStatus, SignalStrength, LocationPin,
AIScan, Plastic, Paper, Metal, AccuracyRate,
ExchangeTrade, AuctionHammer, WasteWallet, ContractDeal, PriceTrend,
SmartTruck, RouteOptimization, ScheduleCalendar, LogisticsTracking,
CarbonCredit, ESGReport, GreenCertificate, CarbonFootprint,
Producer, Carrier, Recycler, AdminAuditor,
LoginRegister, Notifications, Settings, SupportHelp, Search,
AddPlus, RemoveMinus, CloseX, CheckSuccess, ErrorWarning, InfoDetails,
DownloadExport, UploadImport, Filter, Sort, MoreMenu, LinkExternal
```

### 5. Theme variants

The current Figma reveals **light-mode-only** designs with selected dark surface accents (sidebar, AI cards, KPI highlights). We do not ship dark mode in P1. Token names are theme-neutral so adding dark mode is a swap-in, not a refactor.

### 6. Color drift policy

When Figma updates show new color values, **the token wins** unless the change is intentional (in which case update the token, not the component). Drift documented:

| Figma value | Where seen | Token mapping | Note |
|---|---|---|---|
| `#00E573` | Batch 04 (tender detail) | → `--brand-500` | Pre-normalization variant |
| `#00E676` | Batches 02, 05a, 06, 08 | → `--brand-500` | **canonical** |
| `#00FF7F` | Batches 01, 03, 06 | → `--brand-500` | Pre-normalization (landing used a brighter green) |
| `#00FF85` | Batch 05b | → `--brand-500` | Pre-normalization |
| `#022117` | Batch 05a sidebar | → `--brand-950` | Slightly darker than canonical sidebar |
| `#0A2518` | Batch 05b sidebar | → `--brand-950` | — |
| `#083424` | Batch 08 sidebar | → `--brand-950` | — |
| `#0A2E1F` | Batch 03 sidebar | → `--brand-950` | **canonical** |

## Consequences

### Positive

- One token contract instead of 60-screen color soup.
- Tailwind + CSS-variables means tokens are usable from anywhere (charts, third-party widgets, marketing pages).
- Layered components keep "Relowa stuff" out of primitives — primitives are swappable.
- Single sidebar component reduces drift between role-specific views (Q3 decision).
- Icon naming matches the poster, so designer↔developer communication is friction-free.

### Negative

- Initial token normalization will produce a Figma sync task — the source-of-truth files in Figma should be updated to match the token table, but this is design-team work, not engineering.
- `packages/ui` becomes a chokepoint for visual changes — a feature can't ship a new visual style without touching the kit. This is the intended discipline, but it adds friction.
- shadcn upgrades require manual reconciliation because we restyle primitives — we accept this cost in exchange for the look-and-feel we need.

## Future plans

- **Dark mode** — token names are theme-neutral; add a `data-theme="dark"` toggle when the product needs it (likely Phase 2 if carrier driver app lands).
- **Token export to Figma** — once tokens stabilize, generate a Figma Variables JSON from `packages/ui/tokens/` so the design file imports the same palette by name. Closes the drift loop.
- **Per-tenant theming** — `--brand-500` becomes a CSS variable settable by the app shell. Useful if enterprise tenants want light cobranding (rare in our segment, not a P1 need).
- **Motion tokens** — add `--motion-*` (durations, easings) once we have a real animation pattern beyond hover. Not P1.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Custom UI primitives from scratch | Solo-lead time cost; shadcn already accessible, keyboard-navigable, and tested. AGENTS.md §6 ("boring technology preferred") explicitly rules this out without an ADR. |
| Material UI / Mantine | Heavyweight, opinionated visual language. Reskinning either to match Figma is harder than restyling shadcn. |
| Multiple UI packages (`ui-tokens` + `ui-primitives` + `ui-patterns`) | Solo-lead overhead; one package with subpath exports (`@relowa/ui/tokens`) gives the same separation without the workspace ceremony (Q8 decision). |
| Per-app `_components` with no shared package | Inevitable drift between `apps/web` and `apps/admin`. Rejected. |

## Reference

- PRD-0004 — Module Map (the 9 buckets icons map to)
- ADR-0012 — Frontend app architecture (where the UI kit is consumed)
- `docs/figma/extracted/batch-{01..08}-*.json` — design tokens extracted per batch
- `docs/figma/Relowa Master Icon System - Extended.png` — icon poster
- `docs/frontend/component-inventory.md` (planned) — screen ↔ component bridge
