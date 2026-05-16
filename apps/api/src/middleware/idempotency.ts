import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { db } from "../client";
import * as schema from "@relowa/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Idempotency middleware (ADR-0004 + AGENTS.md §4)
 *
 * Checks the Idempotency-Key header on mutation endpoints.
 * If the key has been seen before, returns the cached response.
 * If not, proceeds and the route handler writes the result.
 */

const IDEMPOTENCY_TTL_HOURS = 24;

export function idempotencyMiddleware(method: string) {
  return createMiddleware(async (c, next) => {
    if (c.req.method !== method) return next();

    const key = c.req.header("Idempotency-Key");
    if (!key) {
      throw new HTTPException(400, {
        message: "Idempotency-Key header is required for this endpoint",
      });
    }

    const orgId = c.get("orgId") as string;
    if (!orgId) {
      throw new HTTPException(401, { message: "Authentication required" });
    }

    // Check if this key was already used
    const existing = await db.query.idempotencyKeys.findFirst({
      where: and(eq(schema.idempotencyKeys.key, key), eq(schema.idempotencyKeys.orgId, orgId)),
    });

    if (existing) {
      return c.json(existing.responseBody, existing.statusCode as 200 | 201);
    }

    // Store the key for later caching (route handler fills response)
    c.set("idempotencyKey", key);

    await next();
  });
}

export async function cacheIdempotentResponse(
  key: string,
  orgId: string,
  statusCode: number,
  responseBody: unknown,
) {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(responseBody)),
  );
  const requestHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + IDEMPOTENCY_TTL_HOURS);

  await db.insert(schema.idempotencyKeys).values({
    key,
    orgId,
    requestHash,
    statusCode,
    responseBody: responseBody as Record<string, unknown>,
    expiresAt,
  });
}
