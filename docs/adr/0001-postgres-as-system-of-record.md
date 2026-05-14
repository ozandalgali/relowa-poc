# ADR-0001 — Postgres as System of Record

**Status:** Accepted
**Date:** 2026-05-09
**Decision-makers:** Ozan (lead), Güneş (product) — pending discussion

## Context

Relowa is a B2B platform with relational, transactional data: organizations, users, tenders, bids, escrow holdings, audit trails. The data has strong invariants (RLS isolation, audit immutability, idempotency) and moderate-to-high consistency requirements (escrow correctness).

We need a System of Record (SoR) that:
- Enforces relational integrity
- Supports row-level security
- Has battle-tested replication and backup
- Has a healthy ecosystem of operational tooling
- Is portable across managed providers (RDS, Supabase Cloud, on-prem, Aurora)

## Decision

**PostgreSQL is the system of record.** All authoritative state lives in Postgres. Everything else (S3 archives, EventBridge event log, PostHog analytics, materialized views) is **derived data** — rebuildable from Postgres if necessary.

In production this is RDS PostgreSQL Multi-AZ in `eu-central-1` (Frankfurt). Locally it's Postgres 18-alpine in Docker.

## Consequences

### Positive
- One source of truth, no consistency reconciliation across stores.
- RLS handles authorization in the database layer — application bugs cannot escape.
- Postgres extensions cover most "we need a separate tool" temptations: TimescaleDB for time-series, PostGIS for geo, pg_cron for scheduling, pgvector for embeddings, pg_trgm for fuzzy search.
- Standard backup/PITR semantics on RDS.
- Portable — we can swap RDS for Aurora, Supabase Cloud, or self-host without code change.

### Negative
- Single-leader writes is a future scaling ceiling. Acceptable through Phase 3 at projected scale.
- Operating Postgres yourself (if self-hosted) is non-trivial. Mitigated by RDS Multi-AZ.
- Drizzle is not the only ORM that works with RLS, but it's our chosen one — see ADR-0003.

## Alternatives considered

- **DynamoDB**: rejected. Multi-tenant RLS is not a thing; B2B authorization patterns become custom application logic.
- **MongoDB**: rejected. No equivalent of RLS, weaker transactional guarantees.
- **Supabase Cloud Postgres only**: viable for Phase 1, but management is offsite and the data plane is shared. May still be selected for Phase 1 — see ADR-0002.

## Reference

DDIA Ch. 12 — "Deriving data": single source of truth, deriveable everything else.
