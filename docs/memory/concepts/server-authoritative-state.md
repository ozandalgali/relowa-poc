# Server-authoritative state transitions

> Why the server, not the client, decides when an auction closes. And why this is non-negotiable for anything touching money.

## The bait

Auctions have countdowns: "04:12:33 remaining." It's tempting to let the client transition the auction to CLOSING when the timer hits zero. The UI already knows the time. Why not?

## The trap

Three reasons, ranked by severity:

### 1. Client clocks lie

Cause | Effect
:-- | :--
NTP drift on the user's device | Auction "closes" 30s early
User adjusted their system clock | Auction "closes" 5 minutes early or never
DevTools manipulation | "Auction closed at 23:59:59 — too late, you lose."

A determined bidder can win every auction by simply telling their browser the auction closed before the rival's high bid arrived.

### 2. Network races

Even with honest clocks, network latency makes it ambiguous which bid arrived "first" if both arrive within a few hundred milliseconds. Client-driven closes can't resolve this — the server can.

### 3. Sniping

Without server-side soft-close, sophisticated bidders submit a winning bid 1 second before the buzzer, leaving competitors no time to respond. Auctions degrade to "who has the fastest connection."

## Our pattern

```
Server stores closes_at timestamp at PUBLISH.
Client renders countdown by subtracting now() from closes_at.
EventBridge Scheduler (or pg_cron) runs every 30 seconds:
  UPDATE tenders
  SET status = 'closing'
  WHERE status = 'published' AND closes_at < now()
```

The client never sends "close this auction" requests. There is no such endpoint.

## Soft-close (anti-sniping)

When a bid arrives within 60s of `closes_at`:

```sql
UPDATE tenders
SET closes_at = greatest(closes_at, now() + interval '60 seconds')
WHERE id = $1 AND status = 'published';
```

The auction extends by 60s every time a late bid lands. Equivalent to "the gavel doesn't fall while bids are still flying" in a real auction house.

## Where else this applies

Any state transition driven by **time, not user action**, must be server-side:

- Auction expiry → `pg_cron`
- Bid window soft-close → trigger on bid INSERT
- Escrow auto-release after delivery confirmation timeout → `pg_cron`
- Idempotency key TTL → `pg_cron`
- Tender draft auto-discard after 30 days → `pg_cron`

User-action-driven transitions are different — they're API requests, with audit trail. But anything tied to wall-clock time runs server-side, period.

## Why we use both `pg_cron` and `EventBridge Scheduler`

- **`pg_cron`** for transitions that are pure DB work (UPDATE rows, no external API call). Auction expiry, idempotency cleanup, materialized view refresh.
- **`EventBridge Scheduler`** for transitions that need cross-service coordination. Scheduled emails, scheduled webhook retries, scheduled S3 uploads.

The line: if the work is pure SQL, `pg_cron`. If it crosses a service boundary, EventBridge.

## See also

- [[idempotency]] — why even server-driven transitions must be idempotent
- [[../../adr/0002-supabase-realtime-standalone]] — how clients learn about state changes after they happen
