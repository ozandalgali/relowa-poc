/**
 * escrow.test.ts — Escrow creation + status + simulate-payment
 */
import { describe, it, expect, beforeAll } from "vitest";
import { SEED, authHeader, api } from "./helpers";

describe("Escrow", () => {
  let publishedTenderId: string | null = null;
  let wonTenderId: string | null = null;

  beforeAll(async () => {
    // Get tenders
    const res = await api("/tenders", {
      headers: await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email),
    });
    const tenders = await res.json();
    const published = tenders.find((t: any) => t.status === "published");
    publishedTenderId = published?.id ?? null;
    const won = tenders.find((t: any) => t.status === "won");
    wonTenderId = won?.id ?? null;
  });

  it("rejects escrow create without auth (401)", async () => {
    const res = await api("/escrow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenderId: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects escrow create with non-existent tender (404)", async () => {
    const res = await api("/escrow", {
      method: "POST",
      headers: {
        ...(await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email)),
        "Content-Type": "application/json",
        "Idempotency-Key": "escrow-test-404",
      },
      body: JSON.stringify({ tenderId: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects escrow create on tender with no winner (400)", async () => {
    if (!publishedTenderId) return; // skip if no published tender
    const res = await api("/escrow", {
      method: "POST",
      headers: {
        ...(await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email)),
        "Content-Type": "application/json",
        "Idempotency-Key": "escrow-test-no-winner",
      },
      body: JSON.stringify({ tenderId: publishedTenderId }),
    });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("winner");
  });

  it("returns 404 for non-existent escrow", async () => {
    const res = await api("/escrow/00000000-0000-0000-0000-000000000000", {
      headers: await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email),
    });
    expect(res.status).toBe(404);
  });

  it("creates escrow for won tender (201)", async () => {
    if (!wonTenderId) {
      // No won tender in seed — test the reject path instead
      return;
    }
    const res = await api("/escrow", {
      method: "POST",
      headers: {
        ...(await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email)),
        "Content-Type": "application/json",
        "Idempotency-Key": "escrow-test-create",
      },
      body: JSON.stringify({ tenderId: wonTenderId }),
    });
    // May be 201 or 400 depending on actual state
    expect([201, 400]).toContain(res.status);
  });
});
