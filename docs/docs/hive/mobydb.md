---
sidebar_position: 6
---

# MobyDB

**Geospatial-native audit storage. Every computation writes a record. Epoch-sealed Merkle proofs.**

MobyDB is the storage and proof engine for Hive. It runs embedded in every worker (SQLite) and syncs to a central Supabase instance for global queryability.

## Addressing

Every record is addressed by a three-field composite key:

```
Address = (H3 Cell, Epoch, Public Key)
```

| Field | Meaning |
|-------|---------|
| **H3 Cell** | WHERE it happened |
| **Epoch** | WHEN it happened (1-hour windows) |
| **Public Key** | WHO computed it |

This addressing scheme mirrors the physical reality of the computation. Location IS the primary key.

Point lookup: **0.01ms** (proven by benchmark at [mobydb.com](https://mobydb.com)).

## Record types

| Collection | Payload Type | Written When |
|------------|-------------|--------------|
| **Inference** | `hive/inference` | After every AI inference |
| **Tile** | `tile/vector` or `tile/raster` | After every tile render or cache serve |
| **ComputeJob** | `compute/job` | After a compound job completes |
| **Imagery** | `imagery/ndvi` | After satellite image processing |
| **Breadcrumb** | `gns/breadcrumb` | Human trajectory point |
| **Telemetry** | `iot/telemetry` | IoT sensor reading (future) |

## Epoch sealing

Records accumulate within an epoch (1 hour). When the epoch ends, the auto-sealer:

1. Collects all record hashes from the epoch
2. Builds a Merkle tree (SHA-256 binary tree)
3. Computes the Merkle root
4. Chains the root to the previous epoch's root
5. Stores the seal locally and syncs to central

```
Epoch 3253: Merkle(rec₁, rec₂, ..., recₖ) → Root₃₂₅₃

Epoch 3254: Merkle(records...) + chain(Root₃₂₅₃) → Root₃₂₅₄

Epoch 3255: Merkle(records...) + chain(Root₃₂₅₄) → Root₃₂₅₅
```

**Tamper with any record → the Merkle root changes.**
**Tamper with any epoch → the chain breaks.**
**Verification is O(log n) and requires no trust in any central authority.**

The current epoch counter is observable in the `X-Hive-Epoch` header on any tile response (see [Tile Rendering](/hive/tile-rendering)) and advances continuously.

## Merkle tree structure

```
          ┌──────────┐
          │  ROOT    │  ← Epoch seal (amber)
          │ H(ab|cd) │
          └────┬─────┘
         ┌─────┴─────┐
    ┌────┴────┐ ┌────┴────┐
    │  H(ab)  │ │  H(cd)  │  ← Inner hashes (green)
    └────┬────┘ └────┬────┘
    ┌──┴──┐    ┌──┴──┐
  ┌─┴─┐ ┌─┴─┐ ┌─┴─┐ ┌─┴─┐
  │ A │ │ B │ │ C │ │ D │  ← Records (cyan)
  └───┘ └───┘ └───┘ └───┘
  Infer  Tile  NDVI  Job
```

Each leaf is the SHA-256 hash of a compute record. Pairs are hashed together up the tree. The root is the epoch seal.

## External anchoring to Stellar (v0.6 roadmap)

The internal Merkle-DAG above is operational today. External anchoring to Stellar — the mechanism that makes the audit chain verifiable against an untrusted public ledger rather than against the GEIANT operator's signing keys alone — is on the v0.6 roadmap.

The intended mechanism is a periodic transaction from a dedicated operator account that writes each sealed epoch's 32-byte Merkle root via a Stellar `manage_data` operation, with the operation's data-entry key encoding the epoch identifier (e.g., `epoch:3253`) and the value carrying the root itself. Stellar's native `manage_data` semantics — 64-byte keys, 64-byte values, stored in the account's persistent data — fit the Merkle-root anchoring use case directly without requiring a custom contract.

Until Stellar anchoring ships in v0.6, tamper-evidence rests on the GEIANT operator's signing keys rather than on an external blockchain. This limitation is explicit and is the primary reason v0.6 is the earliest release that meaningfully claims EU AI Act Article 12 compliance.

→ [Roadmap §12.2](/hive/roadmap) for the deployment window.

## Standards alignment — IETF TrIP draft

MobyDB's breadcrumb format, epoch structure, and Ed25519-keyed identity model are formalized as an open standard in the IETF Internet-Draft *Trajectory-based Recognition of Identity Proof (TrIP)*, co-authored with TU Dresden and submitted to the RATS working group:

→ [datatracker.ietf.org/doc/draft-ayerbe-trip-protocol/04](https://datatracker.ietf.org/doc/draft-ayerbe-trip-protocol/04/)

The draft specifies the CBOR-encoded breadcrumb format, append-only chain semantics, Merkle-rooted epoch structure, and verification procedures. MobyDB is the first deployed instantiation of TrIP-compatible primitives. The longer-term goal is that the audit-chain pattern outlives any single operator — any conformant verifier implementing the TrIP spec can validate MobyDB records and epoch seals.

## Proof verification

Any party can verify a computation:

```
GET /mobydb/proof/{record_id}
```

**Response:**

```json
{
  "record": { "id": "...", "record_hash": "a7f3...", "collection_type": "Inference", ... },
  "seal": { "epoch": 3253, "merkle_root": "cec9...", "prev_epoch_hash": "4db2..." },
  "verified": true
}
```

The proof includes the record hash, the epoch's Merkle root, and the path from the record to the root. The verifier recomputes the path and checks that it reaches the sealed root.

## API endpoints

### Worker → Central sync

```
POST /mobydb/sync
```

Workers push batches of local records to the central server every 30 seconds.

```json
{ "records": [{ "id": "...", "address": {...}, "collection_type": "Inference", ... }] }
```

### Epoch seal sync

```
POST /mobydb/epochs
```

Workers push epoch seals after auto-sealing.

### Global query

```
GET /mobydb/query?cell={h3}&epoch_start={n}&epoch_end={n}&collection={type}&limit={n}
```

Query records across all workers.

### Proof verification

```
GET /mobydb/proof/{record_id}
```

Returns the record, epoch seal, and verification status.

## Storage

**Worker (embedded):** SQLite at `~/.hive/mobydb/records.db` (WAL mode, `<0.1ms` writes)

**Central (synced):** Supabase PostgreSQL tables `hive_mobydb_records` + `hive_epoch_seals`

## Dashboard

Live inference audit trail at [hive.geiant.com/audit](https://hive.geiant.com/audit) — auto-refreshes every 10 seconds, shows all compute jobs with provider, model, tokens, latency, epoch, and job hash.
