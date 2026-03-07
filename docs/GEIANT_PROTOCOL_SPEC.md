# GEIANT Protocol Specification
## Geo-Identity Agent Navigation & Tasking
### Version 0.1 | March 2026 | DRAFT

**Authors:** Camilo Ayerbe (ULISSY s.r.l. / GNS Foundation)
**Status:** Internet-Draft — Intended for IETF submission alongside TrIP RFC
**Repository:** https://github.com/GNS-Foundation/geiant

---

## Abstract

GEIANT defines a routing protocol for geospatial AI agents. A GEIANT-compliant
router accepts task requests, enforces four sequential compliance gates
(signature verification, jurisdiction resolution, delegation chain validation,
geometry pre-flight), and dispatches tasks to the highest-scoring eligible agent
in the registry. Every routing decision produces a cryptographically signed
Virtual Breadcrumb — an auditable proof of the routing event.

The core design principle: the router is a compliance enforcement point, not a
load balancer.

---

## 1. Motivation

Current AI orchestration frameworks (LangChain, CrewAI, AutoGen, Semantic
Kernel) are location-blind. They route tasks by capability and cost. They have
no mechanism to:

- Verify that an agent has territorial binding to the task's origin cell
- Enforce jurisdictional constraints before dispatch
- Produce a cryptographic audit trail linking AI actions to human authorization
- Detect and reject geometrically invalid payloads before they propagate

GEIANT fills this gap by treating geospatial identity as a protocol primitive,
not a plugin.

---

## 2. Terminology

| Term | Definition |
|---|---|
| **Ant** | A GEIANT-registered AI agent with an Ed25519 identity, H3 territory binding, and a compliance tier |
| **Task** | A routing request — a unit of work to be dispatched to an ant |
| **H3 Cell** | A hexagonal geographic cell from Uber's H3 index. GEIANT uses resolution 5 for territory binding and resolution 9 for spatial memory |
| **Jurisdiction** | The set of regulatory frameworks applicable to an H3 cell (GDPR, EU AI Act, FINMA, etc.) |
| **Delegation Certificate** | A signed document from a human GNS identity authorizing an agent to act on their behalf within specified scope |
| **Virtual Breadcrumb** | A signed, timestamped routing event — the agentic equivalent of a GPS breadcrumb |
| **TierGate** | A minimum compliance tier threshold required to handle a task |
| **Handoff** | A cross-jurisdictional routing event where no eligible ant exists in the origin cell |

### Ant Tiers (ascending compliance level)

| Tier | Description |
|---|---|
| `provisioned` | Newly registered, no operational history |
| `observed` | Has completed tasks, compliance score being built |
| `trusted` | Established compliance history, eligible for GDPR-regulated tasks |
| `certified` | Third-party attested, eligible for EU AI Act high-risk tasks |
| `sovereign` | Maximum autonomy tier — self-governed, full audit capability |

---

## 3. Data Structures

### 3.1 GeiantTask

```typescript
interface GeiantTask {
  id: string;                       // Unique task ID (e.g. "task_01HXYZ")
  originCell: H3Cell;               // H3 cell where the task originates
  requiredFacet: AntFacet;          // Required agent specialization
  minTier: AntTier;                 // Minimum compliance tier
  callerPublicKey?: string;         // Ed25519 public key of the caller (hex)
  callerSignature?: string;         // Ed25519 signature over task payload (hex)
  delegationCert: DelegationCert;   // Human authorization chain
  geometries?: GeoJSON.Feature[];   // Optional spatial payload (validated pre-dispatch)
  payload?: Record<string, unknown>; // Task-specific data
}
```

### 3.2 DelegationCert

```typescript
interface DelegationCert {
  id: string;
  humanPublicKey: string;           // GNS identity of the authorizing human
  agentPublicKey: string;           // Ed25519 public key of the authorized agent
  scopeCells: H3Cell[];             // H3 cells the agent is authorized to operate in
  scopeFacets: AntFacet[];          // Facets the agent is authorized to use
  validUntil: string;               // ISO 8601 expiry
  maxSubdelegationDepth: number;    // How many handoffs are permitted (0 = no handoff)
  issuedAt: string;
  humanSignature: string;           // Ed25519 signature from the human principal
}
```

### 3.3 HandoffRoutingDecision

```typescript
interface HandoffRoutingDecision {
  taskId: string;
  success: boolean;
  selectedAnt?: AntManifest;        // The dispatched agent (if success)
  jurisdiction?: JurisdictionResult;
  delegationValidation?: DelegationValidationResult;
  geometryValidation?: GeometryValidationResult;
  breadcrumb: VirtualBreadcrumb;    // Always present — success or failure
  routedAt: string;
  handoff?: HandoffDecision;        // Present if cross-jurisdictional handoff occurred
  geometryRepaired?: boolean;       // True if L2 self-healing was applied
  geometryRepairs?: GeometryRepairResult[];
  rejectionReason?: RoutingRejectionReason;
  rejectionDetails?: string;
}
```

### 3.4 VirtualBreadcrumb

```typescript
interface VirtualBreadcrumb {
  id: string;
  agentPublicKey: string;           // Router's or ant's Ed25519 key
  taskId: string;
  cell: H3Cell;
  eventType: BreadcrumbEventType;   // 'task_dispatched' | 'task_failed' | 'territory_boundary_crossed'
  delegationCertHash: string;       // SHA-256 of the DelegationCert
  hash: string;                     // SHA-256 of this breadcrumb (chain link)
  agentSignature: string;           // Ed25519 signature
  timestamp: string;
}
```

---

## 4. Routing Protocol

### 4.1 Four-Gate Enforcement

Every task MUST pass all four gates before dispatch. Gates are executed in order.
A failure at any gate returns a structured rejection with a VirtualBreadcrumb.

```
Task
 │
 ▼
Gate 1: Signature Verification
 │  Ed25519 signature over task payload verified against callerPublicKey.
 │  In NODE_ENV=development, stub signatures are accepted.
 │  REJECTION: signature_invalid
 ▼
Gate 2: Jurisdiction Resolution
 │  originCell → H3 centroid lat/lng → country bounding box → CountryProfile
 │  → applicable RegulatoryFrameworks
 │  REJECTION: no_jurisdiction (open ocean, invalid cell, unmapped territory)
 ▼
Gate 3: Delegation Chain Verification
 │  DelegationCert format, time window, scope cells, scope facets,
 │  subdelegation depth, humanSignature all validated.
 │  REJECTION: invalid_delegation
 ▼
Gate 4: Geometry Pre-flight
 │  All GeoJSON Features in task.geometries validated via GEOS.
 │  If invalid: L2 self-healing attempted (automated repair).
 │  If repair succeeds: task proceeds with repaired geometries.
 │  If repair fails: REJECTION: invalid_geometry
 ▼
Dispatch: Registry Lookup
    findEligibleAnts(originCell, requiredFacet, minTier)
    → Score candidates by fitness (H3 overlap + tier + compliance score)
    → Select highest-scoring ant
    → If no ant: attempt L1 Cross-Jurisdictional Handoff (scan adjacent rings)
    → If handoff succeeds: dispatch to receiving ant with HandoffCert
    → If handoff fails: REJECTION: no_eligible_ant | tier_insufficient
```

### 4.2 L1 Cross-Jurisdictional Handoff

When no eligible ant exists in the origin cell, the router scans up to 3
adjacent H3 rings for an ant in a compatible jurisdiction. A Handoff is only
issued if `delegationCert.maxSubdelegationDepth > 0`.

Compatibility rules:
- GDPR-origin tasks may only be handed off to jurisdictions with equivalent
  data protection (GDPR, UK_GDPR, SWISS_DPA, PDPA_SG)
- Health facet tasks require a health-compatible framework in the target
- Financial tasks to CH require FINMA-aware agents

A HandoffCert is issued by the router, signed with the router's Ed25519 key,
with `remainingDepth = originalDepth - 1`.

### 4.3 L2 Geometry Self-Healing

Before rejecting a task for invalid geometry, the router attempts automated
repair via the geometry repair engine (GEOS-backed). Repair operations include:
- `buffer(0)` to fix self-intersections
- Ring orientation normalization
- Coordinate precision reduction

If all geometries are successfully repaired, the task proceeds with
`geometryRepaired: true` and the repair log in `geometryRepairs`.

---

## 5. HTTP API

Base URL: `https://geiantrouter-production.up.railway.app`

### 5.1 POST /route

Route a task. Returns `200` on success, `422` on routing rejection, `400` on
malformed request.

**Request body:** `GeiantTask` (see §3.1)

**Response:**
```json
{
  "taskId": "task_01HXYZ",
  "success": true,
  "selectedAnt": {
    "handle": "infrastructure@rome-grid",
    "tier": "trusted",
    "publicKey": "a3f8b2c1d4e5f6a7...",
    "territoryCellCount": 12,
    "complianceScore": 0.94,
    "facets": ["infrastructure", "energy"]
  },
  "jurisdiction": {
    "cell": "8928308280fffff",
    "countryCode": "IT",
    "frameworks": [
      { "id": "GDPR", "name": "General Data Protection Regulation", ... },
      { "id": "EU_AI_ACT", ... }
    ],
    "dataResidency": "eu",
    "resolvedAt": "2026-03-07T17:20:19.322Z"
  },
  "breadcrumb": { ... },
  "routedAt": "2026-03-07T17:20:19.322Z"
}
```

**Rejection response (422):**
```json
{
  "taskId": "task_01HXYZ",
  "success": false,
  "rejectionReason": "no_eligible_ant",
  "rejectionDetails": "No ant found for facet 'health' in cell 8928308280fffff with tier ≥ 'certified'. Handoff also failed: No eligible ant found within 3 H3 ring(s).",
  "jurisdiction": { ... },
  "breadcrumb": { ... }
}
```

### 5.2 POST /delegate/verify

Validate a delegation certificate without routing a task.

**Request body:**
```json
{
  "cert": { ...DelegationCert },
  "task": { ...partial GeiantTask (optional, for scope checks) }
}
```

**Response:**
```json
{
  "valid": true,
  "cert": {
    "id": "cert_01HXYZ",
    "humanPublicKey": "a3f8b2c1d4e5...",
    "agentPublicKey": "9b7c4d2e1f3a...",
    "validUntil": "2026-04-07T00:00:00Z",
    "maxSubdelegationDepth": 1,
    "scopeFacets": ["infrastructure"],
    "scopeCellCount": 8
  }
}
```

### 5.3 GET /jurisdiction/:h3cell

Resolve regulatory frameworks for an H3 cell.
Optional query param: `?tier=trusted` — checks if the tier is permitted.

**Response:**
```json
{
  "cell": "8928308280fffff",
  "jurisdiction": {
    "countryCode": "IT",
    "frameworks": [ ... ],
    "dataResidency": "eu"
  },
  "operationPermitted": {
    "permitted": true
  }
}
```

---

## 6. Rejection Reasons

| Code | Meaning |
|---|---|
| `signature_invalid` | Task signature verification failed |
| `no_jurisdiction` | H3 cell cannot be resolved to a regulatory context |
| `invalid_delegation` | DelegationCert validation failed (expired, invalid sig, scope mismatch) |
| `invalid_geometry` | Geometry validation failed and L2 self-healing could not repair |
| `no_eligible_ant` | No ant in registry matches facet/cell/tier, and handoff failed |
| `tier_insufficient` | Ants exist for the facet but none meet the minTier requirement |
| `territory_mismatch` | No ant's territory covers the origin cell |

---

## 7. Jurisdiction Coverage (Phase 0)

Phase 0 uses bounding-box approximations. Phase 1 replaces with PostGIS
spatial queries against the Natural Earth world borders dataset.

| Country | Code | Frameworks |
|---|---|---|
| Italy | IT | GDPR, EU AI Act, eIDAS 2.0, Italian Civil Code |
| Germany | DE | GDPR, EU AI Act, eIDAS 2.0, NetzDG |
| France | FR | GDPR, EU AI Act, eIDAS 2.0 |
| Spain | ES | GDPR, EU AI Act, eIDAS 2.0 |
| Switzerland | CH | Swiss DPA (nDSG), FINMA |
| United Kingdom | GB | UK GDPR |
| United States | US | US EO 14110 |
| California, US | US-CA | US EO 14110, CCPA |
| Brazil | BR | LGPD |
| Singapore | SG | PDPA |

---

## 8. Relationship to GNS Protocol

GEIANT is a protocol extension of GNS (Global/Geospatial Name System).

| GNS Primitive | Human Use | GEIANT Agent Use |
|---|---|---|
| Ed25519 keypair | Identity credential | Agent identity + Ant signing key |
| H3 cell | Location privacy | Jurisdictional territory binding |
| Breadcrumbs | Physical trajectory | Virtual audit trail |
| Trust score | Humanity proof | Compliance score |
| Facets | Role separation | Capability scoping |
| Stellar wallet | P2P payments | Agent transaction settlement |
| DelegationCert | — | Human → Agent authorization |

---

## 9. Roadmap

| Phase | Deliverable | Status |
|---|---|---|
| 0 — Synthetic Data | Benchmark dataset, test suite, core routing logic | ✓ Complete |
| 1 — Agent Registry | Supabase registry, MCP PostGIS + GDAL, Railway deployment | ✓ Complete |
| 2 — GeoRouter | Standalone HTTP routing service, this specification | ▶ In progress |
| 3 — Spatial Memory | H3-indexed versioned geometry DAG, hallucination prevention | Q1 2027 |
| 4 — Perception Layer | EO Foundation Models (Prithvi, Clay) as first-class context | Q2 2027 |
| 5 — Full Runtime | Complete GEIANT runtime, IDUP settlement, multi-agent audit | Q3 2027 |

---

## 10. Security Considerations

- Private keys MUST NOT leave the signing device. The router's signing key is
  injected via `ROUTER_SIGNING_KEY` environment variable (Railway secret).
- DelegationCerts MUST be validated for temporal validity, scope containment,
  and subdelegation depth on every routing request.
- Virtual Breadcrumbs MUST be signed by the router's Ed25519 key (stub
  signatures are used in Phase 0 dev; production requires full signing).
- H3 bounding-box jurisdiction resolution (Phase 0) has known border
  inaccuracies. Phase 1 PostGIS resolution is required before production
  use in compliance-sensitive verticals.

---

## 11. IANA Considerations

This document has no IANA actions.

---

## 12. References

- GNS Protocol: https://gcrumbs.com
- TrIP Internet-Draft: IETF (filed separately)
- H3 Geospatial Index: https://h3geo.org
- USPTO Provisional Patent #63/948,788 (Proof-of-Trajectory)
- GEIANT Benchmark Dataset: https://huggingface.co/datasets/cayerbe/geiant-benchmark

---

*GNS Foundation | Globe Crumbs Inc. | ULISSY s.r.l.*
*Via Gaetano Sacchi 16, 00153 Roma | ulissy@pec.it | gcrumbs.com*
