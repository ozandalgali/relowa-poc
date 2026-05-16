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
import { ManualProvider } from "../providers/manual";
import { hashIban } from "../utils/iban";
import type { JwtClaims } from "../middleware/auth";
import { gucClaims } from "../middleware/auth";

const provider = new ManualProvider();

export const escrowRoutes = new Hono();

// ─── Helper ─────────────────────────────────────────────────────────

function runInGucTx<T>(claims: JwtClaims, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('request.jwt.claims', ${gucClaims(claims)}, true)`);
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    return fn(tx);
  });
}

// ─── Schema ────────────────────────────────────────────────────────

const createEscrowSchema = z.object({
  tenderId: z.string().uuid(),
  buyerIban: z.string().min(10).max(34).optional(), // hashed at rest, never stored raw
});

// ─── POST /escrow — create escrow order ─────────────────────────────

escrowRoutes.post("/", zValidator("json", createEscrowSchema), async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  const body = c.req.valid("json");
  const idempotencyKey = c.get("idempotencyKey") as string;

  const escrow = await runInGucTx(claims, async (tx) => {
    // Get the tender to find producer (seller) org
    const [tender] = await tx
      .select({ orgId: schema.tenders.orgId, winnerBidId: schema.tenders.winnerBidId })
      .from(schema.tenders)
      .where(eq(schema.tenders.id, body.tenderId));

    if (!tender) throw new HTTPException(404, { message: "Tender not found" });
    if (!tender.winnerBidId) {
      throw new HTTPException(400, { message: "Tender has no winner yet" });
    }

    // Get the winning bid for price
    const [winningBid] = await tx
      .select({ pricePerTon: schema.bids.pricePerTon, bidderOrgId: schema.bids.bidderOrgId })
      .from(schema.bids)
      .where(eq(schema.bids.id, tender.winnerBidId));

    if (!winningBid) throw new HTTPException(404, { message: "Winning bid not found" });

    // Get quantity from tender for total waste amount
    const quantity = await tx
      .select({ qty: schema.tenders.quantityTons })
      .from(schema.tenders)
      .where(eq(schema.tenders.id, body.tenderId))
      .then((r) => Number(r[0]?.qty ?? 0));

    const wasteAmount = quantity * Number(winningBid.pricePerTon);

    // Call provider
    const { providerOrderId } = await provider.createEscrow({
      orderId: body.tenderId,
      buyerOrgId: claims.active_org_id,
      sellerOrgId: tender.orgId,
      wasteAmount,
      currency: "TRY",
      metadata: { tenderId: body.tenderId },
      idempotencyKey,
    });

    // Insert escrow order
    const [result] = await tx
      .insert(schema.escrowOrders)
      .values({
        tenderId: body.tenderId,
        buyerOrgId: claims.active_org_id,
        sellerOrgId: tender.orgId,
        wasteAmount: String(wasteAmount),
        provider: provider.name,
        providerOrderId,
        status: "pending",
      })
      .returning();

    if (!result) throw new HTTPException(500, { message: "Failed to create escrow" });

    // Insert escrow transaction record
    await tx.insert(schema.escrowTransactions).values({
      escrowOrderId: result.id,
      txType: "fund",
      amount: String(wasteAmount),
      status: "pending",
      payload: { providerOrderId },
    });

    // Outbox event
    await tx.insert(schema.outbox).values({
      aggregateType: "escrow",
      aggregateId: result.id,
      eventType: "escrow.created",
      orgId: claims.active_org_id,
      payload: { escrowId: result.id, tenderId: body.tenderId, amount: wasteAmount },
    });

    return result;
  });

  await cacheIdempotentResponse(idempotencyKey, claims.active_org_id, 201, escrow);
  publishEvent({ detailType: "escrow.created", detail: { id: escrow.id } });

  return c.json(escrow, 201);
});

// ─── GET /escrow/:id — escrow status ────────────────────────────────

escrowRoutes.get("/:id", async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  const id = c.req.param("id");

  const results = await runInGucTx(claims, (tx) =>
    tx.select().from(schema.escrowOrders).where(eq(schema.escrowOrders.id, id)),
  );

  const escrow = results[0];
  if (!escrow) throw new HTTPException(404, { message: "Escrow not found" });

  // Get transactions for this escrow
  const txs = await runInGucTx(claims, (tx) =>
    tx
      .select()
      .from(schema.escrowTransactions)
      .where(eq(schema.escrowTransactions.escrowOrderId, id)),
  );

  return c.json({ ...escrow, transactions: txs });
});

// ─── POST /escrow/:id/simulate-payment (dev only) ───────────────────

escrowRoutes.post("/:id/simulate-payment", async (c) => {
  const claims = c.get("jwtClaims") as JwtClaims;
  const id = c.req.param("id");

  const [updated] = await runInGucTx(claims, async (tx) => {
    const [order] = await tx
      .select()
      .from(schema.escrowOrders)
      .where(eq(schema.escrowOrders.id, id));

    if (!order) throw new HTTPException(404, { message: "Escrow not found" });
    if (order.status !== "pending") {
      throw new HTTPException(400, { message: `Escrow status is ${order.status}, not pending` });
    }

    // Update escrow transaction
    await tx
      .update(schema.escrowTransactions)
      .set({ status: "completed" })
      .where(eq(schema.escrowTransactions.escrowOrderId, id));

    // Fund the escrow
    const [result] = await tx
      .update(schema.escrowOrders)
      .set({ status: "funds_locked", fundedAt: new Date() })
      .where(eq(schema.escrowOrders.id, id))
      .returning();

    await tx.insert(schema.outbox).values({
      aggregateType: "escrow",
      aggregateId: id,
      eventType: "escrow.funded",
      orgId: order.buyerOrgId,
      payload: { escrowId: id, status: "funds_locked" },
    });

    return [result];
  });

  publishEvent({ detailType: "escrow.funded", detail: { id } });
  return c.json(updated);
});
