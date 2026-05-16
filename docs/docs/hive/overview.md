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
| **Inference** | llama.cpp (LFM2.5-1.2b-instruct default) + Groq backbone (Llama 3.3 70B fallback) | **Live** |
| **Tile Rendering** | MapLibre proxy (5 styles, MapLibre-compatible) | **Live** |
| **Satellite Imagery** | Sentinel-2 via Element84 STAC API + IBM Prithvi (Earth Observation MCP) | **Live** |
| **Sensor Fusion** | IoT aggregation (Terna use case) | Planned Q3 2026 |

The default inference model is **LFM2.5-1.2b-instruct** from Liquid AI, served via llama.cpp build `b6709` at ~180–240 tokens/second on M-series Apple Silicon. The Groq backbone (Llama 3.3 70B) provides guaranteed availability when no swarm worker is currently online. Earth Observation foundation models (currently IBM Prithvi-EO-2.0) are exposed as MCP tools and callable from MCP-aware clients (Claude Desktop, Cursor) via the GEIANT Perception MCP server.

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

## The four router gates

Every request to any Hive compute endpoint — `/v1/compute`, `/v1/chat/completions`, `/v1/tiles`, `/v1/imagery` — passes through four enforcement gates at the GNS-AIP layer before any compute is dispatched:

1. **Signature verification** — Ed25519 signature over canonical request JSON
2. **Jurisdiction resolution** — H3 cell → country → regulatory framework (GDPR, EU AI Act, FINMA, …)
3. **Delegation chain validation** — agent's delegation cert traced to a human principal
4. **Geometry pre-flight** — GEOS-backed checks for any geometric primitives in the payload

The gates are sequential. A request that fails any one is rejected without invoking the next. They are implemented at request entry, not per-endpoint, which means a new endpoint inherits them automatically. This is the structural basis for the EU AI Act Article 12/14 compliance claim — the gates cannot be bypassed.

The four-gate router is a separately patentable claim (Proof-of-Jurisdiction, patent claim #2 extending the GNS Proof-of-Trajectory base patent USPTO Provisional #63/948,788).

## MobyDB — the proof engine

Every computation writes a record to MobyDB, addressed by a three-field composite key:

```
Address = (H3 Cell, Epoch, Public Key)
```

Records accumulate within an epoch (1 hour). The auto-sealer computes a Merkle root over all record hashes and chains it to the previous epoch's root. Tamper with any record and the root changes. Tamper with any epoch and the chain breaks.

→ [MobyDB documentation](/hive/mobydb)

## Standards engagement

The breadcrumb format, epoch structure, and Ed25519-keyed identity model that Hive instantiates are formalized as an open standard in the IETF Internet-Draft *Trajectory-based Recognition of Identity Proof (TrIP)*, co-authored with TU Dresden and submitted to the RATS working group:

→ [datatracker.ietf.org/doc/draft-ayerbe-trip-protocol/04](https://datatracker.ietf.org/doc/draft-ayerbe-trip-protocol/04/)

The whitepaper describes a deployed system; the IETF draft describes the open standard. Hive is the first deployed instantiation of TrIP-compatible primitives.

## Groq backbone

A Groq API backbone (Llama 3.3 70B) provides guaranteed availability when no swarm workers are online. The backbone is transparent — the proof footer shows "Groq" and the audit trail records `provider: "groq"`. As swarm density increases, jobs shift from backbone to local workers.

Live dashboard: [hive.geiant.com/audit](https://hive.geiant.com/audit)

## Worker tiers

| Tier | Hardware | Capabilities | Earnings |
|------|----------|-------------|----------|
| **Tier 1** | Any laptop (CPU) | Tiles + small inference (LFM2.5, TinyLlama) | ~0.35 GNS/day |
| **Tier 2** | Gaming PC (RTX 3060+) | All compute types | ~8.7 GNS/day |
| **Tier 3** | Pro GPU (4090/A100) | Concurrent jobs, large scenes | ~25+ GNS/day |

Even a Tier 1 worker (any MacBook) can earn GNS tokens by rendering and caching map tiles, or running LFM2.5-1.2b-instruct (~750 MB on disk at Q4_K_M). No high-end GPU required.

## What Hive is not

- **Not a training platform.** Hive is inference, rendering, and processing — not model training.
- **Not centralized cloud.** Workers are community devices registered in H3 cells, not rented VMs.
- **Not inference-only.** Unlike Akash, Render, or Groq, Hive combines AI + maps + imagery in one atomic job with cryptographic proof.

## Next steps

- [Quick Start](/hive/quick-start)
- [Unified Compute API](/hive/unified-compute)
- [Tile Rendering](/hive/tile-rendering)
- [Satellite Imagery](/hive/satellite-imagery)
- [MobyDB](/hive/mobydb)
- [H3 Resolution Reference](/hive/h3-resolution)
- [Worker CLI](/hive/worker-cli)
- [API Reference](/hive/api-reference)
- [Roadmap](/hive/roadmap)
