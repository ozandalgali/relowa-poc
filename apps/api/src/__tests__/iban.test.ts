/**
 * iban.test.ts — IBAN hashing utility
 */
import { describe, it, expect } from "vitest";
import { hashIban, verifyIban } from "../utils/iban";

describe("IBAN hashing", () => {
  const testIban = "TR33 0006 1005 1978 6457 8413 26";

  it("produces deterministic hash", () => {
    const h1 = hashIban(testIban);
    const h2 = hashIban(testIban);
    expect(h1).toBe(h2);
  });

  it("normalizes whitespace", () => {
    const h1 = hashIban("TR330006100519786457841326");
    const h2 = hashIban("TR33 0006 1005 1978 6457 8413 26");
    expect(h1).toBe(h2);
  });

  it("verifies correct IBAN", () => {
    const hash = hashIban(testIban);
    expect(verifyIban(testIban, hash)).toBe(true);
  });

  it("rejects wrong IBAN", () => {
    const hash = hashIban(testIban);
    expect(verifyIban("TR99 9999 9999 9999 9999 9999 99", hash)).toBe(false);
  });

  it("different IBANs produce different hashes", () => {
    const h1 = hashIban("TR330006100519786457841326");
    const h2 = hashIban("TR990000000000000000000000");
    expect(h1).not.toBe(h2);
  });
});
