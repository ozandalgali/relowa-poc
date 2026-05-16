import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@relowa/db/schema";

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://relowa:dev_password_change_me@localhost:5433/relowa";

// Postgres.js with prepared statement caching
const pg = postgres(connectionString, { max: 10 });

export const db = drizzle(pg, { schema });
export { schema };
