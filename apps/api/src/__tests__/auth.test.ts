/**
 * auth.test.ts — JWT verification + RLS scoping
 */
import { describe, it, expect } from "vitest";
import { SEED, signJwt, makeClaims, authHeader, api } from "./helpers";

describe("JWT Auth", () => {
  it("health is public (no auth)", async () => {
    const res = await api("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("returns 401 without Authorization header", async () => {
    const res = await api("/tenders");
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid signature", async () => {
    const jwt = await signJwt({
      sub: "00000000-0000-0000-0000-000000000000",
      active_org_id: SEED.acmeOrg,
      email: "fake@example.com",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const tampered = jwt.slice(0, -5) + "XXXXX";
    const res = await api("/tenders", {
      headers: { Authorization: `Bearer ${tampered}` },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 with expired JWT", async () => {
    const jwt = await signJwt({
      ...makeClaims(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email),
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
    });
    const res = await api("/tenders", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 with malformed token", async () => {
    const res = await api("/tenders", {
      headers: { Authorization: "Bearer not.a.jwt" },
    });
    expect(res.status).toBe(401);
  });

  it("returns tenders for Acme admin (RLS-scoped to own org)", async () => {
    const res = await api("/tenders", {
      headers: await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email),
    });
    expect(res.status).toBe(200);
    const tenders = await res.json();
    expect(Array.isArray(tenders)).toBe(true);
    // All returned tenders must belong to Acme's org
    expect(tenders.every((t: any) => t.orgId === SEED.acmeOrg)).toBe(true);
  });

  it("EkoMetal sees only published tenders (RLS-scoped)", async () => {
    const res = await api("/tenders", {
      headers: await authHeader(SEED.ekoAdmin.sub, SEED.ekoOrg, SEED.ekoAdmin.email),
    });
    expect(res.status).toBe(200);
    const tenders = await res.json();
    // Recycler RLS: only published tenders visible
    expect(tenders.every((t: any) => t.status === "published")).toBe(true);
  });

  it("Hizli carrier sees 0 tenders (no carrier policy)", async () => {
    const res = await api("/tenders", {
      headers: await authHeader(SEED.hizliAdmin.sub, SEED.hizliOrg, SEED.hizliAdmin.email),
    });
    expect(res.status).toBe(200);
    const tenders = await res.json();
    expect(tenders.length).toBe(0);
  });
});
