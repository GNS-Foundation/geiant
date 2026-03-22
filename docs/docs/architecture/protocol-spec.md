---
sidebar_position: 4
title: Protocol Specification
---

# GEIANT Protocol Specification
## Geo-Identity Agent Navigation & Tasking
### Version 0.2 | March 2026 | DRAFT

**Authors:** Camilo Ayerbe (ULISSY s.r.l. / GNS Foundation)
**Status:** Internet-Draft — Intended for IETF submission alongside TrIP RFC
**Repository:** https://github.com/GNS-Foundation/geiant
**Documentation:** https://docs.geiant.com

---

## Abstract

GEIANT defines a governance protocol for geospatial AI agents. A GEIANT-compliant runtime accepts task requests, enforces four sequential compliance gates (signature verification, jurisdiction resolution, delegation chain validation, geometry pre-flight), dispatches tasks to the highest-scoring eligible agent in the registry, and records every operation as a cryptographically signed Virtual Breadcrumb — an immutable, hash-chained audit trail.

The core design principle: the runtime is a compliance enforcement point, not a load balancer. Pre-flight enforcement, not post-hoc logging.

**Changes from v0.1:**
- NEW §3.5–3.8: Production data structures (VirtualBreadcrumbBlock, AgentEpochSummary, ComplianceReport, Trust Score)
- NEW §5.5–5.7: Epoch rollup, compliance report, and MCP SSE endpoints
- NEW §7: Agent Audit Trail specification (Phase 5.1)
- REVISED §10: Roadmap — Phases 0–5.1 complete
- REVISED §11: Security — breadcrumb chain integrity, timestamp normalization
- REVISED §13: References — docs.geiant.com, npm packages, EU AI Act

---

## 1. Motivation

Current AI orchestration frameworks (LangChain, CrewAI, AutoGen, Semantic Kernel) are location-blind. They route tasks by capability and cost. They have no mechanism to:

- Verify that an agent has territorial binding to the task's origin cell
- Enforce jurisdictional constraints before dispatch
- Produce a cryptographic audit trail linking AI actions to human authorization
- Detect and reject geometrically invalid payloads before they propagate
- Generate compliance reports mapping to EU AI Act, NIST AI RMF, ISO 42001

---

## 2. Terminology

| Term | Definition |
|---|---|
| **Agent** | An Ed25519-authenticated AI entity registered in the GEIANT agent registry |
| **Principal** | The human who authorizes an agent via a signed DelegationCertificate |
| **H3 Cell** | A hexagonal cell in the Uber H3 geospatial index (resolution 0–15) |
| **Facet** | A capability scope (e.g., `energy`, `transport`, `health`) |
| **Tier** | Trust level based on operational history (Provisioned → Sovereign) |
| **Breadcrumb** | A signed, hash-chained audit record of a single agent operation |
| **Epoch** | A Merkle rollup of N consecutive breadcrumbs into a compact summary |
| **Delegation Certificate** | A signed authorization from a human principal to an agent |
| **Compliance Report** | A structured JSON output mapping agent activity to regulatory requirements |
| **GEP** | GeoEpoch Protocol — geographic addressing fabric (Layer 1) |
| **TrIP** | Trajectory-based Recognition of Identity Protocol (IETF draft) |
| **MCP** | Model Context Protocol — tool invocation standard for AI agents |

---

## 3. Data Structures

### 3.1 GeiantTask

```typescript
interface GeiantTask {
  id: string;
  originCell: string;               // H3 cell where the task originates
  requiredFacet: string;
  minTier: AgentTier;
  callerPublicKey?: string;         // Ed25519 public key (64 hex)
  callerSignature?: string;         // Ed25519 signature (128 hex)
  delegationCert: DelegationCertificate;
  geometries?: GeoJSON.Feature[];
  payload?: Record<string, unknown>;
}
```

### 3.2 DelegationCertificate

```typescript
interface DelegationCertificate {
  version: 1;
  agent_pk: string;                 // Agent Ed25519 public key (64 hex)
  principal_pk: string;             // Human principal Ed25519 public key (64 hex)
  h3_cells: string[];               // Allowed jurisdictional H3 cells
  facets: string[];                 // Allowed capability scopes
  not_before: string;               // ISO 8601 validity start
  not_after: string;                // ISO 8601 validity end
  max_depth: number;                // Max sub-delegation depth (0 = none)
  constraints?: {
    max_ops_per_hour?: number;
    allowed_tools?: string[];
    denied_tools?: string[];
    require_human_approval?: string[];
    max_cost_per_op_xlm?: number;
  };
  principal_signature: string;      // Ed25519 signature by principal (128 hex)
}
```

Certificate hash: `SHA-256(canonical_json(cert_without_signature))`.

### 3.3 RoutingDecision

```typescript
interface RoutingDecision {
  taskId: string;
  success: boolean;
  selectedAgent?: AgentManifest;
  jurisdiction?: JurisdictionResult;
  delegationValidation?: DelegationValidationResult;
  geometryValidation?: GeometryValidationResult;
  breadcrumb: VirtualBreadcrumbBlock;
  routedAt: string;
  handoff?: HandoffDecision;
  geometryRepaired?: boolean;
  rejectionReason?: RejectionCode;
  rejectionDetails?: string;
}
```

### 3.4 AgentTier

```typescript
enum AgentTier {
  PROVISIONED = 'provisioned',   // 0 ops, 0% trust
  OBSERVED    = 'observed',      // 50+ ops, 25% trust
  TRUSTED     = 'trusted',       // 500+ ops, 60% trust
  CERTIFIED   = 'certified',    // 5,000+ ops, 85% trust
  SOVEREIGN   = 'sovereign',    // 50,000+ ops, 99% trust
}
```

### 3.5 VirtualBreadcrumbBlock (NEW in v0.2)

```typescript
interface VirtualBreadcrumbBlock {
  index: number;
  identity_public_key: string;      // Agent Ed25519 PK (64 hex)
  timestamp: string;                // ISO 8601 UTC
  location_cell: string;            // H3 cell
  location_resolution: number;      // H3 resolution
  context_digest: string;           // SHA-256(SHA-256(input) + ":" + SHA-256(output))
  previous_hash: string | null;     // null for genesis block
  meta_flags: {
    tool_duration_ms: number;
    input_hash: string;
    output_hash: string;
    tier: AgentTier;
    model_id?: string;
    runpod_endpoint?: string;
    error?: string;
  };
  signature: string;                // Ed25519 signature (128 hex)
  block_hash: string;               // SHA-256(data_to_sign + ":" + signature)
  delegation_cert_hash: string;
  tool_name: string;
  facet: string;
}
```

**Signing:** `data_to_sign = canonical_json({index, identity, timestamp, loc_cell, loc_res, context, prev_hash, meta, delegation_cert_hash, tool_name, facet})` → `signature = Ed25519.sign(data_to_sign, sk)` → `block_hash = SHA-256(data_to_sign + ":" + signature)`.

### 3.6 AgentEpochSummary (NEW in v0.2)

```typescript
interface AgentEpochSummary {
  epoch_index: number;
  agent_pk: string;
  start_time: string;
  end_time: string;
  start_block_index: number;
  end_block_index: number;
  block_count: number;
  merkle_root: string;              // Binary Merkle tree over block_hash values
  previous_epoch_hash: string | null;
  delegation_cert_hash: string;
  tools_used: string[];
  jurisdiction_cells: string[];
  tier_at_close: AgentTier;
  signature: string;
  epoch_hash: string;
}
```

Merkle tree: binary. Leaves = block_hash values. Internal = `SHA-256(left + ":" + right)`. Odd leaf duplicated.

### 3.7 ComplianceReport (NEW in v0.2)

```typescript
interface ComplianceReport {
  version: 1;
  generated_at: string;
  agent_pk: string;
  agent_handle: string;
  principal_pk: string;
  reporting_period: { from: string; to: string };
  total_operations: number;
  operations_by_tool: Record<string, number>;
  jurisdiction_cells: string[];
  chain_verification: ChainVerificationResult;
  epochs: AgentEpochSummary[];
  delegation_certificate: DelegationCertificate;
  delegation_chain_depth: number;
  human_approvals_required: number;
  human_approvals_received: number;
  current_tier: AgentTier;
  trust_score: number;
  violations: ComplianceViolation[];
}
```

### 3.8 Trust Score (NEW in v0.2)

```
score = min(ops/5000, 0.4)×100 + min(cells/20, 0.3)×100 + min(days/365, 0.2)×100 + (chain_valid ? 10 : 0)
```

Clamped to [0, 100].

---

## 4. Routing Protocol

### 4.1 Four-Gate Enforcement

```
Task → Gate 1 (Signature) → Gate 2 (Jurisdiction) → Gate 3 (Delegation) → Gate 4 (Geometry) → Dispatch
```

Every gate failure returns a structured rejection with a VirtualBreadcrumbBlock.

### 4.2 L1 Cross-Jurisdictional Handoff

Scans up to 3 adjacent H3 rings. Requires `max_depth > 0`. GDPR-origin tasks only hand off to equivalent-protection jurisdictions.

### 4.3 L2 Geometry Self-Healing

GEOS-backed repair: `buffer(0)`, ring normalization, precision reduction.

---

## 5. HTTP API

Base URL: `https://packagesmcp-perception-production.up.railway.app`

### 5.1 Health
`GET /health` → Service status, chain tip, audit state.

### 5.2 MCP SSE Transport
`GET /sse` → SSE stream. `POST /message?sessionId=X` → MCP JSON-RPC.

Note: `express.json()` MUST NOT be applied to `/message` — SSEServerTransport reads the raw body.

### 5.3 MCP Tools

| Tool | Audit | Description |
|---|---|---|
| `perception_fetch_tile` | ✅ | Sentinel-2 L2A tile via STAC |
| `perception_classify` | ✅ | Prithvi-EO-2.0 classification |
| `perception_embed` | ✅ | Clay v1.5 embeddings |
| `perception_weather` | ✅ | Open-Meteo ERA5 weather |

### 5.4 Weather Test
`GET /test/weather` → Quick diagnostic, drops a breadcrumb.

### 5.5 Epoch Rollup (NEW in v0.2)
`POST /epoch/roll` → Merkle-rolls all unrolled breadcrumbs into an AgentEpochSummary.

### 5.6 Compliance Report (NEW in v0.2)
`GET /compliance` or `GET /compliance/:agent_pk` → ComplianceReport JSON. Optional `?from=&to=` date filters.

---

## 6. Rejection Reasons

| Code | Meaning |
|---|---|
| `signature_invalid` | Signature verification failed |
| `no_jurisdiction` | H3 cell unresolvable |
| `invalid_delegation` | Cert expired, invalid sig, or scope mismatch |
| `invalid_geometry` | Geometry invalid and self-healing failed |
| `no_eligible_ant` | No matching agent, handoff failed |
| `tier_insufficient` | Agents exist but below minTier |
| `territory_mismatch` | No agent covers the origin cell |

---

## 7. Agent Audit Trail (NEW in v0.2)

### 7.1 Chain Integrity

Append-only, tamper-evident. Block N's `previous_hash` = block N-1's `block_hash`. Genesis has `previous_hash: null`. Modify block N → block_hash changes → all subsequent blocks invalid.

### 7.2 Context Digest

`context_digest = SHA-256(SHA-256(input) + ":" + SHA-256(output))`. Proves what was processed without storing actual data.

### 7.3 Verification Levels

| Level | Checks | Cost |
|---|---|---|
| Block | Signature, hash | O(1) |
| Chain | Links, gaps, timestamps | O(n) |
| Epoch | Merkle root, epoch chain | O(log n) |
| Full | Chain + delegation + jurisdiction | O(n) |

### 7.4 Supabase Schema

| Table | RLS |
|---|---|
| `delegation_certificates` | service: full, anon: read |
| `agent_breadcrumbs` | service: full, anon: read |
| `agent_epochs` | service: full, anon: read |
| `agent_registry` | service: full, anon: read |
| `compliance_violations` | service: full |

Anon read enables third-party verifiability.

---

## 8. Jurisdiction Coverage

| Country | Code | Frameworks |
|---|---|---|
| Italy | IT | GDPR, EU AI Act, eIDAS 2.0, Italian Civil Code |
| Germany | DE | GDPR, EU AI Act, eIDAS 2.0, NetzDG |
| France | FR | GDPR, EU AI Act, eIDAS 2.0 |
| Spain | ES | GDPR, EU AI Act, eIDAS 2.0 |
| Switzerland | CH | Swiss DPA (nDSG), FINMA |
| United Kingdom | GB | UK GDPR |
| United States | US | EO 14110, NIST AI RMF |
| California | US-CA | EO 14110, CCPA, Colorado SB 205 |
| China | CN | Interim Measures for GenAI, Algorithm Rules |
| Brazil | BR | LGPD |
| Singapore | SG | PDPA |

---

## 9. Relationship to GNS Protocol

| GNS Primitive | Human Use | GEIANT Agent Use |
|---|---|---|
| Ed25519 keypair | Identity credential | Agent identity + signing key |
| H3 cell | Location privacy | Jurisdictional binding |
| Breadcrumbs | Physical trajectory | Virtual audit trail |
| Trust score | Humanity proof | Compliance score + tier |
| Facets | Role separation | Capability scoping |
| Stellar wallet | P2P payments | Agent settlement |
| Epochs | Trajectory summary | Merkle-rolled compliance |
| DelegationCert | — | Human → Agent authorization |

---

## 10. Roadmap

| Phase | Deliverable | Status |
|---|---|---|
| 0 — Synthetic Data | Benchmark dataset, routing logic | ✅ Complete |
| 1 — Agent Registry | Supabase registry, MCP PostGIS + GDAL | ✅ Complete |
| 2 — GeoRouter | HTTP routing, four-gate enforcement | ✅ Complete |
| 3 — Spatial Memory | H3-indexed geometry DAG | ✅ Complete |
| 4 — Perception | Prithvi-EO, Clay v1.5, ERA5, 62/62 tests | ✅ Complete |
| 5.1 — Audit Trail | Breadcrumbs, epochs, compliance, SSE | ✅ Complete (March 22, 2026) |
| 5.2 — IDUP Settlement | Stellar payment routing | ⬜ Planned |
| 5.3 — Multi-Agent | Cross-agent delegation chains | ⬜ Planned |
| 6 — Full Runtime | Multi-agent orchestration, cloud marketplace | ⬜ Planned (Q3 2027) |

---

## 11. Security Considerations

- Ed25519 private keys MUST NOT leave the signing device.
- DelegationCertificates MUST be validated on every operation.
- Breadcrumbs MUST be signed; stub signatures prohibited in production.
- The breadcrumb chain MUST be append-only with no delete/modify mechanism.
- Supabase TIMESTAMPTZ returns `+00:00`; implementations MUST normalize to `Z` before signature verification.
- Channel binding tokens (CBT) SHOULD be used for MCP SSE connections.
- `express.json()` MUST NOT be applied to MCP `/message` route (SSEServerTransport reads raw body).

---

## 12. IANA Considerations

This document has no IANA actions.

---

## 13. References

- GEIANT Docs: https://docs.geiant.com
- GNS Protocol: https://gcrumbs.com
- TrIP Internet-Draft: https://datatracker.ietf.org/doc/draft-ayerbe-trip-protocol
- H3 Geospatial Index: https://h3geo.org
- Model Context Protocol: https://modelcontextprotocol.io
- @gns-aip/sdk: https://www.npmjs.com/package/@gns-aip/sdk
- langchain-gns-aip: https://www.npmjs.com/package/langchain-gns-aip
- GEIANT Benchmark: https://huggingface.co/datasets/cayerbe/geiant-benchmark
- USPTO Provisional #63/948,788
- EU AI Act: Regulation (EU) 2024/1689
- NIST AI RMF: https://www.nist.gov/artificial-intelligence

---

*ULISSY s.r.l. — Via Gaetano Sacchi 16, 00153 Roma*
*cayerbe@ulissy.app | https://geiant.com | https://docs.geiant.com*
