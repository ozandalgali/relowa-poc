# Component Inventory

> The bridge from Figma to code. Every screen in the design maps to one or more components in `packages/ui`. This document is the canonical list, organized by layer.

**Last sync:** 2026-05-13, from Figma extraction batches 01–08 (see `docs/figma/extracted/`).

## How this is organized

Three layers, matching ADR-0011:

- **Layer 0 — Primitives:** shadcn-derived, token-styled, no Relowa concepts. Reusable in any product.
- **Layer 1 — Patterns:** Relowa composites used in 3+ screens.
- **Layer 2 — Shells:** Page-frame components.

A fourth list at the end maps **Figma screens → which components compose them**, so when implementing a screen the dev knows exactly which components to assemble.

---

## Layer 0 — Primitives

Sourced from shadcn/ui, restyled to tokens (ADR-0011 §2). Every primitive has the standard four states: `default`, `hover`, `focus`, `disabled`. Dark variants only where Figma uses them.

| Component | Variants used in Figma | Notes |
|---|---|---|
| `Button` | `primary` (brand-500), `secondary` (brand-900 dark fill), `outline` (border), `ghost` (text only), `danger` (--danger) | All buttons have a `size` prop: `sm` / `md` (default) / `lg`. Icons supported left or right. |
| `IconButton` | Square version of Button for top-bar / table actions | 32px or 40px square. |
| `Input` | `text`, `password`, `email`, `tel`, `number`, `search` | Light gray fill `--surface-2`; brand border on focus. Leading icon supported. |
| `Textarea` | Single variant | Auto-grows to max-height; matches Input styling. |
| `Select` | `single`, `multi-with-tags` (registration role select) | Chevron right; embedded chips for multi. |
| `MultiSelect` | (alias to `Select` variant) | Used in tender create / carrier filters. |
| `Checkbox` | Square (default), `square-dark` (settings save-changes) | Rounded 4px; checked = brand-900 fill + white check. |
| `Radio` | Default; `card-radio` for vehicle-type cards | Card variant has its own pattern, see Layer 1. |
| `Switch` | Single variant | Pill toggle for notification preferences, active = brand-500. |
| `Tabs` | Underline (default), segmented (auth flow) | Underline uses brand-500 indicator. |
| `SegmentedControl` | Two-option, three-option | Pill-shaped gray container with sliding white indicator. |
| `Dialog` | `confirm`, `form`, `success` | Confirm width 400; form 400–560; success 480. Overlay rgba(0,0,0,0.4). |
| `Sheet` | Right-side panel (filter drawer, mobile menu) | Width 320 default. |
| `Tooltip` | Default | Brand-900 background, white text, small. |
| `Popover` | Default | Used by Select, date picker, user menu. |
| `Badge` | `success`, `success-light`, `success-outline`, `warning`, `danger`, `info`, `neutral-light`, `neutral-fill`, `dark-fill`, `ai-label` | Status taxonomy mapping in `status-taxonomy.md`. |
| `Avatar` | Circular (default), `with-name`, `with-role` | Initials fallback when no image. |
| `Card` | `default` (white surface), `dark` (brand-900 fill — AI insight, escrow KPI), `danger-zone` (light red border) | Padding default 24px. |
| `Separator` | Horizontal, vertical | --border color. |
| `Accordion` | Default (FAQ pattern) | Chevron rotates on expand. |
| `Toaster` | `success`, `error`, `info`, `warning` | Sonner-style, top-right placement. |
| `ScrollArea` | Default | For long sidebars, modal bodies. |
| `Progress` | `linear`, `circular` | Used by AI scan animation, file upload, page load. |
| `Skeleton` | Rectangle, circle, line | Loading states for KPIs, tables, maps. |
| `Spinner` | Inline (small), centered (large) | Inside buttons during async actions. |

---

## Layer 1 — Patterns

| Component | Figma references | Description |
|---|---|---|
| `KPIStatCard` | Recycler dashboard (batch-03), producer dashboard (batch-04), shipments KPIs (batch-05a) | Big number + label + optional trend indicator. Light and dark variants (dark uses brand-900 with brand-500 text). |
| `StatusBadge` | Everywhere with status pills | Driven by the canonical taxonomy in `status-taxonomy.md`. Auto-maps state → color + label. |
| `DataTable` | All list views (tenders, marketplace, carrier ads, shipments, invoices, audit) | TanStack-table-based; bottom-bordered rows, uppercase muted headers, row actions menu. Server-side pagination. |
| `StepperHorizontal` | Tender create wizard (batch-04) | Connected circles with labels below. |
| `StepperVertical` | Registration sidebar (batch-02) | Numbered tiles, vertical, brand-500 fill for active/completed. |
| `Timeline` | Shipment tracking (batch-05a) | Horizontal progress line with icon nodes + timestamps; reuses `StatusBadge` for each node. |
| `FileDropzone` | Tender create photos, document upload | Dashed border, hover state, multi-file variant. AI scan animation variant overlays a scanning bar. |
| `EmptyState` | "No tenders yet," "No shipments active" | Centered icon + message + optional CTA. |
| `PageHeader` | Top of every authenticated page | Title + breadcrumbs + right-aligned actions. |
| `RoleSelectCard` | Registration role picker (batch-02) | Card with large icon, tags (gray/green/blue), title, description, checkbox indicator. Selected state has brand-500 border + check. |
| `AIInsightCard` | Tender detail AI panel (batch-04), recycler ops insights (batch-05a) | Dark brand-900 background, neon brand-500 accents, used for AI-generated content. |
| `BidOfferCard` | Carrier ad bids (batch-05b), tender bid history (batch-04) | Horizontal row with avatar, label, rating, ETA, price, accept action. `highlighted_ai_best` variant with brand-500 border. |
| `EscrowStatusCard` | Finance / escrow (batch-06) | Funds amount + status badge + progress to release. |
| `MerkleProofBadge` | ESG certificates (batch-06), audit log | "Anchored on Arbitrum One — block #N" with `View proof` link. Tied to ADR-0008. |
| `MapPanel` | Operations tracking (batch-05a), address selection modal (batch-05b) | Wraps `@relowa/maps/react` MapPanel. Light/dark theme. |
| `RouteLayer` | Inside `MapPanel` for live shipments | Origin → destination polyline + vehicle marker. |
| `Marker` | Map pin | Pickup, dropoff, vehicle, stop. |
| `SearchBar` | Topbar search (batch-08), filters | With keyboard shortcut indicator (Ctrl+K) variant. |
| `FilterChipBar` | Marketplace, tender history filter | Horizontal scrollable chips, multi-select. |
| `DateRangePicker` | Reports, history filtering | Two-month calendar; presets (Last 7d / 30d / 90d). |
| `KVKKConsentNotice` | First login, registration completion | Inline banner with link to aydınlatma metni. |
| `ImpersonationBanner` | Admin shell only (ADR-0014) | High-contrast top banner shown when staff is acting as an org. |
| `Chart.Bar` | ESG report, financial dashboard | Wraps Recharts; respects `--brand-*` and `--success/warning/danger` tokens. |
| `Chart.Donut` | Material composition, shipment status mix | Same. |
| `Chart.Line` | Price trends, throughput | Same. |
| `Chart.Sparkline` | Inside KPIStatCard | Tiny inline trend. |
| `ChatWidget` | Help center live support (batch-08) | Floating bottom-right; sheet-on-mobile. |
| `TicketComposer` | Help center ticket modal (batch-08) | Form modal with attachments. |
| `RatingForm` | Operation evaluation, producer evaluation (batch-06) | 5-star rating per criterion + textarea + file dropzone. |

---

## Layer 2 — Shells

| Shell | Used by | Description |
|---|---|---|
| `LandingShell` | `(marketing)` routes | Marketing topbar, no sidebar, full-width sections. |
| `AuthShell` | `(auth)` routes | Light sidebar with vertical stepper (320px width), form on right. |
| `AppShell` | `(app)` routes — operator | Dark sidebar (brand-950, 260px), topbar, main content. Contains `<RoleAwareSidebar>`. |
| `AdminShell` | `apps/admin` only | Like `AppShell` but with `<ImpersonationBanner>` slot + admin-specific sidebar. Tier-aware menu. |
| `RoleAwareSidebar` | Inside `AppShell` | Renders menu items from JWT claims (`org_type`, `role`). One component, three menu profiles (per ADR-0012 §2). |
| `AdminSidebar` | Inside `AdminShell` | Renders menu items per `staff_role` + permissions. |

---

## Figma screen → component composition

The composition is "shell + page header + 1..N patterns." Listed batch by batch.

### Batch 01 — Landing & Marketing

| Screen | Composition |
|---|---|
| Landing index | `LandingShell` + hero section + `Card.dark` × 3 (technology) + `Card.process-step` × 5 + contact form (`Input` × N + `Textarea` + `Button.primary`) |

### Batch 02 — Auth & Registration

| Screen | Composition |
|---|---|
| Login (`/giris`) | `AuthShell` (no stepper) + `Input` × 2 + `Button.primary` + `Checkbox` (remember me) |
| Role select (`/rol-secimi`) | `AuthShell` + `RoleSelectCard` × 3 (producer, recycler, carrier) |
| Register producer | `AuthShell` + `StepperVertical` + form fields + `Button.primary` |
| Register recycler | Same with additional waste-code multi-select |
| Register carrier | Same with vehicle-type radio cards |
| OTP screen | `AuthShell` + 6-digit code input + `Button.primary` |

### Batch 03 — Dashboard & Tender Lists

| Screen | Composition |
|---|---|
| Recycler dashboard | `AppShell` + `PageHeader` + `KPIStatCard` × 4 + `Chart.Bar` + `DataTable` (recent transactions) |
| Producer dashboard | `AppShell` + `PageHeader` + `KPIStatCard` × 4 + `Chart.Donut` + tender summary list |
| Marketplace (recycler) | `AppShell` + `PageHeader` + `FilterChipBar` + grid of tender cards |
| Active tenders list | `AppShell` + `PageHeader` + `SearchBar` + `FilterChipBar` + `DataTable` |
| History | `AppShell` + `PageHeader` + `DateRangePicker` + `DataTable` + filter side sheet |

### Batch 04 — Tender Creation & Detail

| Screen | Composition |
|---|---|
| Create wizard step 1 (waste info) | `AppShell` + `PageHeader` + `StepperHorizontal` + form fields + tabs for material categories + `Button.primary` |
| Create wizard step 2 (AI analyze) | `AppShell` + `StepperHorizontal` + `FileDropzone` (AI scan variant) + `AIInsightCard` (purity/composition) + `Button.primary` |
| Publish success modal | `Dialog.success` (480px) + check icon + message + `Button.primary` |
| Tender detail page | `AppShell` + `PageHeader` + breadcrumbs + 2-col layout: left (tender info + photos) + right (`BidOfferCard` list + `StatusBadge`) |
| Live auction tracking | `AppShell` + `PageHeader` + countdown timer + live `BidOfferCard` list (AppSync subscription) |
| Bid management | `AppShell` + `DataTable` of bids + bid filter + accept action |

### Batch 05a — Operations Tracking

| Screen | Composition |
|---|---|
| Operations tracking (overview) | `AppShell` + `PageHeader` + `KPIStatCard` × 4 + `MapPanel` (multiple `Marker`s) + `DataTable` (active shipments) |
| Operations list | `AppShell` + `DataTable` + filter sheet |
| Recycler operations | Same with recycler-specific columns |
| Active logistics detail | `AppShell` + 2-col: `Timeline` (shipment events) + `MapPanel` with `RouteLayer` + carrier card + `Button.primary` (confirm delivery) |
| Carrier ad open form | `AppShell` + `PageHeader` + form: pickup `MapPanel`-modal + dropoff + weight + vehicle type radio cards + `Button.primary` |

### Batch 05b — Carrier Bidding & Selection

| Screen | Composition |
|---|---|
| Carrier ad success modal | `Dialog.success` |
| Address selection modal | `Dialog.form` (800px) + left list of saved addresses + `MapPanel` + `Button.primary` |
| My carrier ads | `AppShell` + `DataTable` + each row links to detail |
| Carrier ad detail (recycler view) | `AppShell` + carrier ad summary + `MapPanel` route preview + `BidOfferCard` × N (with `AIInsightCard.highlighted` for ai_best) + `Button.primary` (select carrier) |
| Bid submission modal (carrier) | `Dialog.form` (560px) + price input + ETA picker + capacity + `Button.primary` |
| Carrier selection confirm | `Dialog.confirm` (500px) + warning text + `Button.danger` (cancel) + `Button.primary` (confirm) |
| Carrier bid detail | `AppShell` + bid summary + chat |

### Batch 06 — Finance, ESG & Ratings

| Screen | Composition |
|---|---|
| Finance / escrow overview | `AppShell` + `KPIStatCard.dark` (total in escrow) + `EscrowStatusCard` × N + `Chart.Bar` |
| Financial data (transactions) | `AppShell` + `DateRangePicker` + `DataTable` of transactions + export `Button.outline` |
| Exit modal | `Dialog.confirm` (400px) |
| ESG report (overview) | `AppShell` + `KPIStatCard` × 3 + `Chart.Donut` (material mix) + `Chart.Bar` (monthly recovery) + `MerkleProofBadge` |
| ESG report detail | Same with category breakdown + certificate links |
| Raw material entry | `AppShell` + monthly entry form + `DataTable` |
| Invoices list | `AppShell` + `DataTable` + e-fatura status badge per row |
| Operation evaluation | `AppShell` + `RatingForm` (multiple criteria) + `Button.primary` |
| Producer evaluation | Same |

### Batch 07 — Settings

| Screen | Composition |
|---|---|
| Settings index | `AppShell` + section `Card`s (company profile, security, notifications, authority management, danger zone) |
| Update authority modal | `Dialog.form` (400px) |
| Add new authority modal | `Dialog.form` (400px) |
| Close account modal | `Dialog.confirm` (400px) + `Button.danger` |
| Password update modal | `Dialog.form` (400px) |
| Logout modal | `Dialog.confirm` (400px) |
| User add modal | `Dialog.form` (400px) |
| Delete account modal | `Dialog.confirm` (400px) + danger zone styling |

### Batch 08 — Help & Misc

| Screen | Composition |
|---|---|
| Help center (dashboard layout) | `AppShell` + `SearchBar` (with Ctrl+K) + category `Card` grid + recent tickets `DataTable` |
| Live support active | Same + active `ChatWidget` |
| New ticket modal | `Dialog.form` (520px) + `TicketComposer` |
| Standalone ticket creation page | `AppShell` + `TicketComposer` (full-page variant) |
| AI assistant | `AppShell` + `ChatWidget`-style page + suggested prompts |
| Tender history (with sidebar update) | `AppShell` + `DateRangePicker` + `DataTable` |
| Historical tender detail | `AppShell` + read-only tender summary + audit log |

---

## What is NOT built in P1

Per PRD-0004 module deferrals:

- **IoT bin status widget** — placeholder card, no real data.
- **AI scan composition panel for non-Greyparrot providers** — only Greyparrot adapter.
- **Mobile carrier driver UI** — Phase 2.

These exist as `<Placeholder>` components that render an "Available in Phase 2" tile.

## Sync discipline

- Whenever a Figma update introduces a new pattern, an entry is added here.
- Whenever a component is removed from `packages/ui`, the entry is removed and grep for usage is run.
- This file's last sync date is updated when batches in `docs/figma/extracted/` change.

## Reference

- ADR-0011 — UI kit & design tokens (the layered model)
- ADR-0012 — Frontend app architecture (where shells are used)
- ADR-0013 — Map provider abstraction (`MapPanel` consumers)
- PRD-0004 — Module map
- PRD-0005 — i18n (every Layer-1 component accepts translated strings via props or message keys)
- `docs/frontend/status-taxonomy.md` — canonical status codes used by `StatusBadge`
- `docs/figma/extracted/batch-*.json` — source of truth
