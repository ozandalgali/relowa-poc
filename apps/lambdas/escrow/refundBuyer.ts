/**
 * refundBuyer — Lambda handler
 * Refunds the recycler (buyer) — called on dispute resolution or manual refund.
 */
import { getDb, writeOutbox, updateEscrowStatus } from "./shared";

export const handler = async (event: { escrowId: string; reason?: string }) => {
  const { db, pg } = getDb();
  try {
    await updateEscrowStatus(db, event.escrowId, "refunded", {
      disputeOpenedAt: new Date(),
      disputeReason: event.reason ?? "Manual refund",
    });

    await writeOutbox(db, {
      aggregateType: "escrow",
      aggregateId: event.escrowId,
      eventType: "escrow.refunded",
      orgId: null,
      payload: { escrowId: event.escrowId, reason: event.reason },
    });

    return { escrowId: event.escrowId, status: "refunded" };
  } finally {
    await pg.end();
  }
};
