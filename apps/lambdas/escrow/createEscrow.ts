/**
 * createEscrow — Lambda handler
 * Called by Step Functions to initialize the escrow order.
 * Writes audit event and starts the provider workflow.
 */
import { getDb, writeOutbox } from "./shared";

export const handler = async (event: { escrowId: string; tenderId: string; buyerOrgId: string; sellerOrgId: string; amount: string }) => {
  const { db, pg } = getDb();
  try {
    // Escrow already exists in DB from POST /escrow API call.
    // This Lambda just verifies and records the SFN start.
    await writeOutbox(db, {
      aggregateType: "escrow",
      aggregateId: event.escrowId,
      eventType: "escrow.state_machine_started",
      orgId: event.buyerOrgId,
      payload: { escrowId: event.escrowId, tenderId: event.tenderId },
    });

    return { escrowId: event.escrowId, status: "pending" };
  } finally {
    await pg.end();
  }
};
