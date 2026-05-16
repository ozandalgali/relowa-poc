import { beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const sql = postgres("postgres://relowa:dev_password_change_me@localhost:5433/relowa", {
  max: 1,
});

beforeAll(async () => {
  // Clear test data: idempotency keys and provider webhooks
  await sql`DELETE FROM idempotency_keys`;
  await sql`DELETE FROM provider_webhooks`;
  await sql`DELETE FROM outbox`;
}, 15000);

afterAll(async () => {
  await sql.end();
});
