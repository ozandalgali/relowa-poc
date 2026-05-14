# Status Taxonomy

> The canonical list of every status value used by the Relowa platform. Same value in the DB enum, the audit log, the API JSON, the `StatusBadge` lookup, the Turkish UI copy, and the English UI copy. Drift between layers is a bug.

**Last reviewed:** 2026-05-13.

## Why this exists

Figma uses ad-hoc Turkish labels: `AKTİF`, `CANLI`, `TAMAMLANDI`, `YOLDA`, `ESCROWDA`, `Funds Locked`, `Beklemede`. These are *rendered values*, not codes. Code-side, we use English canonical codes and let i18n (PRD-0005) handle the rendering. This file is the source of truth for the codes.

The rule, every time: **DB enum value = audit_events.action prefix = API JSON status field = `StatusBadge` lookup key = translation key suffix.**

If a screen needs a status not listed here, this file is wrong — update it before shipping the screen.

---

## Tender (waste auction)

DB enum: `tender_status` (already in `packages/db/src/schema.ts`).

| Code | TR copy | EN copy | Badge variant | Description |
|---|---|---|---|---|
| `draft` | Taslak | Draft | `neutral-light` | Producer created but not yet published |
| `published` | Aktif | Active | `success-light` | Visible to recyclers, accepting bids |
| `closing` | Canlı | Live | `success` | Within close window or extension; live bid feed shown |
| `won` | Tamamlandı | Won | `dark-fill` | Server picked a winner; tender locked |
| `funded` | Ödendi | Funded | `success` | Recycler paid into escrow (ADR-0007) |
| `delivered` | Teslim Edildi | Delivered | `info` | Carrier delivered to recycler |
| `settled` | Kapatıldı | Settled | `dark-fill` | Escrow released, certificate issued |
| `cancelled` | İptal Edildi | Cancelled | `neutral-fill` | Producer cancelled before any bid |
| `disputed` | İhtilaflı | Disputed | `danger` | Under super_admin review (ADR-0014) |

**Audit events:** `tender.created`, `tender.published`, `tender.bid_received`, `tender.closing`, `tender.won`, `tender.funded`, `tender.delivered`, `tender.settled`, `tender.cancelled`, `tender.disputed`, `tender.org_switched` (when AM impersonates).

---

## Bid (on waste tender)

Not a DB enum yet — derived from query at read time. Will become a real enum once Phase 2 adds bid history filtering.

| Code | TR copy | EN copy | Badge variant | Description |
|---|---|---|---|---|
| `placed` | Verildi | Placed | `success-light` | Submitted; current standing not computed |
| `outbid` | Geçildi | Outbid | `neutral-light` | A higher bid exists |
| `winning` | Önde | Winning | `success` | Current top bid in a live auction |
| `won` | Kazanıldı | Won | `dark-fill` | Tender closed and this bid was the winner |
| `lost` | Kaybedildi | Lost | `neutral-fill` | Tender closed and a different bid won |
| `withdrawn` | Geri Çekildi | Withdrawn | `neutral-fill` | Bidder retracted (only allowed in `draft` window — rare) |

**Audit events:** `bid.placed`, `bid.withdrawn`. Status changes (`outbid`, `winning`) are derived, not audited.

---

## Carrier Ad (recycler → carriers sub-auction, ADR-0010)

DB enum: `carrier_ad_status` (new in M1 per ADR-0010).

| Code | TR copy | EN copy | Badge variant | Description |
|---|---|---|---|---|
| `open` | Açık | Open | `success-light` | Accepting carrier bids |
| `closing` | Teklif Bekliyor | Reviewing | `neutral-light` | After `closes_at`, no new bids, recycler has 24h to award |
| `awarded` | Taşıyıcı Seçildi | Awarded | `dark-fill` | Recycler picked a winner; shipment created |
| `cancelled` | İptal Edildi | Cancelled | `neutral-fill` | Recycler cancelled |
| `expired` | Süresi Doldu | Expired | `neutral-fill` | Closed without award after 24h grace |

**Audit events:** `carrier_ad.created`, `carrier_ad.bid_received`, `carrier_ad.closing`, `carrier_ad.awarded`, `carrier_ad.cancelled`, `carrier_ad.expired`.

---

## Carrier Bid (on carrier ad)

DB enum: `carrier_bid_status`.

| Code | TR copy | EN copy | Badge variant | Description |
|---|---|---|---|---|
| `submitted` | Verildi | Submitted | `success-light` | Carrier submitted |
| `withdrawn` | Geri Çekildi | Withdrawn | `neutral-fill` | Carrier retracted |
| `rejected` | Reddedildi | Rejected | `neutral-fill` | Another bid won |
| `accepted` | Kabul Edildi | Accepted | `success` | The winning bid |

**AI badges** (separate from status, shown alongside): `ai:best_value` / `ai:fastest`. These render as `AI: Best Value` / `AI: Fastest` regardless of locale (English labels are intentional; product decision).

---

## Shipment

DB enum: `shipment_status`.

| Code | TR copy | EN copy | Badge variant | Description |
|---|---|---|---|---|
| `pending` | Sırada | Pending | `neutral-light` | Carrier selected, pickup not yet started |
| `in_transit` | Yolda | In Transit | `success` | Driver started route |
| `delivered` | Teslim Edildi | Delivered | `info` | Recycler confirmed receipt |
| `disputed` | İhtilaflı | Disputed | `danger` | Damage / quantity issue raised |
| `completed` | Tamamlandı | Completed | `dark-fill` | After dispute window closed without dispute |

**Shipment events** (separate event log table, not statuses): `pickup_arrived`, `pickup_complete`, `in_transit_ping`, `arrived_at_dropoff`, `delivered`, `delay_reported`. Each carries a timestamp and (when applicable) a lat/lng.

A shipment is "delayed" when `now() > expected_arrival_at` for `> 30min` AND status is `in_transit`. The `delay_reported` event marks this explicitly. In UI we show `Gecikme` / `Delayed` derived badge alongside the base status.

---

## Escrow

DB enum: `escrow_status` (ADR-0007).

| Code | TR copy | EN copy | Badge variant | Description |
|---|---|---|---|---|
| `pending` | Beklemede | Pending | `neutral-light` | Created, awaiting funding |
| `funds_locked` | Escrowda | Funds Locked | `warning` | Recycler paid, provider holding |
| `in_transit` | Sevkiyatta | In Transit | `info` | Shipment moving |
| `delivered` | Teslim Edildi | Delivered | `info` | Producer confirmed receipt, dispute window open |
| `released` | Ödendi | Released | `success` | Disbursed to producer + carrier |
| `refunded` | İade Edildi | Refunded | `neutral-fill` | Funds returned to recycler |
| `disputed` | İhtilaflı | Disputed | `danger` | Under super_admin review |
| `failed` | Başarısız | Failed | `danger` | Provider error, manual intervention needed |

Note: Figma uses `ESCROWDA` (uppercase) as a label. That's a rendering of `funds_locked` in Turkish.

---

## AI Scan (Greyparrot composition analysis)

Not a DB enum (lives in `ai_analyses` table as a status text column).

| Code | TR copy | EN copy | Badge variant | Description |
|---|---|---|---|---|
| `pending` | Bekliyor | Pending | `neutral-light` | Job queued, not started |
| `scanning` | Taranıyor | Scanning | `info` | In progress; UI shows animated bar |
| `verified` | Materyal Doğrulandı | Material Verified | `success` | Confidence > threshold (e.g. 0.85) |
| `needs_review` | İnceleme Gerekiyor | Needs Review | `warning` | Confidence below threshold |
| `failed` | Başarısız | Failed | `danger` | Provider error or unprocessable image |

Output fields when `verified`: `purity_score`, `composition_breakdown` (jsonb), `contamination_flags`.

---

## Invoice (e-fatura)

DB enum: `invoice_status` (Phase 2 — provisional for documentation).

| Code | TR copy | EN copy | Badge variant | Description |
|---|---|---|---|---|
| `draft` | Taslak | Draft | `neutral-light` | Generated, not yet submitted to provider |
| `submitted` | Gönderildi | Submitted | `info` | Sent to Nilvera/Foriba |
| `accepted` | Onaylandı | Accepted | `success` | GİB accepted |
| `rejected` | Reddedildi | Rejected | `danger` | Validation error |
| `paid` | Ödendi | Paid | `success` | Cross-referenced with escrow release |
| `cancelled` | İptal Edildi | Cancelled | `neutral-fill` | İptal / nota di credito equivalent |

---

## Support Ticket

DB enum: `ticket_status` (Phase 1).

| Code | TR copy | EN copy | Badge variant | Description |
|---|---|---|---|---|
| `open` | Açık | Open | `success-light` | Awaiting first response |
| `in_progress` | İnceleniyor | In Progress | `info` | Support agent engaged |
| `awaiting_user` | Kullanıcı Bekleniyor | Awaiting User | `warning` | Need info from operator |
| `resolved` | Çözüldü | Resolved | `success` | Closed, satisfied |
| `closed` | Kapatıldı | Closed | `dark-fill` | Auto-closed or no response |

---

## User / Org Membership

Not a DB enum currently; derived state.

| Code | TR copy | EN copy | Badge variant | Description |
|---|---|---|---|---|
| `invited` | Davet Edildi | Invited | `neutral-light` | Invitation sent, not accepted |
| `active` | Aktif | Active | `success` | Member can log in |
| `suspended` | Askıda | Suspended | `warning` | Admin suspended access |
| `removed` | Çıkarıldı | Removed | `neutral-fill` | Removed from org |

**Org-level statuses (Phase 1):**

| Code | TR copy | EN copy | Badge variant | Description |
|---|---|---|---|---|
| `pending_verification` | Onay Bekliyor | Pending Verification | `warning` | License docs uploaded, staff reviewing |
| `verified` | Onaylandı | Verified | `success` | Can transact |
| `rejected` | Reddedildi | Rejected | `danger` | Cannot use platform; needs resubmission |
| `suspended` | Askıda | Suspended | `warning` | Temporarily disabled (regulatory or KYC issue) |

---

## Auxiliary status indicators (not formal statuses)

These appear as colored dots / labels next to numbers but are not stateful entities themselves. Listed here so the badge variants stay tracked.

| Indicator | Color | Where it appears |
|---|---|---|
| `Tesis Durumu Aktif` (Facility Active) | `--success` | Recycler dashboard topbar |
| `Sistemler Aktif` (Systems Active) | `--success` | Landing page status pill |
| `Veri Entegrasyonu` (Data Integration Online) | `--success` | Help center service status |
| `Ödeme Ağ Geçidi` (Payment Gateway Online) | `--success` | Help center service status |
| `Mobil API Yavaş` (Mobile API Slow) | `--warning` | Help center service status |
| `Gecikme Tespit Edildi` (Delay Detected) | `--danger` | Operations tracking |
| `High Purity` / `Yüksek Saflık` | `--success` | AI analysis output |
| `Medium Score` / `Orta Skor` | `--warning` | AI analysis output |

---

## Sync discipline

Whenever a new status is introduced:

1. **Add the code here first** — pick the canonical English code, define TR/EN copy.
2. **Add to DB enum** in `packages/db/src/schema.ts` (`pnpm db:generate`).
3. **Add to `StatusBadge`** lookup table.
4. **Add to message files** under `tr/<module>.json` and `en/<module>.json` as `status.<code>`.
5. **Add audit event** action(s) involving the new status.
6. **Add to RLS isolation test** if status governs visibility.

A status that exists in Figma but not here is a planning gap; resolve before shipping.

## Reference

- ADR-0009 — Tender / bid auction (drives `tender_status`)
- ADR-0010 — Carrier sub-auction (drives `carrier_ad_status`, `carrier_bid_status`, `shipment_status`)
- ADR-0007 — Step Functions escrow (drives `escrow_status`)
- ADR-0014 — Internal staff RBAC (drives `support_ticket` workflows)
- PRD-0005 — i18n (how these codes render in Turkish/English)
- `packages/db/src/schema.ts` — DB-side enum definitions
- `packages/ui/patterns/StatusBadge.tsx` (planned) — the lookup table
