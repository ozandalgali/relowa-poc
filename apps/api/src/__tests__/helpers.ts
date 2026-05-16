import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Test API by importing the Hono app directly and using fetch against it.
import { app } from "../index";

// JWT secret (must match .env/Auth middleware)
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

// ─── Seed reference IDs (from pnpm db:seed) ────────────────────────
const SEED = {
  acmeAdmin: { sub: "65824d23-a273-4c7a-88fd-d9fbfd23f62f", email: "ahmet@acme.example" },
  acmeOrg: "815a5ad6-721c-403b-a098-786e19a12b29",
  ekoAdmin: { sub: "c181db71-2c61-4285-929c-18b6d6bde0a5", email: "mehmet@ekometal.example" },
  ekoOrg: "10fb52d3-cc43-4fee-bd60-60955e5f4c90",
  hizliAdmin: { sub: "60992439-9325-4c85-926f-ef2443caf0a0", email: "kadir@hizli.example" },
  hizliOrg: "e9ef5e37-5e85-42c1-9cba-137fed6ec50e",
};

// ─── JWT helpers ────────────────────────────────────────────────────

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

async function signJwt(payload: Record<string, unknown>): Promise<string> {
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

function makeClaims(userId: string, orgId: string, email: string, role = "admin") {
  return {
    sub: userId,
    active_org_id: orgId,
    email,
    role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  };
}

async function authHeader(userId: string, orgId: string, email: string) {
  const jwt = await signJwt(makeClaims(userId, orgId, email));
  return { Authorization: `Bearer ${jwt}` };
}

// ─── API request helper ─────────────────────────────────────────────

function api(path: string, init?: RequestInit): Promise<Response> {
  const url = new URL(path, "http://localhost");
  return app.request(url.toString(), init);
}

export { describe, it, expect, beforeAll, afterAll, SEED, JWT_SECRET, signJwt, makeClaims, authHeader, api };
