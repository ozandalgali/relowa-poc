/**
 * updateStatus — Lambda handler (generic status update + audit)
 */
import { getDb, writeOutbox, updateEscrowStatus } from "./shared";

export const handler = async (event: { escrowId: string; status: string }) => {
  const { db, pg } = getDb();
  try {
    const extra: Record<string, unknown> = {};
    if (event.status === "funds_locked") extra.fundedAt = new Date();
    if (event.status === "delivered") extra.deliveredAt = new Date();
    if (event.status === "released") extra.releasedAt = new Date();

    const updated = await updateEscrowStatus(db, event.escrowId, event.status, extra);

    await writeOutbox(db, {
      aggregateType: "escrow",
      aggregateId: event.escrowId,
      eventType: `escrow.status_changed`,
      orgId: null,
      payload: { escrowId: event.escrowId, from: "previous", to: event.status },
    });

    return { escrowId: event.escrowId, status: event.status, updated };
  } finally {
    await pg.end();
  }
};
