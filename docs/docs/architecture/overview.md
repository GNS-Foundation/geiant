---
sidebar_position: 1
title: Architecture Overview
---

# Architecture Overview

GEIANT is a four-layer stack. Each layer is independently useful, but the power comes from their composition — identity is grounded in geography, jurisdiction is enforced by delegation, and every operation is cryptographically chained.

## The Four Layers

```
┌─────────────────────────────────────────────┐
│  Layer 3 — Perception Runtime               │
│  Satellite tiles, weather, embeddings       │
│  MCP-native tools, GPU inference            │
├─────────────────────────────────────────────┤
│  Layer 2 — Agent Identity Protocol          │
│  Ed25519 identity, delegation certificates  │
│  Breadcrumb chains, trust tiers, compliance │
├─────────────────────────────────────────────┤
│  Layer 1 — GEP (Geographic Addressing)      │
│  569 trillion addressable points            │
│  Open infrastructure, no token gate         │
├─────────────────────────────────────────────┤
│  Layer 0 — H3 Hexagonal Grid               │
│  Uber's geospatial indexing system          │
│  Resolution 0–15, hierarchical              │
└─────────────────────────────────────────────┘
```

### Layer 0 — H3 Grid

The foundation is Uber's [H3 hexagonal hierarchical spatial index](https://h3geo.org/). H3 divides the Earth's surface into hexagonal cells at 16 resolutions (0–15). GEIANT uses:

- **Resolution 5** (~253 km²) for jurisdictional boundaries in delegation certificates
- **Resolution 7** (~5.16 km²) for agent territorial binding
- **Resolution 10** (~0.015 km²) for precise operation logging

H3 cells are deterministic, compact (64-bit integer), and support parent/child/neighbor traversal — ideal for jurisdiction checks that need to run in microseconds.

### Layer 1 — GEP (GeoEpoch Protocol)

GEP provides geographic addressing at planetary scale. At resolution 15, GEP offers approximately 569 trillion unique addressable points — more than enough to assign an address to every square meter of Earth's surface.

GEP is **open infrastructure** with no token monetization at this layer. It serves the same role as IP addressing: a shared coordinate system that everything above depends on.

### Layer 2 — Agent Identity Protocol

This is where GEIANT's core value lives. The Agent Identity Protocol provides:

**Ed25519 Identity** — Every agent gets a cryptographic keypair. The public key is the identity. No registry, no username, no OAuth token. The same key signs breadcrumbs, delegation certificates, and Stellar transactions.

**Delegation Certificates** — A human principal signs a certificate authorizing an agent to operate within specific H3 cells, using specific capabilities (facets), for a specific time period. Certificates are verified offline — no server round-trip needed.

**Virtual Breadcrumbs** — Every tool call produces a signed, SHA-256-chained breadcrumb recording what happened, where, when, and under whose authority. The chain is append-only and tamper-evident.

**Trust Tiers** — Agents progress through five tiers (Provisioned → Observed → Trusted → Certified → Sovereign) based on operational history. Each tier unlocks additional capabilities.

**Epoch Rollups** — Breadcrumbs are periodically Merkle-rolled into epochs — compact summaries with a Merkle root over all block hashes in the period. This enables efficient long-term auditing.

### Layer 3 — Perception Runtime

The perception layer provides MCP-native tools for geospatial AI:

- **perception_fetch_tile** — Fetch Sentinel-2 L2A satellite tiles via STAC API
- **perception_classify** — Run EO foundation models (Prithvi-EO-2.0) for flood/land-use classification
- **perception_embed** — Generate Clay v1.5 geospatial embeddings (planned)
- **perception_weather** — Historical + forecast weather via Open-Meteo ERA5

Every perception tool call is automatically wrapped by the audit middleware — a breadcrumb is dropped with jurisdiction and delegation checks enforced before execution.

## Data Flow

A typical agent operation flows through all four layers:

```
1. Agent receives task: "Check flood risk for Rome grid cell"
2. Layer 2: Preflight check
   ├── Is delegation certificate still valid? ✅
   ├── Is H3 cell within authorized territory? ✅
   ├── Is 'energy' facet authorized? ✅
   └── Is tool whitelisted? ✅
3. Layer 3: Execute perception_weather(851e8053fffffff)
4. Layer 2: Drop breadcrumb
   ├── SHA-256 context digest of tool input + output
   ├── Chain to previous block hash
   ├── Ed25519 sign the block
   └── Write to Supabase
5. Agent returns result to orchestrator
```

## Cryptographic Guarantees

| Property | Mechanism |
|----------|-----------|
| **Identity** | Ed25519 keypair — no central registry |
| **Authorization** | Delegation certificate signed by human principal |
| **Immutability** | SHA-256 hash chain — tamper with one block, all subsequent blocks invalid |
| **Non-repudiation** | Ed25519 signature on every breadcrumb |
| **Jurisdiction** | H3 cell checked against delegation certificate pre-flight |
| **Auditability** | Merkle-rolled epochs with compliance report generation |

## Deployment Architecture

```
┌──────────────┐     SSE/MCP      ┌─────────────────────┐
│  AI Client   │ ◄──────────────► │  mcp-perception     │
│  (Claude,    │                  │  Railway (Node.js)   │
│   LangChain) │                  │  Port 8080           │
└──────────────┘                  └──────┬──────────────┘
                                         │
                    ┌────────────────────┼────────────────┐
                    │                    │                 │
              ┌─────▼──────┐     ┌──────▼──────┐   ┌─────▼──────┐
              │ Supabase   │     │ RunPod GPU  │   │ Open-Meteo │
              │ PostgreSQL │     │ RTX A40     │   │ ERA5 API   │
              │ + PostGIS  │     │ Prithvi-EO  │   │            │
              └────────────┘     └─────────────┘   └────────────┘
```

The `mcp-perception` service runs on Railway, exposes SSE for MCP clients, and writes audit data to Supabase. GPU inference runs on RunPod serverless endpoints.
