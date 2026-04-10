---
sidebar_position: 5
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
Epoch 2335: Merkle(rec₁, rec₂, ..., recₖ) → Root₂₃₃₅

Epoch 2336: Merkle(records...) + chain(Root₂₃₃₅) → Root₂₃₃₆

Epoch 2337: Merkle(records...) + chain(Root₂₃₃₆) → Root₂₃₃₇
```

**Tamper with any record → the Merkle root changes.**
**Tamper with any epoch → the chain breaks.**
**Verification is O(log n) and requires no trust in any central authority.**

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

## Proof verification

Any party can verify a computation:

```
GET /mobydb/proof/{record_id}
```

**Response:**

```json
{
  "record": { "id": "...", "record_hash": "a7f3...", "collection_type": "Inference", ... },
  "seal": { "epoch": 2337, "merkle_root": "cec9...", "prev_epoch_hash": "4db2..." },
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
