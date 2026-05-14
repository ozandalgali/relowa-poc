---
skill: design-system-keeper
purpose: Guard packages/ui. Add tokens and primitives only after deliberate review. Prevent drift from the canonical Figma + ADR-0011 values.
squad: frontend-ui
required_reading:
  - AGENTS.md
  - docs/adr/0011-ui-kit-design-tokens.md
  - docs/frontend/component-inventory.md
  - docs/frontend/status-taxonomy.md
  - docs/figma/extracted/batch-01-landing.json
  - docs/figma/extracted/batch-02-auth.json
  - docs/figma/extracted/batch-03-dashboard.json
---

# Skill: design-system-keeper

## When to invoke

- Adding or modifying a design token (color, type scale, spacing, radius, shadow).
- Adding a new Layer 0 primitive to `packages/ui/primitives/`.
- Adding a new Layer 1 pattern to `packages/ui/patterns/`.
- Reviewing a PR that touches `packages/ui/` for drift.
- Sync between Figma updates and `packages/ui/tokens/`.

**Do NOT invoke this skill for:** feature-specific components that don't live in `packages/ui/` (that's `feature-component-builder`). Do not invoke for icons — Lucide is the base; icon additions go through this skill only when a new duotone tile is needed.

## Required reading

- `AGENTS.md`
- `docs/adr/0011-ui-kit-design-tokens.md` — the canonical token contract
- `docs/frontend/component-inventory.md` — current Layer 0/1/2 surface
- `docs/frontend/status-taxonomy.md` — drives `StatusBadge` variants
- The Figma extraction batch(es) introducing the new value
- For any new token: ADR-0011 §6 (color drift policy)

## Inputs

- Figma reference for the new value, with batch JSON.
- Pre-existing token table (ADR-0011 §2).
- The proposed addition or change.

## Outputs

For a new token:

1. **Update `packages/ui/tokens/<category>.ts`** with the new value.
2. **Mirror to CSS variables** in `packages/ui/globals.css`.
3. **Update ADR-0011 §2** if the canonical table changes, **or** §6 (drift policy) if absorbing a Figma variant.
4. **Bump `packages/ui` version** if downstream apps need to opt in.
5. **Notify `doc-keeper`** to update `component-inventory.md` if a new component uses the token.

For a new primitive (Layer 0):

1. Component file in `packages/ui/primitives/<Name>.tsx`, restyled shadcn or new.
2. Storybook story covering states (default, hover, focus, disabled, error, etc.).
3. a11y attributes verified (role, aria-*, keyboard nav).
4. Token-only styling — no inline hex, no ad-hoc rem values.
5. Type-safe props with sensible defaults.
6. Export added to `packages/ui/primitives/index.ts`.
7. `tester` invocation to add a snapshot test.

For a new pattern (Layer 1):

1. Component file in `packages/ui/patterns/<Name>.tsx` composing only primitives + tokens.
2. Storybook story showing the patterns from Figma (e.g. `KPIStatCard.story.tsx`).
3. Update `component-inventory.md` with the new pattern + Figma references.
4. If the pattern depends on a new token, that token lands first (separate PR).

## The canonical drift-prevention rule

Every TSX file in `packages/ui/` must satisfy:

- **No inline hex colors.** Use `text-brand-500` (Tailwind), `var(--brand-500)` (CSS), or `tokens.brand[500]` (TS).
- **No magic spacing.** Tailwind classes from the spacing scale only.
- **No magic radii.** Token radii only.
- **No inline shadows.** `shadow-sm`/`shadow-md`/`shadow-lg` from token-mapped Tailwind.

A linter rule enforces this (ESLint custom rule, planned).

## Non-negotiables

- ❌ **Never** absorb a Figma color variant into the codebase as an inline value. Either it's a new token or the Figma file needs to update.
- ❌ **Never** add a primitive that wraps shadcn without restyling to tokens.
- ❌ **Never** create variants by string concatenation (`'bg-' + color`) — Tailwind purges them.
- ❌ **Never** add a pattern to Layer 1 used in fewer than 3 screens (it's a feature component, not a pattern).
- ❌ **Never** modify a primitive's API to fit a single feature's need. Wrap it in `feature-component-builder` instead.
- ✅ **Always** add a Storybook story for every new primitive/pattern with all states.
- ✅ **Always** run the a11y check (axe in Storybook) before merge.
- ✅ **Always** verify visual snapshot — if Figma shows pixel-precise spacing, match it.

## Verification

```bash
pnpm --filter @relowa/ui typecheck
pnpm --filter @relowa/ui storybook:build
pnpm --filter @relowa/ui lint
pnpm --filter @relowa/ui test           # snapshot + a11y
```

If any step fails, the task is not done.

## See also

- `.opencode/skills/feature-component-builder.md` — the consumer side
- `.opencode/skills/route-page-builder.md` — the page assembly side
- `docs/adr/0011-ui-kit-design-tokens.md`
- `docs/frontend/component-inventory.md` — keep this in sync
