# Hash anchoring on Arbitrum One

> Why we publish a 32-byte Merkle root to an L2 every day, and how an auditor verifies it independently.

## What this is

A **compliance primitive**, not a blockchain product. Once per day, a Lambda computes a Merkle root over all new audit events, then calls a single-function Arbitrum One contract to record that root. The on-chain record proves "at block H, this exact set of data existed" without revealing any of the data itself.

The chain's role is a digital notary. Nothing else.

## Why three layers of audit protection

| Layer | Protects against | Trust model |
|---|---|---|
| 1. Hash chain (DB trigger) | Row deletion/modification in Postgres | Trust the DB operator |
| 2. S3 WORM mirror (Object Lock) | DB compromise + backdating | Trust AWS's WORM enforcement |
| 3. Arbitrum anchor (Merkle root) | Infrastructure compromise + collusion | Trust Arbitrum → Ethereum consensus |

Layers 1 and 2 depend on infrastructure we control. Layer 3 depends on a consensus network we don't. An auditor who trusts none of our infrastructure can still verify layer 3.

## How it works (detailed)

### Anchoring (daily Lambda, writes)

```
┌─────────────────────────────────────────────────────┐
│  Anchor Lambda (EventBridge Scheduler, daily 00:00) │
├─────────────────────────────────────────────────────┤
│                                                      │
│  1. SELECT * FROM audit_events                       │
│       WHERE created_at >= now() - interval '24h';   │
│                                                      │
│  2. SELECT * FROM material_recovery_certificates     │
│       WHERE created_at >= now() - interval '24h';   │
│                                                      │
│  3. Build Merkle tree over audit events              │
│     leaf_i = sha256(id || action || entity ||        │
│                     payload || created_at)           │
│                                                      │
│  4. Build Merkle tree over certificates              │
│     leaf_i = sha256(id || tonnage || material ||     │
│                     source || destination ||         │
│                     carbon_factor || created_at)     │
│                                                      │
│  5. combined_root = sha256(audit_root || cert_root)  │
│                                                      │
│  6. anchor_contract.record(combined_root)            │
│     → emits RootRecorded(root, blockNumber, ts)     │
│                                                      │
│  7. Store (date, combined_root, blockNumber) in      │
│     anchor_log table for fast API lookup             │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Verification (on-demand, anyone can run)

```
┌──────────────────────────────────────────────┐
│  Verifier (auditor's laptop, browser, or our │
│  public-facing verify endpoint)              │
├──────────────────────────────────────────────┤
│                                               │
│  1. Get target date                           │
│                                               │
│  2. Query Arbitrum RPC:                       │
│     "give me RootRecorded events for date D"  │
│     → on_chain_root, block_number             │
│                                               │
│  3. Request audit events for date D from      │
│     Relowa API (org-scoped, RLS-filtered)     │
│     → events[]                                 │
│                                               │
│  4. Recompute Merkle root from events[]       │
│     (same leaf construction as anchor)        │
│     → computed_root                           │
│                                               │
│  5. ASSERT computed_root == on_chain_root     │
│     → Match: records are authentic            │
│     → Mismatch: tampering detected            │
│                                               │
└──────────────────────────────────────────────┘
```

## What goes into the Merkle leaves

### audit_events leaf

```typescript
const leaf = sha256([
  event.id,
  event.action,
  event.entity_type,
  event.entity_id,
  event.payload,       // JSON-stringified, canonical key ordering
  event.created_at.toISOString(),
  event.prev_hash,     // ties to hash chain (layer 1)
].join('|'));
```

Including `prev_hash` means: the Merkle root rolls up the hash chain. An auditor verifying a Merkle root is also implicitly verifying the hash chain integrity — the layers reinforce each other.

### material_recovery_certificate leaf

```typescript
const leaf = sha256([
  cert.id,
  cert.tender_id,
  cert.tonnage,
  cert.material_type,
  cert.source_org_id,
  cert.destination_org_id,
  cert.carbon_factor_kg_co2e_per_ton,
  cert.created_at.toISOString(),
].join('|'));
```

Carbon factor is data-driven (not assumed) — sourced from the material type's lifecycle assessment. This makes ESG claims defensible: the auditor can verify the factor, the tonnage, and the timestamp independently.

## Why Arbitrum One specifically

| Property | Arbitrum One | Why it matters for this |
|---|---|---|
| L2 on Ethereum | Inherits L1 security after 7d challenge window | Auditors accept Ethereum-level finality |
| EVM-compatible | Standard ethers.js/viem tooling | No new language or runtime |
| ~$0.01/day | The `record()` call stores nothing (event-only) | Negligible cost |
| No single-company sequencer | DAO governance, decentralization roadmap | Easier GDPR/KVKK "who controls this" answer |
| Hyperliquid validates pattern | Solo/small team running financial infra on Arbitrum | Beaten path |

## What we intentionally don't do

- **No ZK proofs.** A Merkle proof is sufficient for regulatory timestamping. ZK would add complexity with no regulatory benefit at this stage.
- **No per-event anchoring.** It's 100x more expensive and unnecessary for CSRD/ESPR/WSR compliance.
- **No token, no DeFi, no custom consensus.** This is a utility contract, not a product.
- **No data on-chain.** The 32-byte root reveals nothing. KVKK and GDPR compliance is preserved.
- **No client-side wallet requirement.** Auditors interact with Arbitrum via public RPC or block explorer — no MetaMask, no gas.

## ESG verification flow

The concrete scenario this enables:

1. A recycling facility runs Tender #142, processes 500 tons of PET.
2. The system issues a `material_recovery_certificate` with a data-driven carbon factor.
3. At 00:00 UTC, the anchor Lambda includes this certificate in the daily Merkle root.
4. Six months later, a CSRD auditor requests the certificate.
5. Relowa provides: the certificate row, the Merkle proof (path from leaf → root), and the Arbitrum block number.
6. The auditor recomputes the proof, checks the on-chain root, confirms: the certificate is authentic, unmodified, and existed at block N.
7. The auditor files the CSRD report with verifiable supply-chain emissions data.

The entire verification takes seconds and costs nothing.

## Operational notes

- The anchor Lambda runs on EventBridge Scheduler (not `pg_cron`) — consistent with the architectural shift to AWS-managed scheduling.
- If the Lambda fails, we have a CloudWatch alarm. The contract emits events, so we can also detect gaps by scanning for missing days.
- The `anchor_log` table stores `(date, merkle_root, arbitrum_block_number, tx_hash)` for fast lookup without RPC calls.
- The Lambda's private key lives in AWS Secrets Manager, auto-rotated. The key's only permission is calling `record()` on one contract.

## See also

- [[../../adr/0008-arbitrum-hash-anchoring]] — the full ADR
- [[audit-hash-chain]] — layer 1 of audit protection (DB hash chain)
- [[idempotency]] — the other tamper-resistance pattern
- [[../../adr/0001-postgres-as-system-of-record]] — why Postgres is the SoR
