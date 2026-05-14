---
skill: route-page-builder
purpose: Assemble Next.js pages from components. Wire data fetching, i18n, RBAC visibility, and route metadata.
squad: frontend-ui
required_reading:
  - AGENTS.md
  - docs/adr/0012-frontend-app-architecture.md
  - docs/adr/0011-ui-kit-design-tokens.md
  - docs/adr/0005-cognito-authentication.md
  - docs/prd/0004-module-map.md
  - docs/prd/0005-i18n-and-content.md
  - docs/frontend/component-inventory.md
---

# Skill: route-page-builder

## When to invoke

- Adding a new page in `apps/web/(app)/<route>/page.tsx` or `apps/admin/(admin)/<route>/page.tsx`.
- Wiring a Server Component to data sources (Drizzle direct read, Hono API call, AppSync subscription).
- Setting up route metadata (title, description, OG tags).
- Adding loading.tsx / error.tsx boundaries.
- Configuring i18n route slugs.

**Do NOT invoke this skill for:**
- Building the components the page renders (that's `feature-component-builder`).
- Modifying `packages/ui` (that's `design-system-keeper`).
- API logic (that's `endpoint-writer`).

## Required reading

- `AGENTS.md`
- `docs/adr/0012-frontend-app-architecture.md` — route groups, data layer split, role-aware sidebar
- `docs/adr/0011-ui-kit-design-tokens.md`
- `docs/adr/0005-cognito-authentication.md` — JWT shape, GUC bridge for SSR
- `docs/prd/0004-module-map.md` — which module the route belongs to
- `docs/prd/0005-i18n-and-content.md` — Turkish slugs, English filenames
- `docs/frontend/component-inventory.md` — find the existing screen composition

## Inputs

- The Figma screen reference.
- The component composition list (from `component-inventory.md`).
- The data sources (Drizzle queries, Hono endpoints, AppSync channels).
- The role(s) that can access the page.

## Outputs

For a new page:

1. **Folder + page.tsx** in the right route group:
   - Operator: `apps/web/(app)/<turkish-slug>/page.tsx`
   - Auth: `apps/web/(auth)/<turkish-slug>/page.tsx`
   - Marketing: `apps/web/(marketing)/<turkish-slug>/page.tsx`
   - Admin: `apps/admin/(admin)/<english-slug>/page.tsx`
2. **`loading.tsx`** with `Skeleton` primitives mimicking the real page.
3. **`error.tsx`** with a friendly error message and a "retry" action.
4. **Metadata** export with localized title and description.
5. **Data fetching:**
   - Reads in Server Components via Drizzle (with JWT GUC set by middleware).
   - Mutations via Hono API client (with `Idempotency-Key`).
   - Real-time via the `useRealtimeChannel` hook (ADR-0006).
6. **Visibility guard** — if the route is role-scoped, redirect to `/403` (or hide via sidebar). Belt-and-braces: RLS still enforces server-side.
7. **i18n keys** added under `messages/{tr,en}/<module>.json` for any new strings.

## Server vs Client component decision

Default to **Server Component**. Use `'use client'` only when:

- The component holds interactive state (a form, an open/close dialog).
- The component subscribes to a real-time channel.
- The component reads `useTranslations` *and* is interactive (Server Components can also use `next-intl` for static reads).

Pages should generally be Server Components that render Server + Client children.

## Non-negotiables

- ❌ **Never** put data-fetching logic in `'use client'` components — fetch on the server, pass as props.
- ❌ **Never** call `db.*` directly from a Client Component (it would expose credentials).
- ❌ **Never** hard-code an English route slug. URL = Turkish (PRD-0005).
- ❌ **Never** check authorization with `if` in the page handler — RLS is the boundary. The page may hide UI but not gate data.
- ❌ **Never** import a component from another feature's `_components/` folder.
- ✅ **Always** add `loading.tsx` and `error.tsx`.
- ✅ **Always** include OG tags for marketing pages.
- ✅ **Always** verify the role-aware sidebar shows the right menu item.

## Verification

```bash
pnpm --filter @relowa/web typecheck
pnpm --filter @relowa/web lint
pnpm --filter @relowa/web build           # catches SSR-only issues
pnpm --filter @relowa/web test
# E2E for the route (handed to tester)
```

## See also

- `.opencode/skills/feature-component-builder.md` — the component-level builder
- `.opencode/skills/design-system-keeper.md` — for any `packages/ui` need
- `.opencode/skills/realtime-debugger.md` — for live-data troubleshooting
- `.opencode/skills/tester.md` — for the E2E test
- `docs/adr/0012-frontend-app-architecture.md`
