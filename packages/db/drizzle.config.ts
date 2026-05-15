import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://relowa:dev_password_change_me@localhost:5433/relowa",
  },
  verbose: true,
  strict: true,
});
