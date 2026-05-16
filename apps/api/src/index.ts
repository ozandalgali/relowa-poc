import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { jwtMiddleware } from "./middleware/auth";
import { idempotencyMiddleware } from "./middleware/idempotency";
import { tenderRoutes } from "./routes/tenders";
import { bidRoutes } from "./routes/bids";

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

// Health check — no auth required
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// JWT + GUC middleware — sets request.jwt.claims and ROLE app_user
app.use("/tenders/*", jwtMiddleware);

// Idempotency — on all mutation endpoints
app.use("/tenders", idempotencyMiddleware("POST"));
app.use("/tenders/:id/publish", idempotencyMiddleware("PATCH"));
app.use("/tenders/:id/bids", idempotencyMiddleware("POST"));

// Routes
app.route("/tenders", tenderRoutes);
app.route("/tenders", bidRoutes);

export { app };

const port = Number(process.env.PORT) || 3000;

// Only start server when not being imported (e.g., by tests)
const isTestEnv = process.env.VITEST || process.env.NODE_ENV === "test";
if (!isTestEnv) {
  console.log(`Relowa API listening on http://localhost:${port}`);
  serve({ fetch: app.fetch, port });
}
