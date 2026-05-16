/**
 * openDispute — Lambda handler
 * Opens a dispute on an escrow, moves to disputed status.
 */
import { getDb, writeOutbox, updateEscrowStatus } from "./shared";

export const handler = async (event: { escrowId: string; reason?: string }) => {
  const { db, pg } = getDb();
  try {
    await updateEscrowStatus(db, event.escrowId, "disputed", {
      disputeOpenedAt: new Date(),
      disputeReason: event.reason ?? "Automatic dispute (shipment timeout)",
    });

    await writeOutbox(db, {
      aggregateType: "escrow",
      aggregateId: event.escrowId,
      eventType: "escrow.disputed",
      orgId: null,
      payload: { escrowId: event.escrowId, reason: event.reason },
    });

    return { escrowId: event.escrowId, status: "disputed" };
  } finally {
    await pg.end();
  }
};
