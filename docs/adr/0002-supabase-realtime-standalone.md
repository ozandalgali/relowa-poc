# ADR-0002 — Supabase Realtime Standalone

**Status:** Accepted (POC validated)
**Date:** 2026-05-09

## Context

Relowa's UI requires live updates for several core flows:
- Auction countdowns and live bids
- Tender list updates as new tenders publish
- Audit-log live tail for admin
- (Phase 2) Live carrier GPS positions

We need a real-time push mechanism with these properties:
- Postgres CDC integration (so writes through any path — Drizzle, raw SQL, pg_cron — automatically reach subscribers)
- Self-hostable in EU region for KVKK
- Reasonable client SDK (React-friendly)
- Operationally acceptable for a solo lead

## Decision

We will run **only** the `supabase/realtime` Docker image, standalone, pointed at our own Postgres. **No other Supabase component is used.** Auth, REST, Storage, Studio — none. We hand-roll those (Drizzle for DB access, Hono for REST, S3+presigned URLs for storage, TablePlus / Drizzle Studio / Adminer for inspection).

Frontend uses `@supabase/realtime-js` directly. **We do NOT install `@supabase/supabase-js`** — that would pull in the full ecosystem.

## Consequences

### Positive
- Same DX as Supabase Cloud's realtime: `channel('tenders').on('postgres_changes', ...)`.
- Hits Postgres logical replication directly — no manual event publication needed.
- Self-hosted in our VPC, KVKK clean.
- Operational cost: one stateless Fargate task (~$15/month).

### Negative
- One more container to operate. (Mitigation: Fargate auto-restarts; image is widely deployed.)
- `DB_ENC_KEY` quirks (must be exactly 16 ASCII characters for AES-128-ECB). Documented in `docs/memory/learned/`.
- Tight coupling to Supabase's image release cadence. (Mitigation: pinned to `v2.30.34`; we evaluate before bumping.)

## Alternatives considered

- **AWS AppSync subscriptions** — managed, KVKK-friendly, but requires us to publish events explicitly (no CDC). More work, more lock-in to GraphQL.
- **Pusher / Ably** — best DX of any managed option, but third-party data residency adds KVKK paperwork and per-connection cost grows quickly.
- **Postgres LISTEN/NOTIFY** — zero infra, but 8KB payload limit and multi-server scaling story is rough. Acceptable for POC, not Phase 1.

## Validation

POC seeded the publication with `tenders`, `bids`, `audit_events`. Logical replication slot active, container healthy, listening on port 4000. End-to-end client subscription test in [`apps/web/`] (in progress).
