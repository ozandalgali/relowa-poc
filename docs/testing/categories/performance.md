# Test category — Performance / Load

**Status:** 📋 P2 (doc + CI scaffold P1; weekly nightly runs in P2).
**Owner:** `tester`.
**Runner:** `k6`.
**Location:** `tests/perf/`.

## Purpose

Verify performance properties under load:

- Bid storm: 100 recyclers bidding on one tender at the close moment.
- Escrow batch: 50 settlements in a 1-minute window.
- Marketplace browse: 200 concurrent recyclers paging through 10k tenders.
- Audit chain insertion: sustained 50 inserts/s.

P1 risk register (#3 in PRD-0002) explicitly calls out scaling under bid storms as the highest perf risk. This category exists to validate that risk has been addressed before pilot.

## P1 scaffolding

`tests/perf/` exists with a README explaining the P2 plan. CI workflow `perf.yml` is committed but commented out.

## P2 test shape

```ts
// tests/perf/bid-storm.k6.ts
import http from 'k6/http';
import { check, sleep } from 'k6';
import { tokenFor, idemKey } from './helpers.ts';

export const options = {
  scenarios: {
    bid_storm: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 500,
      stages: [
        { target: 100, duration: '10s' },   // ramp to 100 req/s
        { target: 500, duration: '30s' },   // peak bid storm
        { target: 100, duration: '10s' },   // wind down
      ],
    },
  },
  thresholds: {
    'http_req_duration{endpoint:bid_create}': ['p(95)<200', 'p(99)<500'],
    'http_req_failed{endpoint:bid_create}': ['rate<0.01'],
  },
};

export default function () {
  const token = tokenFor('recycler');
  const tenderId = __ENV.TENDER_ID;
  const res = http.post(
    `${__ENV.API_BASE}/tenders/${tenderId}/bids`,
    JSON.stringify({ pricePerTon: 1000 + Math.random() * 500 }),
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Idempotency-Key': idemKey(),
        'Content-Type': 'application/json',
      },
      tags: { endpoint: 'bid_create' },
    }
  );
  check(res, { 'status is 201': r => r.status === 201 });
  sleep(0.1);
}
```

## What gets tested (P2)

| Scenario | Tooling | Target |
|---|---|---|
| Bid storm | k6 ramping-arrival-rate | p95 < 200ms, p99 < 500ms, error rate < 1% |
| Marketplace pagination | k6 constant-VUs | p95 page load < 800ms with 10k tenders |
| Audit insertion sustained | k6 constant-arrival-rate, 50/s | No backlog in outbox, no missed events |
| Outbox relay throughput | Custom script | Drain 1000 outbox rows < 60s |
| Step Functions executions | AWS load testing tools | 50 concurrent escrow flows |
| AppSync subscription | k6 with WebSocket support | 1000 concurrent subscribers receive each event |

## Reporting

Each run produces:

- HTML report committed to `tests/perf/reports/<date>/<scenario>.html`.
- Trend chart of p95/p99 across runs.
- Alert if p95 regresses > 20% from baseline.

## What this does NOT cover

- Chaos engineering (Phase 3+).
- Database vacuum impact under sustained writes (db-operator domain).
- Cross-region latency (single-region in Phase 1).

## P1 deferral rationale

- Solo lead capacity: building meaningful load tests is 3–4 sessions of work.
- Pre-production scale: 50–100 producers pilot doesn't generate bid storms; we run k6 only before scaling beyond pilot.
- Most of the perf-critical decisions are encoded in the architecture (Postgres-backed RLS instead of distributed cache; outbox relay batching). The architecture is the perf strategy.

## P2 graduation trigger

- Pilot scale crosses 100 producers, OR
- Real bid concurrency observed in production hits >10 simultaneous bids per tender, OR
- Any p95 regression observed in CloudWatch metrics.

## Non-negotiables (when P2 lights up)

- ❌ Never run k6 against production. Always dev account.
- ❌ Never ignore a p95 regression > 20% without root-cause analysis.
- ✅ Always include a "control" run with previous version's binary for delta comparison.

## See also

- PRD-0002 risk register (#3 bid storm)
- ADR-0009 — bidding architecture (soft-close behavior under load)
- `.opencode/skills/db-operator.md` (perf investigations)
