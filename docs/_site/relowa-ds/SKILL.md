---
name: relowa-design
description: Use this skill to generate well-branded interfaces and assets for Relowa — a B2B waste management platform for the Turkish market — either for production or throwaway prototypes / mocks. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping the recycler, producer, and carrier surfaces.
user-invocable: true
---

Read the `README.md` file within this skill for full brand context (voice, color, typography, iconography, content fundamentals), then explore the other available files:

- `colors_and_type.css` — drop-in CSS variables + semantic type scale (shadcn-compatible)
- `assets/` — logos (mark + wordmark, svg + png variants)
- `preview/` — design-system cards for colors, type, spacing, components
- `ui_kits/recycler-web/` — full recycler-side web app (dashboard, tenders, operations, finance, ESG, settings)
- `ui_kits/marketing/` — public landing page
- `ui_kits/producer-web/` — producer-side mocks
- `ui_kits/carrier-web/` — carrier-side mocks

If creating visual artifacts (slides, mocks, throwaway prototypes), copy assets out of `assets/`, link `colors_and_type.css`, and use the HTML primitives from `preview/` as building blocks. If working on production code, copy assets and read the design rules in `README.md` to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design — start with: which surface (recycler vs producer vs carrier), which page, fidelity (HTML mock vs production React), and locale (TR / EN). Then act as an expert designer and output either HTML artifacts or production code, depending on the need.

**Non-negotiables (these are easy to forget):**
- Green is the action, not the decoration. UI is neutral-first. Neon green (`#00E676`) lives on CTAs, active states, focus rings, and status indicators only.
- Dark green (`#0A2E1C`) is structural: sidebar, dark cards, AI panels. Never used as a page background or button fill (buttons use neon green or white outline).
- No gradients in product UI chrome. Marketing hero backdrops may use 2% opacity green radial — always behind content.
- Sentence case everywhere for UI text. UPPERCASE only for status badges and sidebar section headers.
- Turkish-first. UI must handle Turkish text (+15% length vs English). Buttons single-line with ellipsis fallback.
- Icons: **Lucide only** (never hand-draw SVGs). Stroke 1.75, box 24px. Color inherits `currentColor`.
- Typography: Inter (body, headings) + JetBrains Mono (IDs, codes, financial amounts).
- No emoji in product UI. The leaf icon (Lucide `Leaf`) is the ESG signal.
- Cards: 12px radius, 24px padding, `--shadow-sm`, 1px `--border`. Lift on hover: shadow bump + border darkens.
- Sidebar: 260px wide, dark green (`#0A2E1C`), fixed left. Active item: neon green text + subtle green background.
