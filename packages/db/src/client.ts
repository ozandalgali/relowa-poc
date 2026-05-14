import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, "../../../.env") });
loadEnv();

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://relowa:dev_password_change_me@localhost:5432/relowa";

const queryClient = postgres(connectionString, {
  max: 10,
  prepare: false,
});

export const db = drizzle(queryClient, { schema });
export const sqlClient = queryClient;
export type Db = typeof db;
