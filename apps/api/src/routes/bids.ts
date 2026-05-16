import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "../client";
import * as schema from "@relowa/db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { cacheIdempotentResponse } from "../middleware/idempotency";
import type { JwtClaims } from "../middleware/auth";

export const bidRoutes = new Hono();

async function setGuc(claims: JwtClaims) {
  await db.execute(
    sql`SELECT set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`,
  );
  await db.execute(sql`SET LOCAL ROLE app_user`);
}

// ─── Schema ────────────────────────────────────────────────────────

const createBidSchema = z.object({
  pricePerTon: z.number().positive().max(1000000),
  includesShipping: z.boolean().default(false),
  notes: z.string().max(2000).optional(),
});

// ─── POST /tenders/:id/bids ────────────────────────────────────────

bidRoutes.post("/:id/bids", zValidator("json", createBidSchema), async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  await setGuc(claims);

  const tenderId = c.req.param("id");
  const body = c.req.valid("json");
  const idempotencyKey = c.get("idempotencyKey") as string;

  // Verify tender exists and is published
  const [tender] = await db
    .select({ id: schema.tenders.id, status: schema.tenders.status })
    .from(schema.tenders)
    .where(eq(schema.tenders.id, tenderId));

  if (!tender) throw new HTTPException(404, { message: "Tender not found" });
  if (tender.status !== "published") {
    throw new HTTPException(400, { message: "Tender is not accepting bids" });
  }

  const [bid] = await db
    .insert(schema.bids)
    .values({
      tenderId,
      bidderOrgId: claims.active_org_id,
      bidderUserId: claims.sub,
      pricePerTon: String(body.pricePerTon),
      includesShipping: body.includesShipping,
      notes: body.notes ?? null,
    })
    .returning();

  if (!bid) throw new HTTPException(500, { message: "Failed to place bid" });

  await cacheIdempotentResponse(idempotencyKey, claims.active_org_id, 201, bid);
  return c.json(bid, 201);
});

// ─── GET /tenders/:id/bids ─────────────────────────────────────────

bidRoutes.get("/:id/bids", async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  await setGuc(claims);

  const tenderId = c.req.param("id");

  const results = await db
    .select()
    .from(schema.bids)
    .where(eq(schema.bids.tenderId, tenderId))
    .orderBy(sql`${schema.bids.createdAt} DESC`);

  return c.json(results);
});
