# Test category — Auction Lifecycle (End-to-end)

**Status:** 📋 P1, to build.
**Owner:** `tester`.
**Runner:** Bash + curl against docker-compose stack.
**Location:** `tests/bidding-flow.sh`.

## Purpose

The canonical demo flow. A single script exercising the full tender auction lifecycle from producer creation through bid placement, soft-close, server-authoritative close, and audit chain verification. The integration test that proves the substrate, API, events, and lifecycle Lambdas all work together.

## Flow exercised

```
1. Bring up docker-compose
2. db:reset + setup-events.sh (LocalStack EventBridge)
3. Log in as Acme admin → JWT
4. POST tender → 201
5. PATCH /tenders/:id/publish → 200, status=published, outbox row
6. Log in as EkoMetal admin → JWT
7. GET /tenders → sees the published tender
8. POST /tenders/:id/bids → 201, outbox row
9. Verify carrier sees nothing (cross-tenant)
10. Wait 30s (scheduler tick), bid arrives in final 60s → closes_at extends
11. Wait full close window + 60s grace
12. tender-close-handler Lambda runs → status=closing → status=won
13. Verify winner_bid_id is set, audit_events chain intact
14. Verify cross-tenant isolation: producer sees own tender + bid; recycler sees own bid + tender; carrier sees nothing
15. Verify hash chain over all audit events
```

## Test shape

```bash
#!/usr/bin/env bash
set -euo pipefail

PASS=0; FAIL=0
ok() { echo "  ✓ $1"; PASS=$((PASS+1)); }
no() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

# 1. Bring stack up (assumes docker compose up -d already done)
pnpm db:reset
./scripts/setup-events.sh

# 2. Log in as Acme admin
ACME_TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ahmet@acme.com"}' | jq -r .token)

# 3. Create tender
TENDER_ID=$(curl -s -X POST http://localhost:3000/tenders \
  -H "Authorization: Bearer $ACME_TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H 'Content-Type: application/json' \
  -d '{"materialType":"plastic","quantityTons":12.5,"pickupRegion":"Kocaeli"}' \
  | jq -r .id)
[ -n "$TENDER_ID" ] && ok "tender created" || no "tender create failed"

# ... 11 more steps ...

# Final audit chain check
./tests/audit-chain.sh
[ $? -eq 0 ] && ok "audit chain intact" || no "audit chain broken"

echo ""
echo "$PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
```

## Timing

The full flow runs in ~3 minutes (mostly waiting for the close window). In CI we override the close window to ~30s via env var.

## Non-negotiables

- ❌ Never assert via "if response contains a string" — parse JSON via `jq`.
- ❌ Never skip the audit chain verification step.
- ❌ Never let the test pass with `FAIL > 0`.
- ✅ Always tag the critical assertions with `@critical` for nightly E2E filtering.

## Failure modes

| Symptom | Likely cause |
|---|---|
| Tender stuck in `published` | tender-close-handler Lambda not registered, or scheduler rule disabled |
| Audit chain broken | trigger missing on new table, or migration rolled back partially |
| Bid succeeds despite cross-tenant | RLS policy missing `WITH CHECK` |
| Outbox row never published | relay not running, or AppSync mock not started |

## See also

- ADR-0009 — Local bidding architecture
- ADR-0006 — Outbox pattern
- `.opencode/skills/endpoint-writer.md`
- `.opencode/skills/event-bridge-wiring.md`
- `tests/audit-chain.sh`
