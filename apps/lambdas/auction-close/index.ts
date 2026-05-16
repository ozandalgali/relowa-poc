/**
 * Auction close Lambda
 *
 * Triggered by EventBridge Scheduler every 30 seconds.
 * Finds tenders past their closes_at and determines winners.
 *
 * Soft-close anti-sniping (ADR-0009):
 *   If a bid was placed in the last 60 seconds before closes_at,
 *   extend closes_at by 60 seconds. This prevents "sniping"
 *   (submitting a winning bid at the last second).
 *
 * Winner determination:
 *   Highest pricePerTon wins. If no bids, tender is cancelled.
 *   If exactly one bid, that bid wins automatically.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, lt, desc, sql } from "drizzle-orm";

// Load schema dynamically from the db package
const schema = await import("@relowa/db/schema");

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://relowa:dev_password_change_me@localhost:5433/relowa";

const SOFT_CLOSE_SECONDS = 60;

async function main() {
  const pg = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(pg, { schema: schema });

  console.log("Auction close Lambda — checking for tenders to close...");

  // Find tenders past closes_at, still published
  const closingTenders = await db
    .select()
    .from(schema.tenders)
    .where(
      sql`${schema.tenders.status} = 'published' AND ${schema.tenders.closesAt} <= now()`,
    );

  if (closingTenders.length === 0) {
    console.log("No tenders to close.");
    await pg.end();
    return;
  }

  console.log(`Found ${closingTenders.length} tender(s) to close.`);

  for (const tender of closingTenders) {
    // Check for soft-close: any bid in last 60 seconds before closes_at?
    const softCloseWindow = new Date(tender.closesAt!.getTime() - SOFT_CLOSE_SECONDS * 1000);

    const [lateBid] = await db
      .select({ id: schema.bids.id })
      .from(schema.bids)
      .where(
        sql`${schema.bids.tenderId} = ${tender.id} AND ${schema.bids.createdAt} >= ${softCloseWindow}`,
      )
      .limit(1);

    if (lateBid) {
      // Soft-close: extend by 60 seconds
      const newClosesAt = new Date(tender.closesAt!.getTime() + SOFT_CLOSE_SECONDS * 1000);
      await db
        .update(schema.tenders)
        .set({
          status: "closing",
          closesAt: newClosesAt,
        })
        .where(eq(schema.tenders.id, tender.id));

      console.log(
        `  Tender ${tender.id}: soft-close — extended closesAt to ${newClosesAt.toISOString()}`,
      );
      continue;
    }

    // No late bid — determine winner
    const [winningBid] = await db
      .select()
      .from(schema.bids)
      .where(eq(schema.bids.tenderId, tender.id))
      .orderBy(desc(schema.bids.pricePerTon))
      .limit(1);

    if (winningBid) {
      // Winner found
      await db
        .update(schema.tenders)
        .set({
          status: "won",
          winnerBidId: winningBid.id,
          closedAt: new Date(),
        })
        .where(eq(schema.tenders.id, tender.id));

      // Outbox: tender.won
      await db.insert(schema.outbox).values({
        aggregateType: "tender",
        aggregateId: tender.id,
        eventType: "tender.won",
        orgId: tender.orgId,
        payload: {
          tenderId: tender.id,
          winnerBidId: winningBid.id,
          winningPricePerTon: winningBid.pricePerTon,
          winnerOrgId: winningBid.bidderOrgId,
          closedAt: new Date().toISOString(),
        },
      });

      console.log(
        `  Tender ${tender.id}: won by bid ${winningBid.id} (${winningBid.pricePerTon}/ton)`,
      );
    } else {
      // No bids — cancel
      await db
        .update(schema.tenders)
        .set({
          status: "cancelled",
          closedAt: new Date(),
        })
        .where(eq(schema.tenders.id, tender.id));

      console.log(`  Tender ${tender.id}: cancelled (no bids)`);
    }
  }

  await pg.end();
  console.log("Auction close Lambda complete.");
}

// Allow running directly for testing
main().catch((err) => {
  console.error("Auction close Lambda failed:", err);
  process.exit(1);
});
