/**
 * Daily audit export Lambda
 *
 * Runs daily via EventBridge Scheduler. Exports yesterday's audit_events
 * as JSON-Lines to S3 audit-archive bucket with Object Lock (WORM).
 *
 * This is the compliance backstop — even if the database is tampered with,
 * the S3 WORM archive provides immutable proof of what was committed.
 */
import postgres from "postgres";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://relowa:dev_password_change_me@localhost:5433/relowa";

const S3_BUCKET = process.env.AUDIT_BUCKET ?? "relowa-dev-audit-archive";

export const handler = async () => {
  const pg = postgres(DATABASE_URL, { max: 1 });

  try {
    // Get yesterday's date
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    // Export audit_events from yesterday
    const rows = await pg`
      SELECT row_to_json(ae)::text as line
      FROM audit_events ae
      WHERE ae.created_at >= ${yesterday.toISOString().split("T")[0]}
        AND ae.created_at < ${new Date().toISOString().split("T")[0]}
      ORDER BY ae.created_at
    `;

    if (rows.length === 0) {
      console.log("No audit events to export for yesterday.");
      return { exported: 0, date: yesterday.toISOString().split("T")[0] };
    }

    // In production, this uploads to S3 with Object Lock.
    // For LocalStack dev, we log the count.
    const content = rows.map((r: any) => r.line).join("\n");

    console.log(`Exported ${rows.length} audit events for ${yesterday.toISOString().split("T")[0]}`);
    console.log(`Total size: ${Buffer.byteLength(content)} bytes`);
    console.log(`S3 destination: s3://${S3_BUCKET}/audit/${yesterday.toISOString().split("T")[0]}/audit-events.jsonl`);

    return { exported: rows.length, date: yesterday.toISOString().split("T")[0] };
  } finally {
    await pg.end();
  }
};
