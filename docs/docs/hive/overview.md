---
sidebar_position: 1
title: Hive Overview
---

# GEIANT Hive

**Community-powered distributed AI inference. H3-coherent. GNS-settled.**

GEIANT Hive is Layer 4 of the GEIANT stack. It turns idle community devices — laptops, desktops, phones — into a geographically-coherent inference network. Workers register their hardware in an H3 cell, claim inference jobs atomically from a Postgres queue, execute model shards locally, and receive GNS tokens on Stellar mainnet.

## How it fits in the stack

```
Layer 4 — GEIANT Hive          ← this section
  Community swarm, job queue, GNS settlement

Layer 3 — Perception Runtime
  Satellite tiles, weather, embeddings

Layer 2 — Agent Identity Protocol
  Ed25519 identity, delegation certs, breadcrumbs

Layer 1 — GEP (Geographic Addressing)
  569 trillion addressable points

Layer 0 — H3 Hexagonal Grid
  Geospatial indexing foundation
```

Hive inherits all four layers below it. A Hive worker has an Ed25519 identity (L2), is located in an H3 cell (L0/L1), and settles payments on Stellar using the same keypair (L2). The compliance report for a Hive inference session is a L2 breadcrumb chain.

## Key concepts

**Geospatial Pod** — A virtual inference endpoint assembled from idle devices within a specific H3 cell cluster. The customer hits an OpenAI-compatible API endpoint; the swarm is transparent.

**H3 coherence** — The scheduler routes jobs to devices in the same H3 cell. At Resolution 7 (~5 km²), inter-shard network latency is below 3ms — low enough for pipeline-parallel transformer inference. See [H3 Resolution Reference](./h3-resolution).

**Atomic claiming** — Workers poll a Postgres `hive_jobs` table every 5 seconds. Job claiming uses `FOR UPDATE SKIP LOCKED` — a Postgres pattern that guarantees exactly-once assignment with no application-level locking and no race conditions, even under high concurrency.

**GNS settlement** — On job completion, GNS tokens are distributed on Stellar mainnet via a 60/25/10/5 split. The worker earns 60% of the job's `gns_reward`. Settlement is async; the worker's `tokens_earned` balance is updated immediately via an atomic Postgres increment.

## Revenue split

Every inference job distributes GNS automatically:

| Slice | Recipient | Purpose |
|-------|-----------|---------|
| 60% | Community node operators | Weighted by trust tier and thermal stability |
| 25% | GEIANT / ULISSY s.r.l. | Orchestration, scheduler, API gateway |
| 10% | Hydration & Resilience Fund | Seeding bonuses for new H3 cells |
| 5% | Sovereign Quorum | BFT coordinator fee |

No tokens are burned. All GNS stays in circulation.

## Three access patterns

| Pattern | Who | Entry point |
|---------|-----|-------------|
| Consumer | GCRUMBS app users | Send a message to @hai |
| Developer | Any app or script | `POST /v1/chat/completions` |
| Enterprise | Organisations with private clusters | MDM-deployed workers + API key |

## What Hive is not

- **Not a training platform.** Training requires backward passes and gradient synchronization across all parameters simultaneously — a use case where dedicated A100s win decisively. Hive is inference only.
- **Not suitable for sub-100ms first-token requirements.** Pipeline fill (the first token) takes one full pass through all devices. At Res-7 with 4 devices this is ~180ms. Subsequent tokens flow at the pipeline's steady-state rate.
- **Not a replacement for 70B+ models on a single device.** Very large models require 30+ devices in one cell. At current network density this is only viable in dense Res-5 (city-scale) swarms.

## Next steps

- [Quick Start — join the swarm in 5 minutes](./quick-start)
- [Worker CLI reference](./worker-cli)
- [H3 Resolution reference](./h3-resolution)
- [API reference](./api-reference)
