/**
 * IBAN hashing utility (ADR-0007 §6 — KVKK)
 *
 * IBANs at rest are stored as SHA-256(salt + iban).
 * The salt is a per-tenant value from env (IBAN_HASH_SALT).
 * Raw IBAN flows through the provider call only, never stored.
 *
 * KVKK m.12 requires "appropriate technical measures" for PII.
 * One-way hashing with a secret salt satisfies this.
 */

import { createHash } from "node:crypto";

const IBAN_HASH_SALT = process.env.IBAN_HASH_SALT ?? "relowa-dev-salt";

/**
 * Hash an IBAN for storage. The salt prevents rainbow-table attacks.
 * Returns hex-encoded SHA-256 hash.
 */
export function hashIban(iban: string): string {
  const normalized = iban.replace(/\s/g, "").toUpperCase();
  return createHash("sha256")
    .update(IBAN_HASH_SALT)
    .update(normalized)
    .digest("hex");
}

/**
 * Verify an IBAN matches a stored hash.
 */
export function verifyIban(iban: string, hash: string): boolean {
  return hashIban(iban) === hash;
}
