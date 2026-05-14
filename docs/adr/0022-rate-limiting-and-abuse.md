# ADR-0022 — Rate Limiting & Abuse Prevention

**Status:** Accepted
**Date:** 2026-05-14
**Decision-makers:** Ozan (lead)

## Context

A B2B platform is less abuse-prone than B2C, but several abuse vectors remain:

- **Auth brute force** — repeated login attempts, OTP guessing.
- **SMS pumping** — fake registration → SMS OTP burns budget.
- **Bid spamming** — bot or script floods bids to manipulate auctions.
- **Tender creation abuse** — fake tenders disrupt the marketplace.
- **Carrier ad abuse** — fake transport requests.
- **Search / scrape** — competitor scraping the marketplace.
- **Webhook abuse** — fake provider webhooks attempting to mark escrow as funded.
- **Resource exhaustion** — large file uploads, unbounded API queries.
- **Compute abuse** — repeated AI scan requests burn provider budget.

Without rate limiting:
- Costs spike unpredictably (SMS, AI, infra).
- Real users get degraded performance during attacks.
- Fraud manipulates auctions.
- Compliance suffers (KVKK requires "appropriate" security measures).

## Decision

We adopt a **layered rate limiting strategy** using **ElastiCache Redis** as the counter store, with **per-endpoint policies**, **per-actor scoping**, and a **graceful degradation path** when limits are hit.

### 1. The rate-limit middleware

Hono middleware applied per-route group with declarative policy:

```ts
// apps/api/src/middleware/rate-limit.ts
export function rateLimit(policy: {
  key: (c: Context) => string;          // identity key: IP, user_id, org_id
  limit: number;                         // max requests
  window: number;                        // seconds
  errorMessage?: string;
}): MiddlewareHandler;

// Usage:
app.post('/tenders/:id/bids',
  rateLimit({
    key: (c) => `bid:${c.get('userId')}:${c.req.param('id')}`,
    limit: 10,
    window: 60,
  }),
  ...
);
```

Algorithm: **sliding window** via Redis `INCR` + `EXPIRE`. Simple, fast, accurate enough for our scale.

### 2. Rate limit policies — by endpoint category

| Category | Endpoints | Key | Limit | Window |
|---|---|---|---|---|
| **Auth** | `POST /auth/login` | IP + email | 5 | 5 min |
| | `POST /auth/login` | IP only | 20 | 5 min |
| | `POST /auth/otp/request` | phone | 3 | 1 hour |
| | `POST /auth/otp/verify` | phone | 5 | 15 min |
| | `POST /auth/password-reset` | email | 3 | 1 hour |
| **Registration** | `POST /auth/register` | IP | 10 | 1 hour |
| | `POST /auth/register` | global | 1000 | 1 day |
| **Bidding** | `POST /tenders/:id/bids` | user + tender | 10 | 1 min |
| | `POST /tenders/:id/bids` | org | 100 | 1 hour |
| **Tender ops** | `POST /tenders` | user | 20 | 1 hour |
| | `POST /tenders` | org | 200 | 1 day |
| | `PATCH /tenders/:id/publish` | org | 50 | 1 day |
| **Carrier** | `POST /carrier-ads/:id/bids` | user | 20 | 5 min |
| | `POST /carrier-ads` | org | 100 | 1 day |
| **File** | `POST /uploads/request` | user | 30 | 1 hour |
| | `POST /uploads/request` | org | 500 | 1 day |
| **Search** | `GET /marketplace`, `GET /tenders` | IP | 100 | 1 min |
| | Same | user | 500 | 1 min |
| **AI scan** | `POST /tenders/:id/scan` | org | 50 | 1 day |
| **Notifications** | `POST /preferences` | user | 20 | 1 hour |
| **Webhooks** | `POST /webhooks/iyzico` | source IP | varies (allowlist) | n/a |
| **General API** | All authenticated `POST/PATCH/DELETE` | user | 600 | 1 min |
| | Same | org | 6000 | 1 min |
| **Anonymous** | All anonymous endpoints | IP | 60 | 1 min |

Notes:
- The **per-IP** and **per-user/org** limits stack — both must pass.
- The global IP limit defends against distributed brute force.
- SMS-related limits (OTP) are aggressive because each SMS costs money.

### 3. Storage — ElastiCache Redis

Already provisioned in M0 (per milestones doc). Two named databases:

- `db=0` — rate limit counters (TTL-based; ephemeral)
- `db=1` — application cache (sessions, hot reads — separate scope)

Counter keys use the format `rl:<category>:<key>:<window_id>` where `window_id = floor(unix_time / window_seconds)`.

Example:
```
rl:auth.login:10.0.0.1+ahmet@acme.com:172800123
```

`INCR` on each call; reject if value > limit.

**Redis fallback:** if Redis is unreachable, rate limiting **fails open** (request allowed) and an alarm fires (ADR-0020). We prefer allowing legitimate traffic to denying all traffic when Redis hiccups.

### 4. Limit response shape

When a limit is hit:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 47
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1730476850
Content-Type: application/json

{
  "error": "rate_limited",
  "message": "Too many requests. Please try again in 47 seconds.",
  "retry_after_seconds": 47
}
```

The frontend converts this into a friendly Turkish message via `messages/tr/errors.json`:

```
"rate_limited": "Çok hızlı işlem yaptınız. {seconds} saniye sonra tekrar deneyin."
```

### 5. CAPTCHA / progressive challenge

When auth or registration rate-limit is hit, **escalate** to a CAPTCHA challenge before allowing further attempts:

- 3 failed logins → soft challenge (hCaptcha or Cloudflare Turnstile).
- 5 failed logins → CAPTCHA required AND account-level lockout for 30 minutes.
- 10 failed logins → email notification to account holder + IP added to suspicious-IP table.

Suspicious IPs table:

```sql
CREATE TABLE suspicious_ips (
  ip               INET PRIMARY KEY,
  reason           TEXT NOT NULL,           -- 'brute_force' | 'sms_pumping' | 'manual'
  attempts         INTEGER NOT NULL DEFAULT 0,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  blocked_until    TIMESTAMPTZ,             -- null = soft challenge; not null = blocked
  notes            TEXT
);
```

`super_admin` can review/clear via admin tool.

### 6. WAF — AWS WAF on ALB

In front of the ALB:
- **AWS Managed Rules — Common Rule Set:** SQL injection, XSS, command injection.
- **AWS Managed Rules — Known Bad Inputs:** Log4Shell, etc.
- **Rate-based rule:** 2000 requests per 5 min per IP at the WAF layer (catches floods before they reach API).
- **Geographic restrictions:** Allow EU + TR + opt-in EN-speaking; block obvious bad-actor geographies (configurable). Phase 2.
- **Bot Control:** Phase 2 if bot scraping becomes real problem.

WAF is the **outer gate**; in-app rate limiting is the **inner gate** with context (user/org awareness).

### 7. Webhook abuse prevention

Provider webhooks (Iyzico, Nilvera, Greyparrot) are common attack surfaces:

- **IP allowlist** at WAF for known provider IP ranges.
- **HMAC signature verification** in adapter (PRD-0006). Failed verification = 401 + WAF rule auto-bans IP after 3 in 5 min.
- **Idempotency at DB level** — `provider_webhooks` unique constraint on `(provider, provider_event_id)` ensures replays don't duplicate state.
- **Audit log** of every webhook attempt (signature_valid column).

### 8. Bid manipulation defense

Specific to auction integrity:

- **Minimum bid increment** — server-side enforcement; bids less than (current_highest * 1.001) rejected.
- **Bid retraction limit** — bidders cannot retract within last 60s of close (would manipulate soft-close anti-sniping).
- **Bid frequency per tender** — max 10 bids per user per minute per tender.
- **Tender frequency per producer** — max 20 tenders per day per org (prevents marketplace flooding).
- **Reputation gating** — new orgs (verified < 30 days) have lower limits. Phase 2.

These are documented in `apps/api/src/routes/bids.ts` rate-limit policies.

### 9. AI scan abuse

Greyparrot API has cost-per-call. Limit:

- 5 scans per tender (re-upload only if previous failed).
- 50 scans per org per day.
- 1000 scans platform-wide per day (kill-switch via env var if budget overrun).

Manual provider (dev) has no real cost; limits apply but never fire.

### 10. KVKK considerations

- Rate-limit denials are logged with IP + actor_id; **no PII in logs**.
- Suspicious IPs table includes IP; KVKK-compliant data retention (90 days).
- `super_admin` can pardon/block IPs; every action audit-logged.
- The platform must not block legitimate use due to misconfigured limits — false positives audited weekly.

### 11. Operational metrics

CloudWatch dashboard tile in `relowa-infra` (ADR-0020):

- Rate-limit hits per category per hour
- 429 response rate vs total traffic
- Top 10 suspicious IPs
- Webhook signature failures by provider
- AI scan budget consumed today

Alarms:
- 429 rate > 5% of total → P2 (might be misconfigured limit)
- Single IP > 1000 requests/min → P1 (DDoS suspect)
- AI scan budget > 80% of daily limit → P3
- Webhook signature failure spike → P1 (impersonation attempt)

### 12. Frontend behavior

The frontend exposes user-friendly handling:

- **429 on read:** silent retry once after `retry_after_seconds`. If still 429, show toast.
- **429 on mutation:** immediate toast in Turkish, "X saniye sonra tekrar deneyin." Button disabled with countdown.
- **CAPTCHA required:** modal with the challenge widget; can't proceed until solved.
- **Account locked:** explicit page with "Hesabınız geçici olarak kilitlendi" + recovery flow.

## Consequences

### Positive

- **Predictable cost ceilings** — SMS, AI, infra abuse all bounded.
- **Auction integrity** — bid manipulation defenses prevent the auction-house-classic abuse.
- **Layered defense** — WAF (outer) + Redis (inner) + DB (idempotency) means even if one layer fails, others catch.
- **Fail-open on Redis** — degraded but available beats unavailable.
- **CAPTCHA is escalated, not default** — humans don't get hassled for routine use.
- **KVKK-friendly logging** — no PII in rate-limit metrics.

### Negative

- **Redis dependency** for rate limits. Mitigated by fail-open + alarm.
- **WAF cost** ~$10/mo + per-request fees. Acceptable.
- **CAPTCHA UX hit on legitimate users hitting limits** — mitigated by careful limit tuning.
- **AI budget kill switch could degrade UX** — better than budget overrun.

## Future plans

- **Adaptive rate limits** — increase limits for verified-long-term orgs, decrease for new/suspicious. Phase 2.
- **Bot Control via AWS WAF** when scraping pattern observed. Phase 2.
- **Honeytraps** — fake "premium tender" links that no legitimate user clicks; clicks flagged. Phase 3.
- **Behavioral biometrics** — detect bot vs human via mouse/keyboard rhythm. Phase 3 if needed.
- **Distributed coordinated attacks defense** — coordinated multi-IP attack pattern detection. Phase 3 via security service.
- **Per-tenant rate-limit customization** — enterprise customers negotiate higher limits in contract. Phase 2.
- **Geographic risk scoring** — Phase 2.
- **Auto-block on Suspicious IP escalation** — currently soft challenge; Phase 2 auto-blocks after threshold.

## Alternatives considered

| Option | Rejected because |
|---|---|
| In-memory rate limiting (no Redis) | Doesn't survive Fargate task replacement; ECS scales horizontally. |
| Database-based rate limiting | Too slow for hot-path checks; CPU/disk cost compounds. |
| Cloudflare in front | Adds third-party in front of all traffic; KVKK paperwork + EU residency questions. |
| API Gateway throttling instead of app-layer | Loses context (user/org awareness); doesn't escalate to CAPTCHA. |
| Token bucket (vs sliding window) | Sliding window simpler with Redis; token bucket precision not needed at our scale. |
| Per-tier limits in contract | Adds complexity. We start uniform; Phase 2 customizes. |
| External rate-limit SaaS | Vendor lock-in; AWS WAF + Redis is enough. |

## Reference

- ADR-0006 — Outbox (event volume affects implicit rate limits)
- ADR-0017 — Test strategy (rate limit hits tested in api-integration)
- ADR-0018 — Notifications (SMS abuse defended here)
- ADR-0019 — File storage (upload rate limits)
- ADR-0020 — Observability (rate-limit metrics dashboard)
- ADR-0023 — Secrets management (suspicious IP list access via admin)
- PRD-0009 — Onboarding (registration rate limits)
- AWS WAF: https://docs.aws.amazon.com/waf/
- Redis sliding window: https://redis.io/learn/howtos/solutions/rate-limiting/
