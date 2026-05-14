# Test category — Visual Regression

**Status:** 📋 P2 (doc + CI scaffold P1; runs nightly when P2 graduates).
**Owner:** `tester`.
**Runner:** Playwright screenshot diff.
**Location:** `tests/visual/`.

## Purpose

Catch unintended visual regressions in components and pages. Complements component snapshot tests (which catch DOM changes) with pixel-level diffs (which catch CSS / theme / layout regressions).

## P1 scaffolding

The workflow YAML exists with the stage commented out:

```yaml
# P2 — uncomment when visual regression graduates
# visual-regression:
#   runs-on: ubuntu-latest
#   needs: lint
#   steps:
#     - uses: actions/checkout@v4
#     - uses: pnpm/action-setup@v3
#     - run: pnpm install
#     - run: pnpm exec playwright install chromium
#     - run: pnpm test:visual
#     - uses: actions/upload-artifact@v4
#       if: failure()
#       with:
#         name: visual-diff
#         path: tests/visual/__snapshots__/
```

The `tests/visual/` directory has a `.gitkeep` and a `README.md` describing what will go here in P2.

## P2 test shape

```ts
import { test, expect } from '@playwright/test';

test.describe('Visual regression @visual', () => {
  test('marketplace tender card', async ({ page }) => {
    await page.goto('/storybook?id=patterns-tendercard--default');
    await expect(page).toHaveScreenshot('tender-card-default.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('escrow status card — funds locked', async ({ page }) => {
    await page.goto('/storybook?id=patterns-escrowstatuscard--funds-locked');
    await expect(page).toHaveScreenshot('escrow-funds-locked.png');
  });

  test('full marketplace page (Acme producer view)', async ({ page }) => {
    await page.goto('/giris');
    await loginAs(page, 'ahmet@acme.com');
    await page.goto('/dashboard');
    await expect(page).toHaveScreenshot('producer-dashboard.png', {
      fullPage: true,
      mask: [page.locator('[data-dynamic]')],   // mask timestamps
    });
  });
});
```

## What this category covers (P2)

- Every Storybook story → snapshot.
- The 6 main page templates per role (Producer / Recycler / Carrier dashboards, tender detail, carrier ad detail, escrow detail).
- Dark variants of cards (when introduced).
- Mobile breakpoint (P2.5 — 320px wide).

## Snapshot management

- Snapshots committed to repo (in `tests/visual/__snapshots__/`).
- Snapshot updates require PR description rationale.
- A bot comment in PR shows the diff inline.
- Storybook stories become the authoritative test target (rather than ad-hoc UI states).

## What this does NOT cover (P2)

- Animation timing (covered by manual review).
- Cross-browser rendering quirks (covered by P3 Firefox/Webkit project additions).

## Non-negotiables (when P2 lights up)

- ❌ Never update a snapshot blindly. Look at the diff, explain the intent.
- ❌ Never run visual regression in PR CI (it's slow); nightly only.
- ✅ Always mask dynamic regions (timestamps, IDs, random data).

## P1 reasons for deferral

- Solo lead capacity: setting up + maintaining visual snapshots adds 1–2 sessions of work.
- The 3 critical-path E2E tests catch the visible failures cheaper in P1.
- Tokens + Storybook discipline (ADR-0011) prevent most drift without screenshots.

## See also

- ADR-0017 — Test strategy (P2 deferral rationale)
- `docs/testing/categories/frontend-component.md`
- `.opencode/skills/design-system-keeper.md`
