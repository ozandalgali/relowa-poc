# PRD-0001 — Relowa Vision

> What we're building, who for, and why now.

## Product

Relowa is a B2B **Waste Operating System (WOS)** for industrial recycling and logistics in Turkey, expanding to Eastern Europe and broader EU later.

It connects three actor types:
1. **Producers** — industrial firms generating recyclable waste (metal, plastic, paper, electronic, chemical).
2. **Recyclers** — licensed processing facilities buying that waste.
3. **Carriers** — logistics providers moving the waste between the two.

The platform replaces today's broken state — phone calls, broker markups, missing audit trails, unverifiable ESG reports — with a transactional system that:

- Auctions waste batches transparently (tender → bids → escrow → carrier → delivery → certificate).
- Provides cryptographically-verifiable audit trails for every state change.
- Generates ESG reports automatically from real transaction data.
- (Phase 2/3) Optimizes routing, applies AI-graded waste classification, ingests IoT telemetry from smart bins and trucks.

## Why now

- Turkish regulation (Çevre Lisansı, KVKK, sectoral compliance) is tightening.
- Existing solutions are point-tools (Sensoneo for IoT, Greyparrot for AI vision, Rubicon for marketplace) — nobody has stitched them.
- AI-augmented development means a small team can ship a defensible MVP in months, not years.

## Two-line success definition

Phase 1 ships when one producer can post a tender, one recycler can win it via auction, and one carrier can complete the delivery — all in production-grade code with full audit trail, working escrow, and observable telemetry. The pilot scale is **50–100 producers, 10–20 recyclers**.

## Non-goals (explicitly)

- Consumer-facing waste reporting.
- Building IoT hardware. (We'll integrate with Sensoneo or similar.)
- Building proprietary computer vision models. (Greyparrot API in Phase 1; possibly self-hosted later.)
- Multi-region active-active. (Single Frankfurt region, with future Istanbul Local Zone hot-path migration.)
- Mobile-first design for non-carrier personas. (PWA first, native mobile only for carrier drivers if needed.)

## Constraints carried forward

- **KVKK compliance** is non-optional. Data residency in EU (Frankfurt) initially; Istanbul Local Zone evaluation in Phase 2.
- **Modular by phase**, every phase ships production-quality. No "MVP-then-rewrite" mentality.
- **Solo lead** is realistic for the start. Architecture must accommodate that ops burden.
- **AWS-native substrate.** No Vercel, no Supabase Cloud as the production substrate — though Supabase Cloud EU may be acceptable for Phase 1 with Phase 2 migration if discussed.
