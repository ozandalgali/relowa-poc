# Test category — Frontend E2E

**Status:** 📋 P1 (3 critical paths) · full coverage P2.
**Owner:** `tester`.
**Runner:** Playwright.
**Location:** `tests/e2e/`.

## Purpose

Verify critical user journeys end-to-end through a real browser, against the deployed dev stack. The "user can actually do X" layer.

## The 3 P1 critical paths

Tagged `@critical` so PR CI can filter for them.

1. **Auction lifecycle.** Producer signs up, creates tender, recycler bids, server closes, producer sees winner.
2. **Carrier sub-auction.** Recycler opens carrier ad, carrier bids, recycler awards, shipment created.
3. **Escrow happy path.** Recycler funds escrow (Manual provider), shipment delivered, escrow released, certificate emitted.

P2 expands to cover every Figma flow.

## Test shape

```ts
import { test, expect } from '@playwright/test';

test.describe('Auction lifecycle @critical', () => {
  test('producer creates tender, recycler bids, server closes, winner declared', async ({ page, context }) => {
    // Producer flow
    await page.goto('/giris');
    await page.getByLabel('E-posta').fill('ahmet@acme.com');
    await page.getByLabel('Şifre').fill('dev');
    await page.getByRole('button', { name: 'Giriş Yap' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto('/ihaleler/yeni');
    await page.getByLabel('Atık Türü').selectOption('plastic');
    await page.getByLabel('Miktar (ton)').fill('12.5');
    await page.getByRole('button', { name: 'Yayınla' }).click();
    await expect(page.getByText('İhale yayınlandı')).toBeVisible();

    // Switch to recycler in a second context
    const recyclerCtx = await context.browser()!.newContext();
    const recyclerPage = await recyclerCtx.newPage();
    await recyclerPage.goto('/giris');
    // ...
    // Recycler sees the tender in marketplace
    await recyclerPage.goto('/pazar-yeri');
    await expect(recyclerPage.getByText('12.5 ton')).toBeVisible();

    // Bid + close + verify winner ...
  });
});
```

## Setup

- Pre-suite: `pnpm db:reset && pnpm dev` (full stack).
- Tests don't use transaction rollback — they need real commits.
- Each suite reseeds; tests within a suite share state but design tests to be order-independent.

## Playwright config

```ts
// playwright.config.ts
export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    baseURL: 'http://localhost:3001',
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Firefox/Webkit added in P2
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
  },
});
```

## CI gating

- PR: `playwright test --grep @critical` (the 3 critical paths only).
- Nightly: full suite.
- The `@critical` tag is the gate; new critical paths must be tagged deliberately.

## Non-negotiables

- ❌ Never query by `data-testid` when `getByRole` or `getByLabel` works (accessibility is testability).
- ❌ Never `page.waitForTimeout` — use `expect(...).toBeVisible({ timeout: ... })` or `page.waitForResponse`.
- ❌ Never run E2E against production.
- ✅ Always tag with `@critical` if it's in the P1 must-pass set.
- ✅ Always test in Turkish locale (PRD-0005 — the primary user experience).

## See also

- `docs/testing/conventions.md`
- `docs/adr/0012-frontend-app-architecture.md`
- `.opencode/skills/route-page-builder.md`
- `.opencode/skills/tester.md`
