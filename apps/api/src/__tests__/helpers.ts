import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Test API by importing the Hono app directly and using fetch against it.
import { app } from "../index";

// JWT secret (must match .env/Auth middleware)
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

// ─── Seed reference IDs (from pnpm db:seed) ────────────────────────
const SEED = {
  acmeAdmin: { sub: "1c0fe9c1-2570-4281-bd8c-a9b303af983d", email: "ahmet@acme.example" },
  acmeOrg: "ece1d3fe-f555-4a0f-89d5-b75c633b0836",
  ekoAdmin: { sub: "88920f56-42b0-4a3c-87b9-4e5b3fb5f4fc", email: "mehmet@ekometal.example" },
  ekoOrg: "897549a5-b32f-49e4-84f9-a1b2dd993b41",
  hizliAdmin: { sub: "75529110-c5ce-4f99-b55a-eb5a9f881029", email: "kadir@hizli.example" },
  hizliOrg: "0fa11442-8a42-4ee3-84bd-b8b5d85d399a",
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
