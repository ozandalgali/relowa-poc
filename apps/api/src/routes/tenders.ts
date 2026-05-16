import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "../client";
import * as schema from "@relowa/db/schema";
import { eq, and, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { cacheIdempotentResponse } from "../middleware/idempotency";
import type { JwtClaims } from "../middleware/auth";

export const tenderRoutes = new Hono();

/**
 * SET LOCAL GUC for RLS — run before each query in a route handler.
 * The GUC persists for the lifetime of the Postgres.js connection
 * (i.e., the request), so RLS policies see `auth.org_id()`, etc.
 */
async function setGuc(claims: JwtClaims) {
  await db.execute(
    sql`SELECT set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`,
  );
  await db.execute(sql`SET LOCAL ROLE app_user`);
}

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

// ─── POST /tenders ─────────────────────────────────────────────────

tenderRoutes.post("/", zValidator("json", createTenderSchema), async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  await setGuc(claims);

  const body = c.req.valid("json");
  const idempotencyKey = c.get("idempotencyKey") as string;

  const [tender] = await db
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

  if (!tender) throw new HTTPException(500, { message: "Failed to create tender" });

  await cacheIdempotentResponse(idempotencyKey, claims.active_org_id, 201, tender);
  return c.json(tender, 201);
});

// ─── GET /tenders ──────────────────────────────────────────────────

tenderRoutes.get("/", async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  await setGuc(claims);

  const results = await db
    .select()
    .from(schema.tenders)
    .orderBy(sql`${schema.tenders.createdAt} DESC`);

  return c.json(results);
});

// ─── GET /tenders/:id ──────────────────────────────────────────────

tenderRoutes.get("/:id", async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  await setGuc(claims);

  const id = c.req.param("id");
  const [tender] = await db
    .select()
    .from(schema.tenders)
    .where(eq(schema.tenders.id, id));

  if (!tender) throw new HTTPException(404, { message: "Tender not found" });
  return c.json(tender);
});

// ─── PATCH /tenders/:id/publish ────────────────────────────────────

tenderRoutes.patch("/:id/publish", zValidator("json", publishTenderSchema), async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  await setGuc(claims);

  const id = c.req.param("id");
  const body = c.req.valid("json");
  const idempotencyKey = c.get("idempotencyKey") as string;

  const [tender] = await db
    .update(schema.tenders)
    .set({
      status: "published",
      publishedAt: new Date(),
      closesAt: new Date(body.closesAt),
    })
    .where(eq(schema.tenders.id, id))
    .returning();

  if (!tender) throw new HTTPException(404, { message: "Tender not found" });

  await cacheIdempotentResponse(idempotencyKey, claims.active_org_id, 200, tender);
  return c.json(tender);
});
