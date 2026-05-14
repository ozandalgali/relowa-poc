# PRD-0002 — Phase 1 Scope

> What's in Phase 1, what isn't, what would make us cut more.

## Goal

Ship the **core transactional loop** end-to-end at production quality:

```
Producer creates tender
    → Recyclers bid (live, auction-style)
    → Auction closes server-side
    → Winner declared
    → Escrow funded (Iyzico or similar Turkish provider)
    → Carrier assigned (Phase 1 either active or operationally managed)
    → Delivery confirmed
    → Escrow released
    → ESG certificate generated
```

Target window: **3–4 months** from kick-off, solo lead, with this POC's substrate.

## In scope

| Module | Specifics |
| --- | --- |
| Authentication | Multi-tenant org/user/role model. Email + password + invitations. (SSO/SAML deferred.) |
| Tender lifecycle | DRAFT → PUBLISHED → CLOSING → WON → FUNDED → DELIVERED → SETTLED, plus CANCELLED / DISPUTED. |
| Bidding | Real-time bid placement, soft-close pattern, server-authoritative timing. |
| AI image analysis | Greyparrot commercial API integration for purity/contamination/quality scoring. (Self-hosted defer to Phase 2.) |
| Escrow | One Turkish provider integrated (Iyzico or PayTR — TBD). Idempotent webhook handling. |
| Audit trail | Append-only `audit_events` with hash chain. S3 Object Lock mirror (legal evidence). |
| ESG certificate | Basic auto-generated PDF on settle. Real ESG reporting Phase 2. |
| Logistics tracking | "Operationally managed" in Phase 1 — Relowa staff coordinates carriers manually. Active GPS tracking Phase 2. |
| Notifications | In-app real-time + email (SES). Push notifications Phase 2. |
| Admin | Internal Relowa-staff dashboard for license verification, escrow disputes. |
| i18n | Turkish primary, English secondary. |
| PWA | Producer / recycler dashboards as installable PWA. |

## Deferred to Phase 2

- Carrier driver mobile app (Expo / React Native), live GPS ingestion.
- AI image analysis self-hosted (replace Greyparrot API).
- Smart waste bin IoT ingestion (Sensoneo-style).
- Full ESG reporting with continuous-aggregate analytics.
- Multi-language beyond TR/EN.
- SSO/SAML for enterprise customers.
- Istanbul Local Zone hot-path migration.

## Deferred to Phase 3+

- AI-driven matching engine.
- Predictive logistics route optimization.
- Marketplace mode (multi-producer aggregation).
- Multi-region.

## Cut criteria

If the 3–4 month window slips, cut in this order:

1. ESG certificate auto-generation → manual PDF for pilot.
2. AI image analysis → manual photo review for pilot.
3. Idempotent escrow webhook handling stays — never cut.
4. Multi-role within org (admin/accounting/operations) → start with admin-only, layer roles in week 14.

The four things we **never** cut:
- RLS enforcement
- Audit hash chain
- Server-authoritative auction close
- Idempotency on every mutation

## Risks ranked

1. **Escrow integration.** Highest unknown. Iyzico's B2B-with-multiparty-payouts is undocumented. Mitigation: spike in week 2.
2. **Greyparrot API.** Pricing and KVKK terms unverified. Mitigation: fallback to OpenAI/Anthropic vision APIs.
3. **Real-time scaling under bid storms.** Standalone Realtime container untested at scale. Mitigation: Pusher fallback ready.
4. **Solo lead bandwidth.** The honest risk. Mitigation: document everything in `docs/memory/`, test everything, use AI to scale leverage.
