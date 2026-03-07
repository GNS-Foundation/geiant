# 🐜 GEIANT

**Geo-Identity Agent Navigation & Tasking**

> *The first AI orchestrator that knows where it is.*

---

## What is GEIANT?

GEIANT is a geospatial AI agent orchestration runtime built on the [GNS Protocol](https://gcrumbs.com). It is a direct competitor to LangChain, CrewAI, and AutoGen — with one structural difference: **every agent has a cryptographic identity bound to an H3 territory, and every task is routed through a compliance enforcement layer before dispatch.**

LangChain doesn't know where it is. GEIANT does.

---

## The Ant Metaphor

In GEIANT, agents are **ants**. Ants are the canonical model of emergent collective intelligence from simple agents following spatial rules. Ant Colony Optimization (ACO) is a real algorithm used in routing and pathfinding. The colony is the orchestrated workflow. The territory is the H3 grid.

- An **ant** (`AntIdentity`) is an agent with a GNS Ed25519 keypair + H3 territory + facet scope + trust tier
- The **colony** is a multi-agent workflow where ants delegate and collaborate
- The **nest** is the Agent Registry — the directory of available ants
- The **trail** is the Virtual Breadcrumb chain — the Proof-of-Jurisdiction audit log

---

## Architecture

```
L6  Multi-Agent Orchestration    — task graph, delegation chain enforcement
L5  IDUP Settlement Layer        — Stellar payment routing per operation  
L4  MCP GIS Switchboard          — GDAL / PostGIS / ArcGIS / QGIS / EO models
L3  Perception Layer             — IBM Prithvi, Microsoft Clay (EO Foundation Models)
L2  Geometry Validation Layer    — GEOS-backed guardrails, self-intersection detection
L1  Geospatial Router            — H3 jurisdiction matching, TierGate enforcement
L0  Agent Identity & Registry    — Ed25519 + H3 + GNS-AIP (LIVE in gns-node)
```

**Phase 0** (this repo): L0 + L1 + L2 core logic, tests, and API scaffold.

---

## Monorepo Structure

```
geiant/
├── packages/
│   ├── core/          @geiant/core — types, router, validation, registry, jurisdiction
│   └── sdk/           @geiant/sdk  — developer-facing SDK (Phase 1)
├── apps/
│   └── api/           @geiant/api  — Express REST API
└── docs/              Architecture docs, ADRs
```

---

## The Four Router Gates

Every task passes through four gates before any ant is selected:

1. **Signature Verification** — Ed25519 signature over canonical task JSON
2. **Jurisdiction Resolution** — H3 cell → country → regulatory frameworks (GDPR, EU AI Act, FINMA, CCPA...)
3. **Delegation Chain Validation** — human GNS identity → delegation cert → scope cells + facets + expiry
4. **Geometry Pre-flight** — GEOS-backed validation: self-intersection, coordinate transposition, unclosed rings

Only tasks that pass all four are dispatched. The router is a compliance enforcement point, not a load balancer.

---

## Getting Started

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Start dev API
pnpm dev

# Test routing endpoint
curl http://localhost:3100/health
curl http://localhost:3100/registry
curl http://localhost:3100/jurisdiction/8728d55ffffffff   # Rome H3 cell
curl http://localhost:3100/route/test
```

---

## Competitive Position

| Feature | LangChain | CrewAI | **GEIANT** |
|---|---|---|---|
| Agent identity | API key | API key | Ed25519 GNS keypair |
| Task routing | Capability + cost | Capability + cost | **H3 jurisdiction + compliance** |
| Audit trail | Logs | Logs | **Virtual breadcrumbs (crypto)** |
| Geometry validation | None | None | **Built-in guardrails** |
| Human accountability | None | None | **Delegation chain** |
| Regulatory compliance | Manual | Manual | **Proof-of-Jurisdiction** |

---

## Patent & IP

GNS Protocol Provisional Patent #63/948,788 (Proof-of-Trajectory).  
GEIANT's Proof-of-Jurisdiction is a second patentable claim extending this.

---

## License

Protocol spec: CC-BY  
Core library: Apache 2.0  
Managed runtime: Proprietary  

GNS Foundation | Globe Crumbs Inc. | ULISSY s.r.l.  
Via Gaetano Sacchi 16, 00153 Roma | ulissy@pec.it | gcrumbs.com
