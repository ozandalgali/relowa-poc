import { Hono } from "hono";
import { db } from "../client";
import * as schema from "@relowa/db/schema";
import { eq } from "drizzle-orm";
import type { JwtClaims } from "../middleware/auth";

export const subscriptionRoutes = new Hono();

// GET /subscriptions — list active subscription for org
subscriptionRoutes.get("/", async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  const results = await db
    .select()
    .from(schema.orgSubscriptions)
    .where(eq(schema.orgSubscriptions.orgId, claims.active_org_id));
  return c.json(results);
});

// GET /subscriptions/tiers — list available tiers
subscriptionRoutes.get("/tiers", async (_c) => {
  const tiers = await db
    .select()
    .from(schema.subscriptionTiers)
    .where(eq(schema.subscriptionTiers.isActive, true));
  return _c.json(tiers);
});
