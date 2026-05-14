# PRD-0005 — Internationalization & Content Strategy

**Status:** Accepted
**Date:** 2026-05-13
**Decision-makers:** Ozan (lead)

## Why this exists

PRD-0001 says "Turkish primary, English secondary." PRD-0002 lists i18n as "in scope." Neither defines what that means in practice — which strings are translated, where they live, how routes work, who owns the copy.

This PRD fixes those decisions before the frontend implementation begins. Without it, the codebase ends up with half-Turkish-half-English strings inline, duplicated translation keys, and route slugs that drift from copy.

## Decision

We adopt **Turkish-first i18n** with route-level Turkish, code-level English, and runtime-switchable user-facing copy. We use `next-intl` for the runtime, keyed message files, and a single content ownership model.

### 1. Languages in Phase 1

| Language | Code | Coverage | Status |
|---|---|---|---|
| Turkish | `tr` | 100% of user-facing copy (operator + admin) | **Default, ships first** |
| English | `en` | Reserved keys, partial coverage at launch | Ships as toggle, may have missing strings (graceful fallback) |

Phase 2 candidates (deferred per PRD-0002): German (DE expansion), French (BE/FR), Czech/Polish (CEE).

### 2. What is and isn't translated

| Surface | Translated? | Owner |
|---|---|---|
| UI labels, buttons, table headers | Yes (TR/EN) | UX + product |
| Marketing pages | Yes (TR/EN) | Marketing |
| Email subject lines and bodies | Yes (TR/EN) | UX + product |
| Push notifications | Yes (TR/EN) | UX + product |
| Audit log `action` field | **No, English only** | Engineering |
| `audit_events.payload` keys | **No, English only** | Engineering |
| Provider webhook payloads | **No, English only** | Engineering |
| ESG certificate PDF | Bilingual TR+EN side-by-side | Product + compliance |
| KVKK aydınlatma metni | Turkish only (regulatory) | Legal |
| Error codes shown to user | TR/EN copy keyed to a stable EN code | Engineering + UX |
| Logs (CloudWatch) | English only | Engineering |
| Database column names, types | English only (per Q10) | Engineering |
| Route slugs | **Turkish (single set, not duplicated per locale)** | Product |
| URL query params | English | Engineering |

The asymmetry — **routes in Turkish, code in English** — is intentional. Routes are user-visible (they appear in the address bar, in support tickets, in screenshots) and should match the product's language. Code is read by developers who span multiple language backgrounds; English is the standard.

### 3. Folder / file naming convention

Folder and file names are English everywhere except routes. Examples:

```
✅ apps/web/(app)/ihaleler/page.tsx           ← Turkish route, English filename
✅ packages/db/src/seed/index.ts              ← English everywhere
✅ packages/ui/patterns/KPIStatCard.tsx       ← English
✅ messages/tr/tenders.json                   ← English filename, Turkish content
❌ apps/web/(app)/ihaleler/sayfa.tsx          ← rejected: turkish filename
❌ packages/db/src/tohumlama/                 ← rejected: turkish folder
```

This is the Q10 decision codified.

### 4. Library choice — `next-intl`

We use `next-intl` for the i18n runtime. Reasons:

- App Router-native (RSC support, server-side message loading, no flash of untranslated content).
- ICU MessageFormat for plurals, dates, lists, numbers — non-trivial in Turkish (e.g. case suffixes, vowel harmony).
- Locale-aware date/time/number formatting via `Intl` API.
- Build-time route prefixing if we ever need locale-prefixed URLs (`/en/ihaleler` for non-Turkish marketing). Defer until needed.

Rejected alternatives:

- **i18next** — works, but `next-intl` is more idiomatic for App Router and has better RSC ergonomics.
- **Lingui** — JSX-extraction approach is slick but adds a build step we don't need.
- **Custom solution** — solo lead time-sink with negative leverage.

### 5. Message file structure

```
apps/web/messages/
  tr/
    common.json              ← Shared across modules (Save, Cancel, etc.)
    auth.json                ← Login, register, OTP, role select
    tenders.json             ← Tender create, list, detail, bid management
    carrier-ads.json         ← Carrier sub-auction copy
    shipments.json           ← Operations tracking
    escrow.json              ← Finance, invoices
    esg.json                 ← ESG report, certificates
    settings.json
    help.json
    errors.json              ← Error codes → friendly messages
    emails.json              ← Outbound email templates
  en/
    <same files>

apps/admin/messages/
  tr/  (subset — admin UI mostly TR)
  en/  (English mostly for internal staff who prefer it)
```

One file per module (matches PRD-0004 module map). Inside each file, namespacing by feature:

```jsonc
// tr/tenders.json
{
  "list": {
    "title": "İhalelerim",
    "empty": "Henüz ihale oluşturmadınız",
    "create_cta": "Yeni İhale Oluştur"
  },
  "create": {
    "step_1_title": "Atık Bilgileri",
    "step_2_title": "AI Analiz",
    "publish_success": "İhale yayınlandı"
  },
  "status": {
    "draft": "Taslak",
    "published": "Aktif",
    "closing": "Canlı",
    "won": "Tamamlandı"
  }
}
```

Keys are English (`empty`, `create_cta`), values are Turkish/English. This matches the "code in English, content in language" rule.

### 6. Status taxonomy as keyed strings

The status taxonomy doc (`docs/frontend/status-taxonomy.md`) defines canonical English status codes (`PUBLISHED`, `FUNDS_LOCKED`). Each code maps to:

- A DB enum value (lowercase: `published`).
- An EN message in `en/<module>.json` under `status.PUBLISHED`.
- A TR message in `tr/<module>.json` under `status.PUBLISHED`.

This means the **Figma copy `"AKTİF"` is not a translation key** — it's the rendering of `status.published` in Turkish. If product wants to change "Aktif" to "Yayında," we update one key in `tr/tenders.json`; the DB enum, the audit log, and the EN copy stay untouched.

### 7. Locale resolution

```
Order of preference:
  1. User's saved preference (users.locale column, Phase 1 supports 'tr' | 'en')
  2. Cookie set by topbar locale switcher (TR / EN)
  3. Accept-Language header
  4. Default: 'tr'
```

The locale switcher in the Figma topbar (`TR / EN`) flips the cookie and re-renders. No page navigation needed (next-intl SSR + client transition).

### 8. Number, date, currency formatting

All formatting goes through `Intl` (via `next-intl` helpers):

```ts
formatNumber(15000)              // tr: 15.000   en: 15,000
formatCurrency(1500, 'TRY')      // tr: 1.500,00 ₺   en: ₺1,500.00
formatDate(d, 'short')           // tr: 13.05.2026   en: 13/05/2026
formatRelativeTime(d)            // tr: "3 dakika önce"   en: "3 minutes ago"
```

Magic constants for currency (e.g. always 'TRY' in Phase 1) are not allowed inline — they come from `tokens.currency.DEFAULT`. PRD-0002 future EU expansion needs `EUR` ready.

### 9. Translation operational flow

| Stage | Owner | Tool |
|---|---|---|
| New string introduced | Developer | Add key + EN value to `en/`; mark TR as `__TODO__` |
| TR translation | Product (Ozan in P1) | Edit `tr/` file directly |
| Review | UX | PR review |
| Missing TR keys at build | CI | Build warns; production build allows but logs to Sentry |

In Phase 1, translation is in-codebase. No Crowdin/Lokalise integration. Phase 2 decision once we add a 3rd language.

### 10. Pluralization and Turkish grammar notes

Turkish uses vowel harmony and complex case suffixes that simple string concatenation breaks. ICU MessageFormat handles plurals; case suffixes are handled by providing full phrases instead of concatenation:

```jsonc
// ❌ Bad — concatenation, breaks vowel harmony
{ "tender_count": "{count} {entity_type}" }

// ✅ Good — full phrases
{
  "tender_count": "{count, plural, one {# ihale} other {# ihale}}",
  "carrier_ad_count": "{count, plural, one {# taşıyıcı ilanı} other {# taşıyıcı ilanı}}"
}
```

Turkish doesn't grammatically distinguish singular from plural in the way English does (we say "3 ihale," not "3 ihaleler"), but ICU plural rules give us forward compatibility for other languages.

### 11. Content tone

| Audience | Tone | Example |
|---|---|---|
| Operators (Producer/Recycler/Carrier) | Professional, direct, jargon-aware ("teklif," "irsaliye," "escrow") | "İhale yayınlandı ve taşıyıcılara bildirim gönderildi." |
| Admin / staff | Internal, terse | "Escrow released. SFN execution: arn:..." |
| Marketing | Aspirational, business-value-focused | "Atık yönetiminde şeffaflık ve verimlilik." |
| Error messages | Empathetic, actionable | "Bağlantı kesildi. Birkaç saniye içinde tekrar deneyin." (not "Network error 503") |
| Legal (KVKK, terms) | Formal, regulator-aligned | unchanged from legal team text |

### 12. KVKK and regulated content

- Aydınlatma metni and terms-of-service ship as **Turkish only**. English versions exist for internal use but are not legally binding.
- Cookie consent banner is bilingual.
- KVKK request handling forms (data export, deletion) are Turkish only.
- Audit log column names in regulator-facing exports stay English (the data model is English; exports include a TR descriptor sheet).

## Consequences

### Positive

- One clear rule per surface; no ad-hoc translation calls or hardcoded Turkish strings in components.
- Routes feel native to Turkish users; code stays approachable to any developer.
- Next-intl + ICU handles future European languages without refactor.
- Translation status (TR complete vs `__TODO__`) is visible in PR diffs.

### Negative

- Phase 1 translation burden falls on Ozan. Mitigation: TR is the primary; EN can ship incomplete with graceful fallback.
- A Turkish-named route plus an English-named file feels inconsistent to first-time readers. Mitigation: this PRD is the explainer; the rule is consistent once internalized.
- ICU MessageFormat has a learning curve. Mitigation: examples in `messages/tr/common.json` cover the patterns we use.

## Future plans

- **Third language (DE / FR)** — adds locale-prefixed routes (`/de/ihaleler` becomes `/de/auktionen` because routes are translated too). Requires a `messages/de/_routes.json` mapping. Defer until expansion is real.
- **Crowdin / Lokalise integration** — when content volume crosses ~500 keys × 3 languages, switch translation workflow to a TMS. Until then, in-repo is faster.
- **AI-assisted draft translations** — pre-fill new keys with model-generated draft; human review before merge. Useful when scaling languages.
- **Locale-aware notifications** — emails / SMS / push respect the recipient's locale, not the sender's. Already in scope via `users.locale`; backend service needs to look it up.
- **Per-tenant branding terminology** — e.g. an enterprise tenant says "lot" instead of "tender." Add `tenant_terms` override layer over the standard messages. Defer until enterprise sales arrives.
- **RTL languages (Arabic, Hebrew)** — if expansion goes south/east. CSS logical properties in the UI kit make this manageable; messages files unaffected.

## Reference

- PRD-0001 — Vision (TR-first commitment)
- PRD-0002 — Phase 1 scope (i18n in scope)
- PRD-0004 — Module map (messages split by module)
- ADR-0012 — Frontend architecture (route groups; Turkish slugs)
- ADR-0011 — UI kit (locale-aware formatters)
- `docs/frontend/status-taxonomy.md` (planned) — canonical status codes
- next-intl: https://next-intl-docs.vercel.app
- ICU MessageFormat: https://unicode-org.github.io/icu/userguide/format_parse/messages/
