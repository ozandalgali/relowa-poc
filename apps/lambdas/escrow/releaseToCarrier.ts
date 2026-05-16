/**
 * releaseToCarrier — Lambda handler
 * Releases the transport payment to the carrier.
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

    const transportAmount = escrow.transportAmount ?? "0";

    await db.insert(schema.escrowTransactions).values({
      escrowOrderId: event.escrowId,
      txType: "release",
      amount: transportAmount,
      status: "completed",
      providerTxId: `manual-release-carrier-${Date.now()}`,
      payload: { releasedTo: escrow.carrierOrgId },
    });

    await writeOutbox(db, {
      aggregateType: "escrow",
      aggregateId: event.escrowId,
      eventType: "escrow.carrier_paid",
      orgId: escrow.buyerOrgId,
      payload: { escrowId: event.escrowId, amount: transportAmount, carrier: escrow.carrierOrgId },
    });

    return { escrowId: event.escrowId, status: "released_to_carrier" };
  } finally {
    await pg.end();
  }
};
