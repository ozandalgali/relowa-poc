import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

/**
 * JWT-via-GUC middleware (ADR-0003)
 *
 * Verifies the JWT from Authorization header, then sets
 * `request.jwt.claims` and `SET LOCAL ROLE app_user` so that
 * Postgres RLS policies see the user's identity transparently.
 *
 * Dev mode: HMAC-signed JWT using JWT_SECRET from env.
 * Production: JWT signed by Cognito → API re-signs with active_org_id.
 */

const JWT_SECRET = process.env.JWT_SECRET ?? "super-secret-jwt-token-with-at-least-32-characters-long";

interface JwtClaims {
  sub: string; // user UUID
  active_org_id: string;
  email: string;
  role?: string;
  exp?: number;
  iat?: number;
}

function base64UrlDecode(str: string): string {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function signJwt(payload: JwtClaims): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const data = new TextEncoder().encode(`${header}.${body}`);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, data);
  const sig = base64UrlEncodeBytes(new Uint8Array(signature));
  return `${header}.${body}.${sig}`;
}

async function verifyJwt(token: string): Promise<JwtClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new HTTPException(401, { message: "Invalid JWT format" });

  const [headerB64, bodyB64, sigB64] = parts;
  const data = new TextEncoder().encode(`${headerB64}.${bodyB64}`);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const sigBytes = Buffer.from(sigB64.replace(/-/g, "+").replace(/_/g, "/"), "base64");

  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, data);
  if (!valid) throw new HTTPException(401, { message: "Invalid JWT signature" });

  const claims = JSON.parse(base64UrlDecode(bodyB64)) as JwtClaims;

  // Check expiry
  if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) {
    throw new HTTPException(401, { message: "JWT expired" });
  }

  return claims;
}

/**
 * SET LOCAL GUC for RLS — must run inside a transaction.
 * Postgres SET LOCAL only works in transaction blocks.
 * Returns the GUC JSON string for use in transactions.
 */
function gucClaims(claims: JwtClaims): string {
  return JSON.stringify(claims);
}

export { JWT_SECRET, signJwt, verifyJwt, gucClaims };
export type { JwtClaims };

export const jwtMiddleware = createMiddleware(async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing Authorization header" });
  }

  const token = auth.slice(7);
  const claims = await verifyJwt(token);

  // Store claims in context for route handlers
  c.set("jwtClaims", claims);
  c.set("userId", claims.sub);
  c.set("orgId", claims.active_org_id);

  await next();
});
