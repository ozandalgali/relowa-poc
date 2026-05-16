/**
 * tenders.test.ts — Tender CRUD + validation + idempotency
 *
 * Tests:
 *  - POST /tenders → 201 with valid body
 *  - POST /tenders with missing Idempotency-Key → 400
 *  - POST /tenders idempotent replay → returns cached 201
 *  - POST /tenders with bad body → 400
 *  - GET /tenders/:id → 200 for own tender
 *  - GET /tenders/:id → 404 for non-existent
 *  - PATCH /tenders/:id/publish → 200
 */
import { describe, it, expect } from "vitest";
import { SEED, authHeader, api } from "./helpers";

describe("Tender CRUD", () => {
  let createdTenderId: string;

  it("creates a tender (201)", async () => {
    const res = await api("/tenders", {
      method: "POST",
      headers: {
        ...(await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email)),
        "Content-Type": "application/json",
        "Idempotency-Key": "test-create-001",
      },
      body: JSON.stringify({
        materialType: "metal_scrap",
        quantityTons: 15.5,
        pickupRegion: "Ankara",
      }),
    });
    expect(res.status).toBe(201);
    const tender = await res.json();
    expect(tender.id).toBeDefined();
    expect(tender.materialType).toBe("metal_scrap");
    expect(tender.status).toBe("draft");
    createdTenderId = tender.id;
  });

  it("rejects POST without Idempotency-Key (400)", async () => {
    const res = await api("/tenders", {
      method: "POST",
      headers: {
        ...(await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email)),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        materialType: "metal_scrap",
        quantityTons: 10,
        pickupRegion: "Izmir",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns cached result on idempotent replay", async () => {
    const res = await api("/tenders", {
      method: "POST",
      headers: {
        ...(await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email)),
        "Content-Type": "application/json",
        "Idempotency-Key": "test-create-001", // same key
      },
      body: JSON.stringify({
        materialType: "plastic", // different data — should still return cached
        quantityTons: 99,
        pickupRegion: "Nowhere",
      }),
    });
    expect(res.status).toBe(201);
    const tender = await res.json();
    // Should return the ORIGINAL tender, not create a new one
    expect(tender.id).toBe(createdTenderId);
    expect(tender.materialType).toBe("metal_scrap"); // original value
  });

  it("rejects POST with invalid body (400)", async () => {
    const res = await api("/tenders", {
      method: "POST",
      headers: {
        ...(await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email)),
        "Content-Type": "application/json",
        "Idempotency-Key": "test-bad-body",
      },
      body: JSON.stringify({ materialType: "invalid_type", quantityTons: -5 }),
    });
    expect(res.status).toBe(400);
  });

  it("gets tender by id (200)", async () => {
    const res = await api(`/tenders/${createdTenderId}`, {
      headers: await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email),
    });
    expect(res.status).toBe(200);
    const tender = await res.json();
    expect(tender.id).toBe(createdTenderId);
  });

  it("returns 404 for non-existent tender", async () => {
    const res = await api("/tenders/00000000-0000-0000-0000-000000000000", {
      headers: await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email),
    });
    expect(res.status).toBe(404);
  });

  it("publishes a tender (200)", async () => {
    const future = new Date(Date.now() + 86400000).toISOString(); // 24h from now
    const res = await api(`/tenders/${createdTenderId}/publish`, {
      method: "PATCH",
      headers: {
        ...(await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email)),
        "Content-Type": "application/json",
        "Idempotency-Key": "test-publish-001",
      },
      body: JSON.stringify({ closesAt: future }),
    });
    expect(res.status).toBe(200);
    const tender = await res.json();
    expect(tender.status).toBe("published");
    expect(tender.publishedAt).toBeTruthy();
  });
});
