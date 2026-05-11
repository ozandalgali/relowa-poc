# Relowa Design System

> A consistent, trust-forward design system for the Relowa B2B waste management platform. Dark green = trust & infrastructure. Neon green = action & signal. Industrial yet modern.

---

## 1. What is Relowa?

**Relowa** is a B2B "Waste Operating System" for the Turkish market — connecting waste producers, recycling facilities, and carriers through a unified platform of tenders, auctions, logistics tracking, escrow-secured payments, and ESG-verified material recovery.

### Core entities

- **Organizations** — Producers, Recyclers, Carriers. Each has type-specific profiles.
- **Users / Org Members** — Multi-org membership with role-based permissions (Admin, Accounting, Operator).
- **Tenders (İhaleler)** — Auctions posted by producers seeking recycling services. States: `DRAFT → PUBLISHED → CLOSING → WON → FUNDED → IN_TRANSIT → DELIVERED → SETTLED`.
- **Bids (Teklifler)** — Offers from recyclers on tenders. Soft-close anti-sniping.
- **Operations (Operasyonlar)** — Shipment tracking from producer → recycler. Status pipeline with real-time tracking.
- **Carrier Posts (Taşıyıcı İlanları)** — Reverse-auction for logistics: recyclers post routes, carriers bid.
- **Escrow (Güvenli Havuz)** — Step Functions-managed payment holding. Provider-agnostic (Iyzico, PayTR, Manual).
- **ESG Reports** — Carbon savings, material recovery certificates, daily Merkle roots anchored to Arbitrum One.
- **Invoices (Faturalar)** — e-Fatura via Nilvera/Foriba, triggered on escrow settlement.

### Three surfaces

1. **Recycler (Geri Dönüşüm Tesisi)** — Dashboard, pazar yeri, ihale bidding, operations, ESG reports. **Lead surface.**
2. **Producer (Atık Üreticisi)** — Post tenders, review bids, track shipments, rate recyclers.
3. **Carrier (Taşıyıcı)** — Browse carrier posts, submit bids, track deliveries, manage fleet.

### Markets & languages

- **Primary:** Turkey (Turkish).
- **Secondary:** EU expansion (English, German).
- All copy is Turkish-first; UI tokens are language-agnostic.

---

## 2. Sources (provided)

| Source | Access | Notes |
|---|---|---|
| Figma screens | ✅ `docs/figma/screens/relowa-figma-11may26/` — 60 screens | Gemin-extracted design specs in `docs/figma/extracted/` |
| Design spec | ✅ `docs/figma/design-spec.md` | Synthesized tokens, components, routes |
| Brand assets | ✅ In `assets/` | Icon mark (svg/png) + wordmark (svg/png) |
| Codebase | ✅ `apps/web/` (Next.js) | To be scaffolded from this design system |

---

## 3. Index — what's in this folder

```
/
├── README.md                    ← You are here
├── SKILL.md                     ← Agent skill entrypoint
├── index.html                   ← Design system landing page  
├── colors_and_type.css          ← CSS tokens: colors, type, spacing, radii, shadow
├── assets/                      ← Logos (mark + wordmark, svg + png)
├── preview/                     ← Design-system cards
│   ├── colors_brand.html          · Green palette — the trust stack
│   ├── colors_neutrals.html       · Gray scale
│   ├── colors_semantic.html       · Success, warning, danger, info
│   ├── type_display.html          · Headings
│   ├── type_body.html             · Body, labels, captions
│   ├── spacing_scale.html         · 4px base grid
│   ├── radii.html                 · Corner radius tokens
│   ├── shadows.html               · Elevation system
│   ├── brand_logos.html           · Logo lockups
│   ├── components_buttons.html    · Primary, secondary, outline, ghost, danger
│   ├── components_inputs.html     · Text, select, search, textarea
│   ├── components_badges.html     · Status pills — 6 states
│   ├── components_cards.html      · KPI cards, content cards, AI insight cards
│   ├── components_tables.html     · Data tables, headers, pagination
│   ├── components_sidebar.html    · Sidebar navigation
│   └── components_modals.html     · Form, confirm, success modals
├── ui_kits/
│   ├── recycler-web/              ← FULL interactive recycler dashboard
│   │   ├── index.html               · Dashboard (KPI cards, tenders table)
│   │   ├── tenders.html             · Active tenders list
│   │   ├── tender-detail.html       · Live auction + bid cards
│   │   ├── tender-create.html       · Multi-step tender creation
│   │   ├── marketplace.html         · Pazar yeri grid
│   │   ├── operations.html          · Shipment tracking
│   │   ├── finance.html             · Financial dashboard + escrow
│   │   ├── esg.html                 · ESG report
│   │   ├── settings.html            · Settings + user management
│   │   └── styles.css               · Recycler app-scoped layout
│   ├── producer-web/              ← Producer-side mocks
│   ├── carrier-web/               ← Carrier-side mocks
│   └── marketing/                 ← Public landing page
```

**Where to start:**
- Browsing the system → open **index.html** or any `preview/` card.
- Building a mock → grab `colors_and_type.css` + the HTML primitives from any preview file.
- Understanding the brand → **§ 4 Brand voice** below.
- Picking icons → **§ 6 Iconography** (Lucide only, 1.75 stroke, 24px box).
- Mapping to Figma → `docs/figma/design-spec.md`.

---

## 4. Brand voice — Content Fundamentals

**Industrial but human.** Relowa sits between heavy infrastructure (logistics, escrow, compliance) and the human decisions that drive it (auction bidding, partner ratings, ESG transparency).

### Voice principles
- **Direct, never bureaucratic.** "Teklif Ver" not "Teklif Gönderiniz". Action-oriented.
- **Second person singular.** Turkish "sen" in UI (not "siz") — the platform is a tool, not a formal institution.
- **Confident quiet.** State facts. The neon green does the excitement.
- **Respect operator time.** Waste operators are on the floor, not at a desk. Scan-friendly.
- **No jargon.** "İhale" not "Tedarik İhalesi". "Teklif" not "Fiyat Teklifi".
- **No emoji in product UI.** The leaf icon is sufficient for ESG/eco signaling.
- **Numbers in tabular figures.** Money: `₺12.500,00`. Tonnage: `500 t`. Carbon: `124.5 tCO₂e`.

### Casing
- **Sentence case** for buttons, titles, labels. ("Profilini tamamla", not "Profilini Tamamla".)
- **UPPERCASE** for status badges and sidebar section headers. (`AKTİF`, `TAMAMLANDI`, `BEKLEMEDE`, `ANA MENÜ`).

### Status & empty-state copy (pattern library)
| Situation | Voice |
|---|---|
| Empty list | "Henüz ihale yok — [action]" (never "Veri bulunamadı") |
| Zero state with CTA | Short title + one-line explainer + primary button |
| Error (user-facing) | Plain cause + fix. "Bağlantını kontrol et ve tekrar dene." |
| Success toast | Past tense, no exclamation. "Teklifin iletildi." |
| Post-auction | "İhale tamamlandı · ₺142.500 · Esko Geri Dönüşüm kazandı" |
| Loading | Skeleton preferred over spinner. If text: "Yükleniyor…" |

### Examples
| Before (bad) | After (good) |
|---|---|
| "İhale oluşturma işleminiz başarıyla tamamlanmıştır!" | "İhalen yayınlandı." |
| "Henüz hiçbir veri bulunmamaktadır." | "Henüz ihale yok — ilk ihaleni oluştur." |
| "Lütfen bekleyiniz…" | "Yükleniyor…" |

---

## 5. Visual Foundations

### Overall mood
**Industrial trust. Clean operation. Green signal.** Think an AWS console redesigned by a Swiss industrial designer — dark structural chrome, neon green as the sole color accent, generous whitespace, strict hairlines. The dark green sidebar is the "machine" — the neon green is the "action." No gradients in UI chrome.

### Color

**Green is the action, not the decoration.** Use it for:
- Primary CTA buttons
- Active nav states
- Focus rings
- Status indicators (active, confirmed, complete)
- AI/best-value highlights

**The rest of the UI is neutral.** Not gray — slightly green-tinted warm grays that echo the brand dark green without competing with it.

| Token | Value | Where |
|---|---|---|
| `--accent` (neon green) | `#00E676` | Primary buttons, links, active states, sidebar active text |
| `--primary` (dark green) | `#0A2E1C` | Sidebar background, dark cards, AI panels |
| `--background` | `#F4F7F6` | Page background |
| `--surface` | `#FFFFFF` | Cards, content areas |
| `--foreground` | `#111827` | Primary text |
| `--foreground-muted` | `#6B7280` | Secondary text, labels |
| `--border` | `#E5E7EB` | Card borders, dividers |

**Dark green is structural, neon green is signal. Never swap them.**

### Typography
- **Family:** Inter (400–800). Loaded from Google Fonts.
- **Mono:** JetBrains Mono for IDs, codes, financial amounts.
- **Headings** are `font-weight: 600–700`, tight tracking. Dashboard uses 28px/700 page titles.
- **Body** defaults to 14px/400. Turkish text is slightly longer than English — budget +15% width.
- **Line length:** data tables and forms can span full width. Reading blocks (help articles) cap at 720px.
- **Multilingual:** buttons allow single-line with `text-overflow: ellipsis`. Table cells allow 2-line wrap.

### Spacing & layout
- **4px base grid.** Token scale `--space-1` (4px) → `--space-20` (80px).
- **Card padding:** 24px standard. Dense tables drop to 12–16px.
- **Content max:** 1440px for dashboards, 720px for reading.
- **Sidebar width:** 260px fixed.
- **Topbar height:** 64px.

### Corner radii
| Token | Value | Use |
|---|---|---|
| `--radius-xs` | 4px | Tags, inline chips, checkboxes |
| `--radius-sm` | 6px | Small buttons |
| `--radius-md` | 8px | Default controls (inputs, buttons) |
| `--radius-lg` | 12px | Cards, panels, tables |
| `--radius-xl` | 16px | Role selection cards, modals |
| `--radius-2xl` | 24px | Marketing hero cards |
| `--radius-full` | 999px | Pills (status chips, avatars, toggles) |

### Shadows
- **`--shadow-sm`** is the daily driver for cards.
- **`--shadow-md`** for raised panels, AI insight cards.
- **`--shadow-lg`** for modals.
- Focus ring: `0 0 0 4px rgba(0, 230, 118, 0.18)` — neon green halo.

### Backgrounds
- Pages: `--background` (#F4F7F6) — flat, no gradients.
- Cards: white with subtle border. No double-lining (border OR shadow, rarely both).
- Marketing: soft radial green gradient at 2% opacity is acceptable in hero — always behind content.

### Interaction states
- **Hover:** primary buttons darken to `#00C561`. Cards gain border + slight shadow bump. 120ms.
- **Press:** instant. No scale-down.
- **Disabled:** 40% opacity, `cursor: not-allowed`.
- **Selected/active:** `--primary-subtle` background (#E8FBF0) + deep green text.

### Fixed chrome
- **Sidebar** is persistent on desktop, collapsed to icons at ≤768px.
- **Topbar** stays 64px, contains: breadcrumb (left), search (center), notifications + language + avatar (right).
- **Page content** scrolls; chrome doesn't.

---

## 6. Iconography

### Approach
- **Single icon library: Lucide** (same as shadcn/ui ecosystem). 
- **Stroke weight:** 1.75 (default). Never mix weights.
- **Size rhythm:** 16px (inline with text), 20px (button), 24px (nav, card header).
- **Color:** inherits `currentColor`. In sidebar: `--sidebar-text` → `--sidebar-active-text` on active.

### Icons per nav item (from Figma)
| Nav item | Lucide icon |
|---|---|
| Kontrol Paneli | `LayoutDashboard` |
| Pazar Yeri | `Store` |
| İhale Oluştur | `PlusCircle` |
| Canlı İhale Takip | `Activity` |
| Geçmiş İhaleler | `History` |
| Finansal Veriler | `DollarSign` |
| ESG Raporu | `Leaf` |
| Operasyon Takip | `Truck` |
| Taşıyıcı İlanı Aç | `Megaphone` |
| Faturalar | `FileText` |
| Ayarlar | `Settings` |
| Yardım | `HelpCircle` |

### No drawn SVGs
- **Never** hand-roll icons. If missing from Lucide, substitute closest match.

### Logos included
```
assets/relowa-logo.svg          Icon mark only — square, green on dark
assets/relowa-logo.png
assets/relowa-logo-big.svg      Wordmark — "relowa." with icon
assets/relowa-logo-big.png
```
Minimum wordmark height: 24px. Clear space: ≥ the height of the "o".

---

## 7. Recycler-first IA (guiding principle)

From Figma, the recycler sidebar shows:
1. **Kontrol Paneli** (Dashboard)
2. **İhale Oluştur** (Create Tender — actually used by producers in the flow, but shown in recycler sidebar as "Pazar Yeri" variant)
3. **Canlı İhale Takip** (Live Tender Tracking)
4. **Pazar Yeri** (Marketplace)
5. **Geçmiş İhaleler** (Past Tenders)
6. **Finansal Veriler ve Raporlar** (Finance & Reports)
7. **ESG Raporu** (ESG Report)

Plus operational section:
8. **Taşıyıcı İlanı Aç** (Post Carrier Ad)
9. **Operasyon Takip** (Operations Tracking)

And account:
10. **Faturalar** (Invoices)
11. **Ayarlar** (Settings)
12. **Yardım** (Help)

The exact nav varies per role — see design-spec.md § 2.3.

---

## 8. Known caveats

- **Design extracted from Gemini analysis of Figma PNGs** — hex values may shift ±2%. Cross-reference against actual Figma file when Dev Mode access is available.
- **Inter is loaded from Google Fonts** — for production, self-host `.woff2` in `/fonts/` for KVKK compliance (no cross-border data transfer).
- **shadcn/ui mapping is architectural** — actual component implementation will use shadcn's `<Button>`, `<Input>`, `<Table>`, etc. with custom variant overrides matching these tokens.
- **Carrier and producer UIs** have fewer Figma screens — mocked against recycler patterns. Will need Figma expansion before implementation.
