---
sidebar_position: 1
---

# GEIANT Hive

**Geospatial compute fabric. One API. One token. One proof.**

GEIANT Hive is Layer 4 of the GNS Protocol stack. It is not an AI inference network — it is a geospatial compute fabric where every job has a location, an identity, a proof, and a payment.

AI inference was the first compute type. Map tile rendering is the second. Satellite imagery processing is the third. They all share the same settlement, the same proof layer, and the same worker infrastructure. The most valuable jobs combine multiple compute types in a single atomic operation.

## How it fits in the stack

```
Layer 4 — GEIANT Hive              ← this section
  Unified compute, settlement, swarm

   DB  — MobyDB
  Audit storage, Merkle proofs, epoch chains

Layer 3 — GNS Human Identity
  Proof-of-Trajectory, breadcrumbs, trust tiers

Layer 2 — GNS-AIP
  Agent Identity Protocol, Proof-of-Jurisdiction

Layer 1 — GEP (Geographic Addressing)
  569 trillion addressable points

Layer 0 — H3 Hexagonal Grid
  Geospatial indexing foundation
```

## Compute types

Every Hive job goes through one endpoint: `POST /v1/compute`. The worker declares what it can compute when it registers with the swarm.

| Type | Runtime | Status |
|------|---------|--------|
| **Inference** | llama.cpp + Groq backbone (Llama 3.3 70B) | **Live** |
| **Tile Rendering** | MapLibre proxy (5 styles, MapLibre-compatible) | **Live** |
| **Satellite Imagery** | Sentinel-2 via Element84 STAC API | **Live** |
| **Sensor Fusion** | IoT aggregation (Terna use case) | Planned Q3 2026 |

## Unified Compute API

One endpoint handles all compute types. Steps can reference outputs of previous steps via `depends_on`, forming a Directed Acyclic Graph (DAG):

```bash
curl -X POST https://gns-browser-production.up.railway.app/v1/compute \
  -H "Content-Type: application/json" \
  -d '{
    "requester_pk": "0042d1dc...",
    "h3_cell": "871e9a0ecffffff",
    "steps": [
      {"id": "scan",    "type": "image_process", "operation": "ndvi"},
      {"id": "analyze", "type": "inference",     "depends_on": "scan",
       "messages": [{"role": "user", "content": "Analyze this NDVI data"}]},
      {"id": "map",     "type": "tile_render",   "depends_on": "analyze",
       "center_cell": "871e9a0ecffffff", "zoom": 14, "style": "satellite"}
    ]
  }'
```

Satellite scans the land. AI interprets the data. Map shows the area. **One request. One settlement. One proof.**

→ [Unified Compute API reference](/hive/unified-compute)

## MobyDB — the proof engine

Every computation writes a record to MobyDB, addressed by a three-field composite key:

```
Address = (H3 Cell, Epoch, Public Key)
```

Records accumulate within an epoch (1 hour). The auto-sealer computes a Merkle root over all record hashes and chains it to the previous epoch's root. Tamper with any record and the root changes. Tamper with any epoch and the chain breaks.

→ [MobyDB documentation](/hive/mobydb)

## Groq backbone

A Groq API backbone (Llama 3.3 70B) provides guaranteed availability when no swarm workers are online. The backbone is transparent — the proof footer shows "Groq" and the audit trail records `provider: "groq"`. As swarm density increases, jobs shift from backbone to local workers.

Live dashboard: [hive.geiant.com/audit](https://hive.geiant.com/audit)

## Worker tiers

| Tier | Hardware | Capabilities | Earnings |
|------|----------|-------------|----------|
| **Tier 1** | Any laptop (CPU) | Tiles + small inference | ~0.35 GNS/day |
| **Tier 2** | Gaming PC (RTX 3060+) | All compute types | ~8.7 GNS/day |
| **Tier 3** | Pro GPU (4090/A100) | Concurrent jobs, large scenes | ~25+ GNS/day |

Even a Tier 1 worker (any MacBook) can earn GNS tokens by rendering and caching map tiles. No GPU required.

## What Hive is not

- **Not a training platform.** Hive is inference, rendering, and processing — not model training.
- **Not centralized cloud.** Workers are community devices registered in H3 cells, not rented VMs.
- **Not inference-only.** Unlike Akash, Render, or Groq, Hive combines AI + maps + imagery in one atomic job with cryptographic proof.

## Next steps

- [Unified Compute API](/hive/unified-compute)
- [Tile Rendering](/hive/tile-rendering)
- [Satellite Imagery](/hive/satellite-imagery)
- [MobyDB](/hive/mobydb)
- [Worker CLI](/hive/worker-cli)
