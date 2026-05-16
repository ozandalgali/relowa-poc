import { beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const sql = postgres("postgres://relowa:dev_password_change_me@localhost:5433/relowa", {
  max: 1,
});

beforeAll(async () => {
  // Only clear idempotency keys between runs. Seed data stays intact.
  await sql`DELETE FROM idempotency_keys`;
}, 15000);

afterAll(async () => {
  await sql.end();
});
