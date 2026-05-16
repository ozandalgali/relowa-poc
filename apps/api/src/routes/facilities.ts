import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "../client";
import * as schema from "@relowa/db/schema";
import type { JwtClaims } from "../middleware/auth";

export const facilityRoutes = new Hono();

// ─── GET /facilities — list own org facilities ─────────────────────

facilityRoutes.get("/", async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  const results = await db
    .select()
    .from(schema.facilities)
    .where(eq(schema.facilities.orgId, claims.active_org_id));
  return c.json(results);
});

// ─── POST /facilities — create facility ────────────────────────────

facilityRoutes.post("/", async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  const body = await c.req.json();

  const [facility] = await db
    .insert(schema.facilities)
    .values({
      orgId: claims.active_org_id,
      name: body.name,
      type: body.type ?? "other",
      address: body.address ?? "",
      lat: body.lat ?? null,
      lng: body.lng ?? null,
    })
    .returning();

  if (!facility) throw new HTTPException(500, { message: "Failed to create facility" });
  return c.json(facility, 201);
});
