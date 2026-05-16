import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "../client";
import * as schema from "@relowa/db/schema";
import { sql } from "drizzle-orm";
import { ManualProvider } from "../providers/manual";
import { publishEvent } from "../events";

const provider = new ManualProvider();

export const webhookRoutes = new Hono();

// ─── POST /api/webhooks/:provider ───────────────────────────────────

webhookRoutes.post("/:provider", async (c) => {
  const providerName = c.req.param("provider");

  const rawBody = await c.req.text();
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((val, key) => {
    headers[key] = val;
  });

  // Verify webhook (ManualProvider trusts everything)
  const verification = await provider.verifyWebhook({
    headers,
    body: rawBody,
  });

  if (!verification.valid) {
    return c.json({ error: "Invalid webhook signature" }, 400);
  }

  // Idempotency: check if this provider event was already processed
  const existing = await db.query.providerWebhooks.findFirst({
    where: sql`${schema.providerWebhooks.provider} = ${providerName} AND ${schema.providerWebhooks.providerEventId} = ${verification.eventId}`,
  });

  if (existing) {
    return c.json({ status: "already_processed", id: existing.id }, 200);
  }

    // Insert webhook record (relatedEscrowId is UUID, skip non-UUID strings)
    let relatedEscrowId: string | null = null;
    if (
      verification.orderId &&
      verification.orderId !== "unknown" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(verification.orderId)
    ) {
      relatedEscrowId = verification.orderId;
    }

    const [webhook] = await db
      .insert(schema.providerWebhooks)
      .values({
        provider: providerName,
        providerEventId: verification.eventId,
        payload: verification.payload as Record<string, unknown>,
        signatureValid: verification.valid,
        relatedEscrowId: relatedEscrowId,
      })
      .returning();

  if (!webhook) throw new HTTPException(500, { message: "Failed to store webhook" });

  // Process the event based on type
  if (verification.eventType === "payment.completed") {
    // Find related escrow and update status
    if (verification.orderId && verification.orderId !== "unknown") {
      const [escrow] = await db
        .select()
        .from(schema.escrowOrders)
        .where(sql`${schema.escrowOrders.providerOrderId} = ${verification.orderId}`);

      if (escrow) {
        await db
          .update(schema.escrowOrders)
          .set({ status: "funds_locked", fundedAt: new Date() })
          .where(sql`${schema.escrowOrders.id} = ${escrow.id}`);

        publishEvent({ detailType: "escrow.funded", detail: { id: escrow.id } });
      }
    }
  }

  return c.json({ status: "processed", id: webhook.id }, 200);
});
