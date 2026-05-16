import { Hono } from "hono";
import { db } from "../client";
import * as schema from "@relowa/db/schema";
import { eq } from "drizzle-orm";
import type { JwtClaims } from "../middleware/auth";

export const orderRoutes = new Hono();

// ─── GET /orders — list orders for user's org ──────────────────────

orderRoutes.get("/", async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  const results = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.buyerOrgId, claims.active_org_id))
    .orderBy(schema.orders.createdAt, "desc");
  return c.json(results);
});

// ─── GET /orders/:id — order detail ────────────────────────────────

orderRoutes.get("/:id", async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  const id = c.req.param("id");

  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, id));

  if (!order) return c.json({ error: "Not found" }, 404);
  return c.json(order);
});
