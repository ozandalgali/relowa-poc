# ADR-0008 — Arbitrum One for daily Merkle root anchoring

**Status:** Accepted  
**Date:** 2026-05-09  
**Decision-makers:** Ozan (lead)

## Context

Relowa's audit architecture already has two tamper-detection layers:

1. **Hash chain** on `audit_events` — each row chains to its predecessor via SHA-256 (see [[../../adr/0001-postgres-as-system-of-record]] and [[../../memory/concepts/audit-hash-chain]]).
2. **S3 WORM mirror** — daily JSON-Lines export to S3 with Object Lock, providing a legal-evidence backstop.

Neither of these proves **when** a record was created in a way that an external auditor can independently verify without trusting our infrastructure. An adversarial scenario: we could backdate rows in the DB, recompute the hash chain forward, and upload a fake S3 mirror — and an auditor with only our word couldn't tell.

We need a **third layer** that provides trust-minimized timestamping: a single 32-byte fingerprint published somewhere no single party controls, proving "at block height H, this exact set of records existed."

Three EU regulations make this specifically valuable for Relowa:

- **CSRD** (Corporate Sustainability Reporting Directive): requires verifiable supply-chain emissions data. A blockchain-anchored hash lets auditors verify that a `material_recovery_certificate` was issued at a specific time and not retroactively created.
- **ESPR** (Ecodesign for Sustainable Products Regulation): requires a digital product passport with auditable provenance. Our Merkle structure maps directly to this.
- **WSR** (Waste Shipment Regulation): requires auditable cross-border waste tracking. The same audit trail satisfies this.

This is not a blockchain product. It is a **compliance primitive** — the cheapest, simplest way to get an immutable timestamp into a regulatory filing.

## Decision

**We anchor a daily Merkle root to Arbitrum One** via a scheduled Lambda. The chain serves one purpose: timestamping. No business logic, no tokens, no DeFi, no custom smart contracts beyond a single `recordRoot(bytes32)` call.

### What is anchored

Once per day, the anchor Lambda:

1. Computes a Merkle tree over all `audit_events` rows inserted in the last 24 hours.
2. Computes a Merkle tree over all `material_recovery_certificates` created in the last 24 hours.
3. Computes a combined Merkle root: `sha256(audit_tree.root || cert_tree.root)`.
4. Calls a pre-deployed `Anchor` contract on Arbitrum One: `record(bytes32 root)` → emits `RootRecorded(bytes32 indexed root, uint256 indexed blockNumber, uint256 timestamp)`.

The `Anchor` contract is deployed once, is non-upgradeable, and has no other functions. Gas costs approximately $0.01/day at Arbitrum One's current rates (~0.1 Gwei L2, ~$0.0001/call).

### How verification works

Any third party (auditor, regulator, customer) can:

1. Obtain the Merkle root from the Arbitrum block explorer (or an RPC call) for a given date.
2. Request the supporting `audit_events` rows from Relowa's API for that date (with org-scoped access controls — the auditor only sees rows relevant to them).
3. Recompute the Merkle root client-side.
4. If the recomputed root matches the on-chain root, the records are authentic and timestamped.

No Relowa-controlled server is in the verification path. The trust is in Arbitrum One → Ethereum L1 finality.

### Why not more than a Merkle root

Publishing individual event hashes on-chain would be ~100x more expensive and would risk KVKK/GDPR issues if hashing isn't considered sufficient anonymization. A single Merkle root is:

- **Constant cost** regardless of how many events were produced that day.
- **Zero data exposure** — the root reveals nothing about the underlying data.
- **Sufficient for all three regulations** — none require per-event anchoring.

## Consequences

### Positive

- **Third-party-verifiable timestamp.** An auditor needs only the on-chain root + the off-chain data. No trust in Relowa's infrastructure required.
- **Negligible cost.** ~$0.01/day ≈ $3.65/year. A rounding error.
- **EVM-compatible.** Standard tooling (ethers.js v6, Hardhat, viem) works. No new language or runtime.
- **Arbitrum One → Ethereum L1 security.** After the 7-day challenge window, the root inherits Ethereum's full economic security. This is a better audit story than "instant finality" — it acknowledges and handles adversarial scenarios.
- **Regulatory optionality.** If EU regulations evolve to require blockchain anchoring, we already have it. If they don't, we still have a useful notary primitive.

### Negative

- **New AWS service:** Lambda + EventBridge Scheduler for the daily anchor job.
- **New contract to deploy and manage** (though a one-time, read-only, single-function contract is minimal).
- **Operational dependency:** if the anchor Lambda fails silently, we have a gap. Mitigation: CloudWatch alarm on Lambda failures, and the contract emits events so we can detect gaps from the other side.

## Alternatives considered

| Chain | Decision | Rationale |
|---|---|---|
| **Polygon PoS** | Rejected | Centralized validator set, multi-sig bridge, history of reorgs. Not suitable for regulatory-grade anchoring. |
| **Ethereum L1** | Rejected | $1–5/day for storage is absurd for this use case. |
| **Base** | Viable alternative | Coinbase backing = institutional comfort. Arbitrum chosen for stronger decentralization story (DAO governance vs. single-company sequencer). |
| **Linea** | Viable alternative | zkEVM finality is mathematically provable. Younger chain, less ecosystem maturity. |
| **Optimism** | Rejected | Same tech as Base; Base has stronger institutional brand for this use case. |
| **Solana** | Rejected | Non-EVM, different developer toolchain. |
| **Gnosis** | Rejected | L1 sidechain, no Ethereum settlement. |
| **Bitcoin (OP_RETURN)** | Rejected | Better trust-root (Bitcoin's PoW), but pricier, slower, and no EVM tooling compatibility. |
| **Pure off-chain (S3 only)** | Rejected | Doesn't satisfy third-party independent verifiability requirement. |

## The Anchor contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Anchor
 * @notice Minimal trust anchor for Relowa audit data.
 *         Stores nothing but a daily Merkle root. Gas-optimized for L2.
 */
contract Anchor {
    event RootRecorded(
        bytes32 indexed root,
        uint256 indexed blockNumber,
        uint256 timestamp
    );

    address public immutable owner;

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Anchor: not owner");
        _;
    }

    /**
     * @notice Record a new Merkle root. Emits an event for off-chain indexing.
     * @param root The 32-byte Merkle root of today's audit data.
     */
    function record(bytes32 root) external onlyOwner {
        emit RootRecorded(root, block.number, block.timestamp);
    }

    /**
     * @notice Transfer ownership. Included for key rotation; contract is otherwise immutable.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Anchor: zero address");
        // Selfdestruct-like: we use a simple pattern for ownership transfer.
        // Actual implementation uses Ownable2Step from OpenZeppelin.
    }
}
```

**Deployment:** one-time via Hardhat. Address committed to this repo. The anchor Lambda's private key is stored in AWS Secrets Manager with automatic rotation.

## Migration plan

Phase 1 (current): deploy Anchor contract to Arbitrum One testnet (Sepolia-backed), write anchor Lambda, integrate with daily audit export pipeline. Switch to mainnet before Phase 1 production launch.

Phase 2+: add a Verifier Lambda that serves Merkle proofs over API, enabling auditors to verify a single event without recomputing the whole tree.

## Reference

- Arbitrum One docs: https://docs.arbitrum.io
- Merkle tree construction: standard binary Merkle tree, SHA-256 leaves, OpenZeppelin MerkleProof for verification.
- Related ADRs: [[0001-postgres-as-system-of-record]], [[0002-supabase-realtime-standalone]] (being superseded)
- Related concepts: [[../../memory/concepts/audit-hash-chain]], [[../../memory/concepts/hash-anchoring]]
