/**
 * Escrow Lambda shared utilities
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@relowa/db/schema";
import { eq } from "drizzle-orm";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://relowa:dev_password_change_me@localhost:5433/relowa";

export function getDb() {
  const pg = postgres(DATABASE_URL, { max: 1 });
  return { db: drizzle(pg, { schema }), pg };
}

export async function setGucRole(db: ReturnType<typeof getDb>["db"]) {
  // Lambdas run as relowa superuser - set role for RLS bypass on admin operations
}

export async function writeOutbox(
  db: ReturnType<typeof getDb>["db"],
  event: { aggregateType: string; aggregateId: string; eventType: string; orgId: string | null; payload: Record<string, unknown> },
) {
  await db.insert(schema.outbox).values({
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    orgId: event.orgId,
    payload: event.payload,
  });
}

export async function updateEscrowStatus(
  db: ReturnType<typeof getDb>["db"],
  escrowId: string,
  status: string,
  extra?: Record<string, unknown>,
) {
  const [updated] = await db
    .update(schema.escrowOrders)
    .set({ status: status as any, ...extra })
    .where(eq(schema.escrowOrders.id, escrowId))
    .returning();
  return updated;
}
