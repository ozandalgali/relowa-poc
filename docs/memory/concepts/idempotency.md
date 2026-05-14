# Idempotency

> Why every mutation endpoint accepts an `Idempotency-Key`, and what happens if one doesn't.

## The setup

Distributed systems have two facts that conflict:

1. Networks are unreliable. Clients retry.
2. Mutation endpoints have side effects. Re-running them double-charges, double-emails, double-sends.

The naïve approach — "we'll be careful with retries" — fails. A user clicks Submit, their phone signal drops, the request did succeed but the response never arrived, the app helpfully resubmits, and now there are two tenders.

## The pattern

Every mutation endpoint accepts a header:

```
Idempotency-Key: <client-generated UUID>
```

Server logic:

```
on receive:
  look up (org_id, key) in idempotency_keys
  if found and request matches: return cached response
  if found and request differs: return 409 Conflict
  otherwise: execute, cache response, return it
```

The `idempotency_keys` table:

```sql
key            text
org_id         uuid
request_hash   text     -- hash of the request body, to detect "same key, different payload"
status_code    int
response_body  jsonb
created_at     timestamptz
expires_at     timestamptz   -- 24 hours typically
```

PRIMARY KEY: `(key, org_id)`.

## Why scoped to org

Two reasons:

1. Keys are user-generated → collisions across tenants are likely (UUIDs notwithstanding, devs sometimes use sequential or predictable keys in development).
2. Cross-tenant idempotency cache leaks would itself be a privacy bug.

## Where this matters most

Phase 1: tender creation, bid placement.
Phase 2: **escrow funding webhooks**. This is where idempotency goes from "good practice" to "non-negotiable." Iyzico's webhook can fire the same payment notification multiple times (network retries, intentional redelivery on no-ACK). Without idempotency, you mark the auction funded twice, possibly release escrow twice. Disaster.

We build the discipline now so it's reflexive when escrow lands.

## Implementation contract

Hono middleware will look approximately like this:

```typescript
export const idempotency = createMiddleware(async (c, next) => {
  const key = c.req.header('Idempotency-Key');
  const orgId = c.get('orgId');
  if (!key || !orgId) {
    await next();
    return;
  }

  const requestHash = sha256(await c.req.raw.clone().text());
  const cached = await db.query.idempotencyKeys.findFirst({
    where: and(eq(table.key, key), eq(table.orgId, orgId)),
  });

  if (cached) {
    if (cached.requestHash !== requestHash) {
      return c.json({ error: 'idempotency_key_reuse_with_different_body' }, 409);
    }
    return c.json(cached.responseBody, cached.statusCode);
  }

  await next();
  // Capture response and write to idempotency_keys here
});
```

## Anti-patterns

- ❌ Implementing this only for some endpoints. Pattern is uniform or it's nothing.
- ❌ Hashing the response body, not the request body — defeats the conflict detection.
- ❌ Storing the response forever — pollutes the table. 24 hours is enough for legitimate retries.
- ❌ Using sequential or timestamp-based keys client-side. UUIDs only.

## See also

- [[server-authoritative-state]] — the other side of "don't trust the network"
- [[audit-hash-chain]] — why duplicates would also poison the audit log
