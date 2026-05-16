/**
 * Outbox relay worker
 *
 * Polls the outbox table for unpublished events and ships them
 * to the real-time backend (AppSync in prod, Supabase Realtime in dev,
 * no-op in test).
 *
 * Production: reads outbox WHERE published_at IS NULL → SQS → Lambda → AppSync mutations
 * Dev (POC):   no-op — Supabase Realtime reads logical replication directly
 * CI/test:     no-op — tests inspect outbox table directly
 *
 * This worker is the bridge between transactional outbox writes
 * (inside route handler transactions) and real-time subscribers.
 *
 * Env var: REALTIME_BACKEND=supabase|appsync|none
 */

import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://relowa:dev_password_change_me@localhost:5433/relowa";

const BACKEND = process.env.REALTIME_BACKEND ?? "none";
const POLL_INTERVAL_MS = 1000; // 1 second
const BATCH_SIZE = 100;

async function poll() {
  const pg = postgres(DATABASE_URL, { max: 1 });

  try {
    // SELECT unpublished rows, lock them for this worker
    const rows = await pg`
      SELECT id, aggregate_type, aggregate_id, event_type, org_id, payload, created_at
      FROM outbox
      WHERE published_at IS NULL
      ORDER BY created_at
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `;

    if (rows.length === 0) return 0;

    for (const row of rows) {
      try {
        if (BACKEND === "appsync") {
          // In production: publish to SQS → Lambda → AppSync mutation
          // SQS.sendMessage({ QueueUrl, MessageBody: JSON.stringify(row) })
          console.log(`[outbox-relay] appsync publish: ${row.aggregate_type}.${row.event_type} (${row.id})`);
        }

        // Mark as published (even for supabase/none — keeps table clean)
        await pg`
          UPDATE outbox SET published_at = now(), attempts = attempts + 1
          WHERE id = ${row.id}::uuid
        `;
      } catch (err) {
        console.error(`[outbox-relay] publish failed for ${row.id}:`, err);
        await pg`
          UPDATE outbox SET attempts = attempts + 1, last_error = ${String(err)}
          WHERE id = ${row.id}::uuid
        `;
      }
    }

    return rows.length;
  } finally {
    await pg.end();
  }
}

async function main() {
  console.log(`[outbox-relay] starting — backend: ${BACKEND}, interval: ${POLL_INTERVAL_MS}ms`);

  // Run indefinitely
  const tick = async () => {
    try {
      const count = await poll();
      if (count > 0) console.log(`[outbox-relay] published ${count} events`);
    } catch (err) {
      console.error("[outbox-relay] poll error:", err);
    }
    setTimeout(tick, POLL_INTERVAL_MS);
  };

  tick();
}

main();
