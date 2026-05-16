import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "../client";
import * as schema from "@relowa/db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { cacheIdempotentResponse } from "../middleware/idempotency";
import { publishEvent } from "../events";
import type { JwtClaims } from "../middleware/auth";
import { gucClaims } from "../middleware/auth";

export const bidRoutes = new Hono();

// ─── Schema ────────────────────────────────────────────────────────

const createBidSchema = z.object({
  pricePerTon: z.number().positive().max(1000000),
  includesShipping: z.boolean().default(false),
  notes: z.string().max(2000).optional(),
});

// ─── Helper ─────────────────────────────────────────────────────────

function runInGucTx<T>(claims: JwtClaims, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('request.jwt.claims', ${gucClaims(claims)}, true)`,
    );
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    return fn(tx);
  });
}

// ─── POST /tenders/:id/bids ────────────────────────────────────────

bidRoutes.post("/:id/bids", zValidator("json", createBidSchema), async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  const tenderId = c.req.param("id");
  const body = c.req.valid("json");
  const idempotencyKey = c.get("idempotencyKey") as string;

  const bid = await runInGucTx(claims, async (tx) => {
    // Verify tender exists and is published
    const [tender] = await tx
      .select({ id: schema.tenders.id, status: schema.tenders.status })
      .from(schema.tenders)
      .where(eq(schema.tenders.id, tenderId));

    if (!tender) throw new HTTPException(404, { message: "Tender not found" });
    if (tender.status !== "published") {
      throw new HTTPException(400, { message: "Tender is not accepting bids" });
    }

    const [result] = await tx
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

    if (!result) throw new HTTPException(500, { message: "Failed to place bid" });

    // Outbox: publish bid.placed event
    await tx.insert(schema.outbox).values({
      aggregateType: "bid",
      aggregateId: result.id,
      eventType: "bid.placed",
      orgId: claims.active_org_id,
      payload: result as unknown as Record<string, unknown>,
    });

    return result;
  });

  await cacheIdempotentResponse(idempotencyKey, claims.active_org_id, 201, bid);

  // Fire-and-forget EventBridge publish
  publishEvent({
    detailType: "bid.placed",
    detail: { id: bid.id, tenderId: bid.tenderId, bidderOrgId: bid.bidderOrgId },
  });

  return c.json(bid, 201);
});

// ─── GET /tenders/:id/bids ─────────────────────────────────────────

bidRoutes.get("/:id/bids", async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  const tenderId = c.req.param("id");

  const results = await runInGucTx(claims, (tx) =>
    tx
      .select()
      .from(schema.bids)
      .where(eq(schema.bids.tenderId, tenderId))
      .orderBy(sql`${schema.bids.createdAt} DESC`),
  );

  return c.json(results);
});
