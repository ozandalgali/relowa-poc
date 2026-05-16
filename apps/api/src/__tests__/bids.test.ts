/**
 * bids.test.ts — Bid flow
 */
import { describe, it, expect, beforeAll } from "vitest";
import { SEED, authHeader, api } from "./helpers";

describe("Bid flow", () => {
  let publishedTenderId: string | null = null;
  let draftTenderId: string | null = null;

  beforeAll(async () => {
    // Get a published tender for bid tests
    const res = await api("/tenders", {
      headers: await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email),
    });
    const tenders = await res.json();
    const published = tenders.find((t: any) => t.status === "published");
    publishedTenderId = published?.id ?? null;
    const draft = tenders.find((t: any) => t.status === "draft");
    draftTenderId = draft?.id ?? null;

    // If no draft, create one
    if (!draftTenderId) {
      const create = await api("/tenders", {
        method: "POST",
        headers: {
          ...(await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email)),
          "Content-Type": "application/json",
          "Idempotency-Key": "test-bid-setup-draft",
        },
        body: JSON.stringify({ materialType: "metal_scrap", quantityTons: 5, pickupRegion: "Test" }),
      });
      const created = await create.json();
      draftTenderId = created.id;
    }
  });

  it("places a bid on published tender (201)", async () => {
    expect(publishedTenderId).toBeTruthy();
    const res = await api(`/tenders/${publishedTenderId}/bids`, {
      method: "POST",
      headers: {
        ...(await authHeader(SEED.ekoAdmin.sub, SEED.ekoOrg, SEED.ekoAdmin.email)),
        "Content-Type": "application/json",
        "Idempotency-Key": "test-bid-001",
      },
      body: JSON.stringify({ pricePerTon: 450.75, includesShipping: true, notes: "Nakliye bizden" }),
    });
    expect(res.status).toBe(201);
    const bid = await res.json();
    expect(bid.id).toBeDefined();
    expect(bid.pricePerTon).toBe("450.75");
  });

  it("rejects bid on draft tender (400)", async () => {
    expect(draftTenderId).toBeTruthy();
    // Try to bid on own draft — should fail because tender is not published
    const res = await api(`/tenders/${draftTenderId}/bids`, {
      method: "POST",
      headers: {
        ...(await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email)),
        "Content-Type": "application/json",
        "Idempotency-Key": "test-bid-draft",
      },
      body: JSON.stringify({ pricePerTon: 100 }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects bid without Idempotency-Key (400)", async () => {
    expect(publishedTenderId).toBeTruthy();
    const res = await api(`/tenders/${publishedTenderId}/bids`, {
      method: "POST",
      headers: {
        ...(await authHeader(SEED.ekoAdmin.sub, SEED.ekoOrg, SEED.ekoAdmin.email)),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pricePerTon: 100 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns cached bid on idempotent replay", async () => {
    expect(publishedTenderId).toBeTruthy();
    const res = await api(`/tenders/${publishedTenderId}/bids`, {
      method: "POST",
      headers: {
        ...(await authHeader(SEED.ekoAdmin.sub, SEED.ekoOrg, SEED.ekoAdmin.email)),
        "Content-Type": "application/json",
        "Idempotency-Key": "test-bid-001",
      },
      body: JSON.stringify({ pricePerTon: 999999 }),
    });
    expect(res.status).toBe(201);
    const bid = await res.json();
    expect(bid.pricePerTon).toBe("450.75");
  });

  it("lists bids for tender (200)", async () => {
    expect(publishedTenderId).toBeTruthy();
    const res = await api(`/tenders/${publishedTenderId}/bids`, {
      headers: await authHeader(SEED.ekoAdmin.sub, SEED.ekoOrg, SEED.ekoAdmin.email),
    });
    expect(res.status).toBe(200);
    const bids = await res.json();
    expect(Array.isArray(bids)).toBe(true);
    // Valid response — may be 0 due to test isolation cleanup
  });
});
