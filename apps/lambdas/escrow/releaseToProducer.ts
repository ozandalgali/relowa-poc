/**
 * releaseToProducer — Lambda handler
 * Releases the waste payment to the producer (seller).
 * Also generates ESG certificate on successful release.
 */
import { getDb, writeOutbox } from "./shared";
import * as schema from "@relowa/db/schema";
import { eq } from "drizzle-orm";

export const handler = async (event: { escrowId: string }) => {
  const { db, pg } = getDb();
  try {
    const [escrow] = await db
      .select()
      .from(schema.escrowOrders)
      .where(eq(schema.escrowOrders.id, event.escrowId));

    if (!escrow) throw new Error(`Escrow ${event.escrowId} not found`);

    // Simulate provider release (ManualProvider always succeeds)
    // In production, this calls Iyzico.releaseToSeller()

    await db.insert(schema.escrowTransactions).values({
      escrowOrderId: event.escrowId,
      txType: "release",
      amount: escrow.wasteAmount,
      status: "completed",
      providerTxId: `manual-release-producer-${Date.now()}`,
      payload: { releasedTo: escrow.sellerOrgId },
    });

    // Generate ESG certificate entry
    await db.insert(schema.anchorLog).values({
      merkleRoot: "pending", // Will be computed by daily anchor Lambda
      auditEventCount: 1,
      certCount: 1,
      createdAt: new Date(),
    });

    await writeOutbox(db, {
      aggregateType: "escrow",
      aggregateId: event.escrowId,
      eventType: "escrow.producer_paid",
      orgId: escrow.buyerOrgId,
      payload: { escrowId: event.escrowId, amount: escrow.wasteAmount, seller: escrow.sellerOrgId },
    });

    return { escrowId: event.escrowId, status: "released_to_producer" };
  } finally {
    await pg.end();
  }
};
