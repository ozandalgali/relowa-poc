import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "../client";
import * as schema from "@relowa/db/schema";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { cacheIdempotentResponse } from "../middleware/idempotency";
import { publishEvent } from "../events";
import type { JwtClaims } from "../middleware/auth";
import { gucClaims } from "../middleware/auth";

export const tenderRoutes = new Hono();

// ─── Schemas ───────────────────────────────────────────────────────

const createTenderSchema = z.object({
  materialType: z.enum([
    "metal_scrap",
    "plastic",
    "paper",
    "electronic",
    "chemical",
    "other",
  ]),
  quantityTons: z.number().positive().max(10000),
  pickupRegion: z.string().min(1).max(200),
  pickupAddress: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

const publishTenderSchema = z.object({
  closesAt: z.string().datetime({ message: "closesAt must be ISO 8601" }),
});

// ─── Helpers ────────────────────────────────────────────────────────

function runInGucTx<T>(claims: JwtClaims, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('request.jwt.claims', ${gucClaims(claims)}, true)`,
    );
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    return fn(tx);
  });
}

// ─── POST /tenders ─────────────────────────────────────────────────

tenderRoutes.post("/", zValidator("json", createTenderSchema), async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  const body = c.req.valid("json");
  const idempotencyKey = c.get("idempotencyKey") as string;

  const tender = await runInGucTx(claims, async (tx) => {
    const [result] = await tx
      .insert(schema.tenders)
      .values({
        orgId: claims.active_org_id,
        createdByUserId: claims.sub,
        materialType: body.materialType,
        quantityTons: String(body.quantityTons),
        pickupRegion: body.pickupRegion,
        pickupAddress: body.pickupAddress ?? null,
        notes: body.notes ?? null,
        status: "draft",
      })
      .returning();

    if (!result) throw new HTTPException(500, { message: "Failed to create tender" });

    // Outbox: publish event inside same transaction
    await tx.insert(schema.outbox).values({
      aggregateType: "tender",
      aggregateId: result.id,
      eventType: "tender.created",
      orgId: claims.active_org_id,
      payload: result as unknown as Record<string, unknown>,
    });

    return result;
  });

  await cacheIdempotentResponse(idempotencyKey, claims.active_org_id, 201, tender);

  // Fire-and-forget EventBridge publish
  publishEvent({
    detailType: "tender.created",
    detail: { id: tender.id, orgId: tender.orgId },
  });

  return c.json(tender, 201);
});

// ─── GET /tenders ──────────────────────────────────────────────────

tenderRoutes.get("/", async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;

  const results = await runInGucTx(claims, (tx) =>
    tx.select().from(schema.tenders).orderBy(sql`${schema.tenders.createdAt} DESC`),
  );

  return c.json(results);
});

// ─── GET /tenders/:id ──────────────────────────────────────────────

tenderRoutes.get("/:id", async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  const id = c.req.param("id");

  const results = await runInGucTx(claims, (tx) =>
    tx.select().from(schema.tenders).where(eq(schema.tenders.id, id)),
  );

  const tender = results[0];
  if (!tender) throw new HTTPException(404, { message: "Tender not found" });
  return c.json(tender);
});

// ─── PATCH /tenders/:id/publish ────────────────────────────────────

tenderRoutes.patch("/:id/publish", zValidator("json", publishTenderSchema), async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const idempotencyKey = c.get("idempotencyKey") as string;

  const tender = await runInGucTx(claims, async (tx) => {
    const [result] = await tx
      .update(schema.tenders)
      .set({
        status: "published",
        publishedAt: new Date(),
        closesAt: new Date(body.closesAt),
      })
      .where(eq(schema.tenders.id, id))
      .returning();

    if (!result) throw new HTTPException(404, { message: "Tender not found" });

    // Outbox: publish tender.published event
    await tx.insert(schema.outbox).values({
      aggregateType: "tender",
      aggregateId: result.id,
      eventType: "tender.published",
      orgId: claims.active_org_id,
      payload: result as unknown as Record<string, unknown>,
    });

    return result;
  });

  await cacheIdempotentResponse(idempotencyKey, claims.active_org_id, 200, tender);

  // Fire-and-forget EventBridge publish
  publishEvent({
    detailType: "tender.published",
    detail: { id: tender.id, orgId: tender.orgId },
  });

  return c.json(tender);
});
