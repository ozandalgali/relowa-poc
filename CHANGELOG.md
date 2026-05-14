# Changelog

All notable changes to this POC are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project tracks pre-release iterations rather than semantic versions until the substrate decision is final.

## [Unreleased]

### Planned
- Hono API scaffold with tender/bid endpoints, JWT-via-GUC middleware, idempotency middleware
- LocalStack EventBridge bus + rules: `tender.published`, `bid.placed`, `tender.won`, `tender.closing`
- EventBridge Scheduler → Lambda auction close handler (30s interval)
- Soft-close anti-sniping: extend `closes_at` by 60s on late bids
- End-to-end bidding integration test (`tests/bidding-flow.sh`)
- Full tender lifecycle: `DRAFT → PUBLISHED → CLOSING → WON`
- ADR-0009: Local EventBridge bidding architecture

---

## [0.1.0] — 2026-05-09 — Substrate validated

### Added
- Docker Compose topology with Postgres 18, standalone Supabase Realtime container, LocalStack (S3 / EventBridge / Lambda / SES / SQS / Secrets Manager mocks), and Adminer.
- pnpm workspace layout (`apps/*`, `packages/*`).
- Drizzle ORM + Drizzle Kit migration tooling.
- `@relowa/db` package containing:
  - 7-table multi-tenant schema (`organizations`, `users`, `org_members`, `tenders`, `bids`, `audit_events`, `idempotency_keys`).
  - 6 PostgreSQL enums for status / role / type vocabularies.
  - 5 `auth.*` helper functions: `uid()`, `email()`, `org_id()`, `has_role()`, `is_member()`, `user_org_ids()`.
  - 21 RLS policies covering SELECT / INSERT / UPDATE on every application table.
  - Audit hash-chain trigger (`compute_audit_hash`) linking every audit row to the previous via SHA-256.
  - `updated_at` automation triggers.
  - `supabase_realtime` publication including `tenders`, `bids`, `audit_events`.
- `_relowa_migrations` tracking table for raw-SQL side-car migrations alongside Drizzle's `__drizzle_migrations`.
- Idempotent seed script that produces 3 organizations × 5 users × 5 memberships × 3 tenders.
- `pnpm db:reset` orchestrating: container teardown → start → wait → migrate → seed.

### Verified
- Cross-tenant SELECT isolation: producer admin sees own 3 tenders, recycler sees only 2 published, carrier sees 0, anonymous sees 0.
- Cross-tenant INSERT rejection: producer attempting to write to another org's tenders returns `new row violates row-level security policy`.
- Reset cycle: full teardown + rebuild + reseed under 30 seconds, deterministic.

### Fixed
- **Postgres 18 volume mount.** Switched mount from `/var/lib/postgresql/data` to `/var/lib/postgresql` per the Postgres 18 directory-layout convention. See `docs/memory/learned/postgres-18-volume-mount.md`.
- **Realtime AES key length.** `DB_ENC_KEY` must be exactly 16 ASCII characters for AES-128-ECB. Earlier 32-character value caused `:badarg "Bad key size"` crash loop.
- **Postgres port collision.** Mapped host port 5433 → container 5432 to avoid conflict with Homebrew `postgresql@16` on developer machines. Saved 30 minutes of "wrong password" bewilderment. See `docs/memory/learned/postgres-port-conflict.md`.
- **RLS infinite recursion.** Helper functions touching `org_members` from inside RLS policies on `org_members` produced infinite recursion. Fix: helpers marked `SECURITY DEFINER` with explicit `search_path`. See `docs/memory/learned/rls-recursion-fix.md`.
- **`auth.uid()` cast.** Initially returned `text` but declared `uuid`; cast added inside the function body.

### Decisions captured
- ADR-0001: Postgres as system of record.
- ADR-0002: Run Supabase Realtime standalone — every other Supabase piece is hand-rolled.
- ADR-0003: RLS with the JWT-via-GUC pattern (mirrors Supabase's `auth.uid()` mechanism, but in our control).
- ADR-0004: Multi-agent orchestration model for ongoing work (this POC + Phase 1).

---

[Unreleased]: https://example.com/relowa-poc
[0.1.0]: https://example.com/relowa-poc/0.1.0
