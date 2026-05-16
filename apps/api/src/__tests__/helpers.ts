import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Test API by importing the Hono app directly and using fetch against it.
import { app } from "../index";

// JWT secret (must match .env/Auth middleware)
const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";

// ─── Seed reference IDs (from pnpm db:seed) ────────────────────────
const SEED = {
  acmeAdmin: { sub: "1de9e269-ed04-4013-923d-3480b14b64dd", email: "ahmet@acme.example" },
  acmeOrg: "41bed6b0-a462-41a2-b2bb-e3c2bf10261d",
  ekoAdmin: { sub: "bdaa3019-ef43-4296-a379-d482287705d3", email: "mehmet@ekometal.example" },
  ekoOrg: "9bb5e070-610e-44af-bef6-696b26567085",
  hizliAdmin: { sub: "f2511968-984b-4d0a-b27b-60f339c2220e", email: "kadir@hizli.example" },
  hizliOrg: "0dd9880c-7533-4956-b291-405d5cdefc35",
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
