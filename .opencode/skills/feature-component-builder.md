---
skill: feature-component-builder
purpose: Build feature-specific components that consume packages/ui. Never modify packages/ui directly.
squad: frontend-ui
required_reading:
  - AGENTS.md
  - docs/adr/0011-ui-kit-design-tokens.md
  - docs/adr/0012-frontend-app-architecture.md
  - docs/frontend/component-inventory.md
  - docs/frontend/status-taxonomy.md
  - docs/prd/0005-i18n-and-content.md
---

# Skill: feature-component-builder

## When to invoke

- Building a component that is **feature-specific** and won't be reused across other modules (e.g. `TenderCreateStep1Form`, `CarrierAdAwardConfirmDialog`).
- Composing existing Layer 0 primitives + Layer 1 patterns from `packages/ui/`.
- Adding interactive behavior tied to a feature's data model.

**Do NOT invoke this skill for:**
- Components going into `packages/ui/` (that's `design-system-keeper`).
- Assembling pages from components (that's `route-page-builder`).
- Primitive shadcn restyling (that's `design-system-keeper`).

## Required reading

- `AGENTS.md`
- `docs/adr/0011-ui-kit-design-tokens.md`
- `docs/adr/0012-frontend-app-architecture.md`
- `docs/frontend/component-inventory.md` — **find the patterns that already exist** before considering a new one
- `docs/frontend/status-taxonomy.md` — for any status display
- `docs/prd/0005-i18n-and-content.md` — every visible string is keyed

## Inputs

- The Figma screen reference (`docs/figma/extracted/batch-XX-*.json` + the PNG).
- The data shape the component receives (TS types from the API or DB).
- The feature's parent route (where this component will be assembled).

## Outputs

For a typical feature component:

1. Component file in `apps/web/(app)/<route>/_components/<Name>.tsx` (or `apps/admin/...` for admin features).
2. Use only `@relowa/ui` primitives + patterns; no inline tokens.
3. All visible text is keyed in `apps/web/messages/{tr,en}/<module>.json`. Use `next-intl`'s `useTranslations()`.
4. Type-safe props derived from the API/DB types (don't redefine shapes).
5. Component is a Server Component by default; mark `'use client'` only when interactive state is needed.
6. Loading and error states handled with `Skeleton` / `Toaster` primitives.
7. Storybook story optional but recommended for complex components.

## When you think you need a new pattern

If the component you're building looks like something that could be used in 3+ Figma screens:

1. **Stop.** This is a Layer 1 pattern, not a feature component.
2. Hand off to `design-system-keeper` to add it to `packages/ui/patterns/`.
3. Wait for that PR to land.
4. Come back and consume the new pattern.

This separation is the whole point of the layered model.

## Non-negotiables

- ❌ **Never** edit `packages/ui/` from a feature component PR.
- ❌ **Never** hard-code Turkish or English copy. Use `useTranslations('module')`.
- ❌ **Never** inline hex colors, magic spacings, magic radii.
- ❌ **Never** call the DB directly from a Client Component — use a Server Component + props, or a server action.
- ❌ **Never** import another feature's components. Cross-feature reuse means it should be a pattern in `packages/ui/`.
- ✅ **Always** check `component-inventory.md` first; the pattern may already exist.
- ✅ **Always** prefer Server Components; reach for `'use client'` only for state/interaction needs.
- ✅ **Always** add loading + error states; never assume the network succeeds.
- ✅ **Always** verify the Figma reference matches the rendered output (visual eyeball at minimum).

## Verification

```bash
pnpm --filter @relowa/web typecheck
pnpm --filter @relowa/web lint
pnpm --filter @relowa/web test
# Storybook (if a story was added)
pnpm --filter @relowa/web storybook:build
```

## See also

- `.opencode/skills/design-system-keeper.md` — for any `packages/ui` changes
- `.opencode/skills/route-page-builder.md` — the next step (assembly)
- `.opencode/skills/realtime-debugger.md` — for live-data flows
- `docs/frontend/component-inventory.md`
