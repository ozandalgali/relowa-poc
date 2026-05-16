import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Test API by importing the Hono app directly and using fetch against it.
import { app } from "../index";

// JWT secret (must match .env/Auth middleware)
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

// ─── Seed reference IDs (from pnpm db:seed) ────────────────────────
const SEED = {
  acmeAdmin: { sub: "210285de-c201-4ac0-b174-c1151d3a6099", email: "ahmet@acme.example" },
  acmeOrg: "7264c8b2-a41a-4319-ac42-78e8c2b10e18",
  ekoAdmin: { sub: "805140a3-4863-4414-a283-ee9321f978f2", email: "mehmet@ekometal.example" },
  ekoOrg: "6ba566bf-8384-475a-8597-0e017a2c7f20",
  hizliAdmin: { sub: "7536a211-cff9-4cf8-a4f7-56902be4eddf", email: "kadir@hizli.example" },
  hizliOrg: "72db69a9-079b-4268-958c-d51d59aa7ca1",
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
