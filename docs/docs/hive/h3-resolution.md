---
sidebar_position: 3
title: H3 Resolution Reference
---

# H3 Resolution Reference

The GEIANT Hive scheduler uses H3 hexagonal cells to group devices into geographically-coherent inference clusters. Understanding resolutions helps you predict latency, throughput, and the scheduler's fallback behaviour.

## Why geographic proximity matters

Transformer inference is not embarrassingly parallel. Layers are sequential — layer *n+1* cannot start until layer *n* completes and its hidden state vector (8 KB at FP16 for a 4096-dim model) arrives at the next device. Each inter-shard network hop adds latency. For a 32-layer model sharded across 4 devices, that latency is paid 31 times per token.

| Topology | Latency/hop | Cumulative overhead (32 layers) |
|----------|-------------|--------------------------------|
| Intercontinental (random) | ~150 ms | ~4,650 ms/token |
| Res-5 city swarm | ~10 ms | ~310 ms/token |
| Res-6 district swarm | ~5 ms | ~155 ms/token |
| Res-7 neighbourhood swarm | ~3 ms | ~93 ms/token ✓ |

At Res-7, network overhead is ~93ms per token. At a steady-state generation speed of 22+ tok/s, the pipeline stays full and this overhead is absorbed. At intercontinental distances, network latency dominates and makes real-time inference unusable.

## Resolution tiers

### Resolution 7 — Neighbourhood (~5 km²)

**Default scheduler target.**

| Property | Value |
|----------|-------|
| Cell area | ~5.16 km² |
| Typical scope | University campus, office park, city block |
| Inter-shard latency | < 3 ms |
| Steady-state generation | ~22 tok/s (8B model, 4 devices) |
| Typical node count | 10–100 devices |
| Inference mode | Real-time and batch |

The scheduler always tries Res-7 first. If the target cell has insufficient registered workers for the requested model and trust tier, it expands to Res-6.

**Use cases:** Chatbots, agent API calls, live streaming, tensor parallelism.

### Resolution 6 — District (~36 km²)

**First fallback from Res-7.**

| Property | Value |
|----------|-------|
| Cell area | ~36.13 km² |
| Typical scope | Trastevere, Shoreditch, Berlin-Mitte |
| Inter-shard latency | 1–5 ms |
| Steady-state generation | ~18 tok/s (8B model, 4 devices) |
| Typical node count | 50–500 devices |
| Inference mode | Real-time and batch |

**Use cases:** Same as Res-7, slightly higher first-token latency due to wider geographic spread.

### Resolution 5 — Metro area (~253 km²)

**Second fallback. Batch inference only.**

| Property | Value |
|----------|-------|
| Cell area | ~253.07 km² |
| Typical scope | Entire Rome, Berlin, Tokyo metro |
| Inter-shard latency | 1–10 ms |
| Steady-state generation | ~8–14 tok/s (8B model, 4 devices) |
| Typical node count | 200–2,000 devices |
| Inference mode | Batch only |

At Res-5 the inter-shard latency variability (~10ms) is too high for real-time inference (first-token latency becomes unpredictable). Batch workloads are unaffected — only throughput matters there, not latency.

**Use cases:** Document processing, bulk classification, embedding generation, offline analysis.

## Scheduler fallback logic

```
Request arrives with h3_cell (Res-7)
    │
    ▼
Eligible workers in cell? ──No──→ Expand to parent Res-6 cell
    │                                      │
   Yes                            Eligible workers? ──No──→ Expand to Res-5
    │                                      │
    ▼                                     Yes
Claim job                         Claim job
```

"Eligible" means: registered, heartbeat within 90s, trust tier ≥ requested minimum, model cached locally.

## Cell lookup

To find the H3 cell for a lat/lng coordinate:

```javascript
import { latLngToCell } from 'h3-js';

// Rome city centre
const cell = latLngToCell(41.8919, 12.5113, 7);
// → '861e8050fffffff'

// Same point at different resolutions
latLngToCell(41.8919, 12.5113, 6); // → '861e8053fffffff' (larger)
latLngToCell(41.8919, 12.5113, 5); // → '851e8053fffffff' (larger still)
```

The worker CLI uses IP geolocation to determine the device's cell automatically on join.

## Jurisdiction binding

Delegation certificates can restrict inference to specific H3 cells:

```json
{
  "h3_cells": ["861e8050fffffff", "861e8053fffffff"],
  "jurisdiction": "EU",
  "model": "phi-3-mini",
  "min_trust_tier": "trusted"
}
```

The scheduler enforces this constraint at Pod assembly time — before any data moves. This is the structural basis for GDPR data residency compliance. See [API Reference — jurisdiction headers](./api-reference#jurisdiction-headers).
