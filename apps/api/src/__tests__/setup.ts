import { beforeAll } from "vitest";
import postgres from "postgres";

const sql = postgres("postgres://relowa:dev_password_change_me@localhost:5433/relowa", {
  max: 1,
});

beforeAll(async () => {
  // Clean up test-created data, keep seed data
  await sql`DELETE FROM bids`;
  await sql`DELETE FROM idempotency_keys`;
  await sql`DELETE FROM tenders WHERE notes IS NULL OR notes NOT LIKE '%seed%'`;
  await sql`DELETE FROM audit_events`;
}, 30000);

afterAll(async () => {
  await sql.end();
});
