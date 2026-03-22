---
sidebar_position: 2
title: Audit Trail
---

# Audit Trail — Virtual Breadcrumb Chain

The audit trail is GEIANT's core compliance mechanism. Every agent operation produces a **virtual breadcrumb** — a signed, hash-chained record that proves what happened, where, when, and under whose authority.

## Block Structure

Each breadcrumb block contains:

```typescript
interface VirtualBreadcrumbBlock {
  index: number;                    // Sequential block number
  identity_public_key: string;      // Agent Ed25519 PK (64 hex)
  timestamp: string;                // ISO 8601 UTC
  location_cell: string;            // H3 cell — jurisdictional binding
  location_resolution: number;      // H3 resolution (typically 5)
  context_digest: string;           // SHA-256 of tool input + output
  previous_hash: string | null;     // null for genesis block
  meta_flags: AgentMetaFlags;       // Tool duration, I/O hashes, tier
  signature: string;                // Ed25519 signature (128 hex)
  block_hash: string;               // SHA-256 of (dataToSign + signature)
  delegation_cert_hash: string;     // SHA-256 of governing delegation cert
  tool_name: string;                // MCP tool that fired
  facet: string;                    // Capability scope
}
```

## Hash Chain

Blocks are SHA-256 chained. Each block's `previous_hash` field contains the `block_hash` of the preceding block. The genesis block (index 0) has `previous_hash: null`.

```
Block #0                    Block #1                    Block #2
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│ prev_hash: null  │       │ prev_hash: H(#0) │       │ prev_hash: H(#1) │
│ data...          │──────►│ data...          │──────►│ data...          │
│ signature        │       │ signature        │       │ signature        │
│ block_hash: H(#0)│       │ block_hash: H(#1)│       │ block_hash: H(#2)│
└──────────────────┘       └──────────────────┘       └──────────────────┘
```

**Tamper detection**: Modify any field in Block #1 and its `block_hash` changes. Block #2's `previous_hash` no longer matches → chain verification fails for every subsequent block.

## Context Digest

The `context_digest` field is a double hash of the tool's input and output:

```
input_hash  = SHA-256(canonical_json(tool_input))
output_hash = SHA-256(canonical_json(tool_output))
context_digest = SHA-256(input_hash + ":" + output_hash)
```

This proves what data the tool processed without storing the actual data in the audit trail — privacy-preserving by design.

## Signing

Every block is Ed25519-signed by the agent. The signing payload is the canonical JSON of all block fields (excluding `signature` and `block_hash`). Anyone with the agent's public key can verify the signature offline.

```
data_to_sign = canonical_json({
  index, identity, timestamp, loc_cell, loc_res,
  context, prev_hash, meta, delegation_cert_hash,
  tool_name, facet
})
signature = Ed25519.sign(data_to_sign, agent_secret_key)
block_hash = SHA-256(data_to_sign + ":" + signature)
```

## Epoch Rollups

Breadcrumbs accumulate. For long-running agents, verifying thousands of individual blocks is expensive. **Epochs** solve this by Merkle-rolling blocks into compact summaries:

```typescript
interface AgentEpochSummary {
  epoch_index: number;
  agent_pk: string;
  start_block_index: number;
  end_block_index: number;
  block_count: number;
  merkle_root: string;          // Binary Merkle tree over block hashes
  previous_epoch_hash: string;  // Chain of epochs
  tools_used: string[];         // Distinct tools in this epoch
  jurisdiction_cells: string[]; // Distinct H3 cells operated in
  tier_at_close: AgentTier;
  signature: string;            // Agent signs the epoch
  epoch_hash: string;
}
```

The Merkle root is built from a binary tree over all block hashes in the epoch. This allows proving that a specific block was included in an epoch without revealing all other blocks (Merkle proof).

## Verification Levels

| Level | What's Checked | Cost |
|-------|---------------|------|
| **Block** | Signature valid, hash matches | O(1) per block |
| **Chain** | All blocks linked, no gaps, timestamps monotonic | O(n) |
| **Epoch** | Merkle root valid, epoch chain linked | O(log n) per proof |
| **Full** | Chain + delegation cert valid + jurisdiction checks | O(n) |

## Storage

Breadcrumbs are stored in Supabase PostgreSQL with PostGIS extensions. The `agent_breadcrumbs` table has Row Level Security: service role has full access, anon role has read-only access (public verifiability).

```sql
SELECT block_index, tool_name, location_cell, block_hash, created_at
FROM agent_breadcrumbs
WHERE agent_pk = 'c14094ea7efb6122...'
ORDER BY block_index DESC
LIMIT 10;
```
