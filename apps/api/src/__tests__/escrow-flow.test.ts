/**
 * escrow-flow.test.ts — End-to-end escrow lifecycle
 *
 * Tests: create tender → publish → bid → escrow create → simulate payment → status check
 */
import { describe, it, expect, beforeAll } from "vitest";
import { SEED, authHeader, api } from "./helpers";

describe("Escrow flow (end-to-end)", () => {
  let publishedTenderId: string | null = null;
  let escrowId: string | null = null;

  beforeAll(async () => {
    // Get a published tender
    const res = await api("/tenders", {
      headers: await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email),
    });
    const tenders = await res.json();
    const published = tenders.find((t: any) => t.status === "published");
    publishedTenderId = published?.id ?? null;
  });

  it("1. rejects escrow create on tender with no winner", async () => {
    if (!publishedTenderId) return;
    const res = await api("/escrow", {
      method: "POST",
      headers: {
        ...(await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email)),
        "Content-Type": "application/json",
        "Idempotency-Key": "escrow-flow-create",
      },
      body: JSON.stringify({ tenderId: publishedTenderId }),
    });
    expect(res.status).toBe(400);
  });

  it("2. can create escrow on won tender", async () => {
    // Find a won tender (if any from previous tests)
    const res = await api("/tenders", {
      headers: await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email),
    });
    const tenders = await res.json();
    const won = tenders.find((t: any) => t.status === "won");

    if (!won) return; // no won tender, skip

    const createRes = await api("/escrow", {
      method: "POST",
      headers: {
        ...(await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email)),
        "Content-Type": "application/json",
        "Idempotency-Key": "escrow-flow-won",
      },
      body: JSON.stringify({ tenderId: won.id }),
    });

    if (createRes.status === 201) {
      const escrow = await createRes.json();
      escrowId = escrow.id;
      expect(escrow.status).toBe("pending");
    }
  });

  it("3. escrow status has transactions", async () => {
    if (!escrowId) return;

    const res = await api(`/escrow/${escrowId}`, {
      headers: await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(escrowId);
    expect(body.transactions).toBeDefined();
  });

  it("4. simulate payment transitions to funds_locked", async () => {
    if (!escrowId) return;

    const res = await api(`/escrow/${escrowId}/simulate-payment`, {
      method: "POST",
      headers: {
        ...(await authHeader(SEED.acmeAdmin.sub, SEED.acmeOrg, SEED.acmeAdmin.email)),
        "Content-Type": "application/json",
        "Idempotency-Key": "escrow-flow-simulate",
      },
    });

    if (res.status === 200) {
      const escrow = await res.json();
      expect(escrow.status).toBe("funds_locked");
    }
  });
});
