// =============================================================================
// GEIANT — CORE TYPE DEFINITIONS
// Geo-Identity Agent Navigation & Tasking
// =============================================================================
//
// Type hierarchy:
//   AntIdentity        — an agent's GNS-derived cryptographic identity
//   AntManifest        — public registration record for the agent registry
//   DelegationCert     — human → agent authorization chain
//   GeiantTask         — a unit of work submitted to the router
//   RoutingDecision    — router output: selected ant + justification
//   SpatialMemoryNode  — a versioned geometry node in the spatial graph
//   ValidationResult   — geometry guardrail output
//   JurisdictionResult — resolved regulatory context for an H3 cell
// =============================================================================

import { z } from 'zod';

// ---------------------------------------------------------------------------
// H3 / Geospatial primitives
// ---------------------------------------------------------------------------

/** H3 cell index string at any resolution */
export type H3Cell = string;

/** GeoJSON geometry types supported by GEIANT's spatial memory */
export type SpatialGeometry =
  | { type: 'Point';           coordinates: [number, number] }
  | { type: 'LineString';      coordinates: [number, number][] }
  | { type: 'Polygon';         coordinates: [number, number][][] }
  | { type: 'MultiPolygon';    coordinates: [number, number][][][]  }
  | { type: 'MultiPoint';      coordinates: [number, number][] };

export interface SpatialFeature {
  type: 'Feature';
  geometry: SpatialGeometry;
  properties: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Agent Identity  (mirrors GNS Ed25519 keypair model)
// ---------------------------------------------------------------------------

/**
 * AntIdentity — the core identity of a GEIANT agent.
 *
 * Derived from the same Ed25519 keypair model as human GNS identities.
 * An ant's public key IS its identity. No username, no API key, no OAuth.
 *
 * The handle follows GNS convention: agent@territory
 * e.g. "health@eu-north", "grid@rome-zone-3", "finance@swiss-central"
 */
export interface AntIdentity {
  /** Ed25519 public key — 64 hex chars. This IS the agent's identity. */
  publicKey: string;

  /**
   * GNS handle: <facet>@<territory>
   * The facet declares capability scope; the territory declares H3 jurisdiction.
   */
  handle: string;

  /**
   * H3 cells (res 5–9) defining this agent's operational territory.
   * Tasks outside these cells require explicit cross-jurisdiction authorization.
   */
  territoryCells: H3Cell[];

  /**
   * Facet scope — what this agent is authorized to do.
   * Maps to GNS facet system: health, finance, legal, grid, creator, etc.
   */
  facet: AntFacet;

  /**
   * GEIANT TierGate level — mirrors GNS human trust tiers but for agents.
   * Grows through audited, in-territory operations without violations.
   */
  tier: AntTier;

  /** ISO 8601 — when this identity was provisioned */
  provisionedAt: string;

  /** Stellar account ID derived from Ed25519 public key (IDUP payment layer) */
  stellarAccountId: string;
}

export type AntFacet =
  | 'health'
  | 'finance'
  | 'legal'
  | 'grid'        // energy / infrastructure
  | 'creator'
  | 'mobility'    // autonomous vehicles / logistics
  | 'environment' // EO / earth observation
  | 'compliance'
  | 'general';

/**
 * AntTier — trust accumulation for AI agents.
 * Parallels the human GNS TierGate system (Seedling → Trailblazer).
 *
 * Provisioned  →  Observed  →  Trusted  →  Certified  →  Sovereign
 *      0            50+          500+        5,000+       50,000+ operations
 */
export type AntTier =
  | 'provisioned'   // 0 ops       — sandboxed, read-only
  | 'observed'      // 50+ ops     — basic processing
  | 'trusted'       // 500+ ops    — handles PII, standard tasks
  | 'certified'     // 5,000+ ops  — financial transactions
  | 'sovereign';    // 50,000+ ops — full autonomy within territory

export const ANT_TIER_MIN_OPS: Record<AntTier, number> = {
  provisioned: 0,
  observed:    50,
  trusted:     500,
  certified:   5_000,
  sovereign:   50_000,
};

// ---------------------------------------------------------------------------
// Ant Manifest  (public registry entry)
// ---------------------------------------------------------------------------

/**
 * AntManifest — the public record an agent registers in the GEIANT registry.
 * Analogous to a GNS Record / gSite for human identities.
 */
export interface AntManifest {
  identity: AntIdentity;

  /** Human-readable description of what this agent does */
  description: string;

  /** Capability tags beyond the primary facet — e.g. ["gdal", "sentinel2", "h3"] */
  capabilities: string[];

  /** MCP server endpoints this agent exposes, if any */
  mcpEndpoints: McpEndpoint[];

  /** Operations count — determines tier progression */
  operationCount: number;

  /** Compliance score 0–100, updated after each Proof-of-Jurisdiction audit */
  complianceScore: number;

  /** Ed25519 signature of the manifest JSON (canonical, sorted keys) */
  signature: string;

  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Delegation Chain  (human → agent accountability)
// ---------------------------------------------------------------------------

/**
 * DelegationCert — a human principal's cryptographic authorization for an agent.
 *
 * The human must have a valid GNS identity (Proof-of-Trajectory verified).
 * Without a valid delegation cert, the router rejects the task.
 *
 * This is the answer to the regulatory question:
 * "Which human authorized this AI action, under which law?"
 */
export interface DelegationCert {
  /** Cert ID — UUID */
  id: string;

  /** Ed25519 public key of the authorizing human (GNS identity) */
  humanPublicKey: string;

  /** GNS handle of the authorizing human */
  humanHandle: string;

  /** Ed25519 public key of the authorized agent */
  agentPublicKey: string;

  /** H3 cells within which the agent may operate under this cert */
  scopeCells: H3Cell[];

  /** Facets the agent may exercise under this cert */
  scopeFacets: AntFacet[];

  /** ISO 8601 — cert validity window */
  validFrom: string;
  validUntil: string;

  /**
   * Maximum sub-delegation depth.
   * 0 = this agent cannot delegate further.
   * 1 = can delegate once more (orchestrator → sub-agent).
   */
  maxSubdelegationDepth: number;

  /** SHA-256 hash of the parent cert, if this is a sub-delegation */
  parentCertHash?: string;

  /** Ed25519 signature by the human's private key over canonical cert JSON */
  humanSignature: string;
}

// ---------------------------------------------------------------------------
// Task  (unit of work submitted to the GEIANT router)
// ---------------------------------------------------------------------------

/**
 * GeiantTask — a task submitted to the router for dispatch to an ant.
 *
 * Tasks carry their geographic context explicitly.
 * The router uses originCell + requiredFacet + minTier to find candidate ants.
 */
export interface GeiantTask {
  /** Task ID — UUID */
  id: string;

  /** H3 cell (res 7–9) where the task originates / where data is located */
  originCell: H3Cell;

  /** What kind of agent capability is needed */
  requiredFacet: AntFacet;

  /** Minimum trust tier required to handle this task */
  minTier: AntTier;

  /** The actual task payload — tool calls, prompts, data references */
  payload: TaskPayload;

  /** Delegation cert authorizing this task from a human principal */
  delegationCert: DelegationCert;

  /** Optional geometry objects the task operates on — pre-flight validated */
  geometries?: SpatialFeature[];

  /** ISO 8601 submission time */
  submittedAt: string;

  /** Caller's public key (human or orchestrator) */
  callerPublicKey: string;

  /** Ed25519 signature of canonical task JSON by caller */
  callerSignature: string;
}

export interface TaskPayload {
  /** Task type — drives which MCP servers / models are invoked */
  type: TaskType;

  /** Natural language instruction for the agent */
  instruction: string;

  /** Structured parameters for deterministic operations */
  params?: Record<string, unknown>;

  /** Context — prior tool results, documents, data refs */
  context?: unknown[];
}

export type TaskType =
  | 'spatial_analysis'    // geometry computation, H3 queries
  | 'eo_inference'        // earth observation model inference
  | 'jurisdictional_check'// resolve which laws apply
  | 'compliance_audit'    // generate Proof-of-Jurisdiction report
  | 'delegation_verify'   // validate a delegation chain
  | 'gis_operation'       // GDAL / PostGIS / QGIS operation via MCP
  | 'agent_orchestration' // spawn and coordinate sub-ants
  | 'general';

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * RoutingDecision — the router's output after all four routing checks.
 * Contains the selected ant, the jurisdiction context, and the audit record.
 */
export interface RoutingDecision {
  taskId: string;

  /** Whether the task was successfully routed */
  success: boolean;

  /** Selected ant manifest */
  selectedAnt?: AntManifest;

  /** Jurisdiction resolved for the task's origin cell */
  jurisdiction?: JurisdictionResult;

  /** Geometry validation result (if task contained geometries) */
  geometryValidation?: ValidationResult;

  /** Delegation chain validation result */
  delegationValidation?: DelegationValidationResult;

  /** Reason for rejection if success === false */
  rejectionReason?: RoutingRejectionReason;
  rejectionDetails?: string;

  /** Virtual breadcrumb — the audit record for this routing decision */
  breadcrumb: VirtualBreadcrumb;

  routedAt: string;
}

export type RoutingRejectionReason =
  | 'no_jurisdiction'          // cannot resolve laws for origin cell
  | 'no_eligible_ant'          // no ant matches facet + tier + territory
  | 'invalid_delegation'       // delegation cert invalid or expired
  | 'invalid_geometry'         // geometry failed GEOS validation
  | 'tier_insufficient'        // best available ant is below minTier
  | 'territory_mismatch'       // task origin outside all registered ants
  | 'signature_invalid';       // task signature verification failed

// ---------------------------------------------------------------------------
// Jurisdiction
// ---------------------------------------------------------------------------

export interface JurisdictionResult {
  cell: H3Cell;

  /** ISO 3166-1 alpha-2 country code */
  countryCode: string;

  /** ISO 3166-2 region/state code if applicable */
  regionCode?: string;

  /** Active regulatory frameworks for this territory */
  frameworks: RegulatoryFramework[];

  /** Data residency requirements */
  dataResidency: 'eu' | 'us' | 'uk' | 'ch' | 'sg' | 'br' | 'other';

  resolvedAt: string;
}

export interface RegulatoryFramework {
  id: string;           // e.g. "GDPR", "EU_AI_ACT", "CCPA", "FINMA"
  name: string;
  jurisdiction: string;
  requiresAuditTrail: boolean;
  requiresHumanOversight: boolean;
  maxAutonomyTier: AntTier;
}

// ---------------------------------------------------------------------------
// Spatial Memory
// ---------------------------------------------------------------------------

/**
 * SpatialMemoryNode — a versioned geometry in the spatial memory DAG.
 *
 * Every mutation to a geometry creates a new node.
 * Nodes are linked by prevHash, forming an immutable chain.
 * The graph is keyed by H3 cell at resolution 9.
 */
export interface SpatialMemoryNode {
  /** SHA-256 of this node's canonical JSON */
  hash: string;

  /** SHA-256 of the previous node (undefined for genesis nodes) */
  prevHash?: string;

  /** Task ID this mutation occurred within */
  taskId: string;

  /** Agent that produced this geometry version */
  agentPublicKey: string;

  /** Delegation cert hash under which this mutation occurred */
  delegationCertHash: string;

  /** The geometry at this version */
  feature: SpatialFeature;

  /** H3 cells (res 9) this geometry intersects at time of mutation */
  h3Cells: H3Cell[];

  /** Human-readable description of what changed */
  mutationType: GeometryMutationType;

  /** ISO 8601 */
  timestamp: string;

  /** Ed25519 signature by agent over canonical node JSON */
  agentSignature: string;
}

export type GeometryMutationType =
  | 'create'
  | 'buffer'
  | 'clip'
  | 'merge'
  | 'split'
  | 'reproject'
  | 'simplify'
  | 'transform'
  | 'delete';

// ---------------------------------------------------------------------------
// Geometry Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  featureIndex?: number;
  errorType?: GeometryErrorType;
  errorMessage?: string;
  /** Suggested correction if available */
  suggestion?: string;
}

export type GeometryErrorType =
  | 'self_intersection'
  | 'duplicate_points'
  | 'unclosed_ring'
  | 'invalid_coordinate'    // NaN, Infinity, or out of WGS84 range
  | 'coordinate_transposed' // likely lat/lng swap (heuristic)
  | 'empty_geometry'
  | 'invalid_crs';

// ---------------------------------------------------------------------------
// Delegation Validation
// ---------------------------------------------------------------------------

export interface DelegationValidationResult {
  valid: boolean;
  errorReason?: string;
  chainDepth: number;
  humanVerified: boolean; // whether the human principal has GNS PoT verified identity
}

// ---------------------------------------------------------------------------
// Audit Trail  (Virtual Breadcrumbs)
// ---------------------------------------------------------------------------

/**
 * VirtualBreadcrumb — the agent-side equivalent of a GNS human breadcrumb.
 *
 * Every routing decision, task execution, and geometry mutation produces
 * a virtual breadcrumb. Together they form the agent's Proof-of-Jurisdiction —
 * the audit trail that satisfies EU AI Act, GDPR Article 22, and EO 14110.
 */
export interface VirtualBreadcrumb {
  /** Breadcrumb ID */
  id: string;

  /** Agent that generated this breadcrumb */
  agentPublicKey: string;

  /** Task this breadcrumb belongs to */
  taskId: string;

  /** H3 cell where the operation occurred */
  cell: H3Cell;

  /** What happened */
  eventType: BreadcrumbEventType;

  /** Hash of the delegation cert in effect */
  delegationCertHash: string;

  /** Hash of the previous breadcrumb (chain link) */
  prevBreadcrumbHash?: string;

  /** SHA-256 of this breadcrumb's canonical JSON */
  hash: string;

  /** Ed25519 signature by agent */
  agentSignature: string;

  timestamp: string;
}

export type BreadcrumbEventType =
  | 'task_received'
  | 'jurisdiction_resolved'
  | 'delegation_verified'
  | 'geometry_validated'
  | 'task_dispatched'
  | 'task_completed'
  | 'task_failed'
  | 'geometry_mutated'
  | 'sub_delegation_issued'
  | 'territory_boundary_crossed';

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

export interface McpEndpoint {
  name: string;
  url: string;
  engine: GisEngine;
  capabilities: string[];
  requiresTier: AntTier;
}

export type GisEngine =
  | 'gdal'
  | 'pdal'
  | 'postgis'
  | 'arcgis'
  | 'qgis'
  | 'earthengine'
  | 'prithvi'   // IBM EO Foundation Model
  | 'clay'      // Microsoft Planetary Computer
  | 'h3'
  | 'general';

// ---------------------------------------------------------------------------
// Geometry Repair  (L2 Self-Healing)
// ---------------------------------------------------------------------------

/**
 * GeometryRepairResult — output of the self-healing geometry layer.
 *
 * When the L2 layer detects a repairable geometry error, it returns
 * both the corrected geometry and a human-readable diff explaining
 * what was changed. This is fed back to the agent to close the
 * correction loop without a full re-prompt.
 */
export interface GeometryRepairResult {
  /** Whether repair was possible */
  repaired: boolean;

  /** The repaired geometry (if repaired = true) */
  repairedGeometry?: SpatialGeometry;

  /** Original error type that triggered the repair */
  originalError: GeometryErrorType;

  /** Human-readable description of what was changed */
  repairDescription: string;

  /** Structured diff for agent consumption */
  repairDiff: RepairDiff;
}

export interface RepairDiff {
  operation: RepairOperation;
  before: unknown;
  after: unknown;
  coordinatesChanged?: number;
  ringsModified?: number;
}

export type RepairOperation =
  | 'coordinate_swap'        // transposed lat/lng fixed
  | 'ring_closure'           // added closing coordinate
  | 'convex_hull'            // self-intersection resolved via convex hull
  | 'duplicate_removal'      // removed consecutive duplicate points
  | 'coordinate_clamp';      // clamped out-of-range coordinates

// ---------------------------------------------------------------------------
// Jurisdictional Hand-off  (L1 Cross-Jurisdiction)
// ---------------------------------------------------------------------------

/**
 * HandoffDecision — emitted when a task crosses a jurisdictional boundary.
 *
 * Instead of rejecting a task whose origin cell has no eligible ant,
 * the router detects that an adjacent ant can legally handle it under
 * a signed sub-delegation cert, and documents the handoff.
 */
export interface HandoffDecision {
  /** Whether a valid handoff was found */
  possible: boolean;

  /** The original jurisdiction (no eligible ant) */
  fromJurisdiction: JurisdictionResult;

  /** The target jurisdiction where the receiving ant operates */
  toJurisdiction?: JurisdictionResult;

  /** The receiving ant in the target jurisdiction */
  receivingAnt?: AntManifest;

  /** The H3 cells that bridge the two jurisdictions */
  bridgeCells?: H3Cell[];

  /** Signed sub-delegation cert issued for the handoff */
  handoffCert?: HandoffCert;

  /** Why handoff was not possible (if possible = false) */
  rejectionReason?: string;
}

/**
 * HandoffCert — a router-issued sub-delegation for cross-jurisdiction transfer.
 *
 * Inherits from the original DelegationCert (depth - 1) and scopes
 * the receiving agent to the target jurisdiction's cells only.
 */
export interface HandoffCert {
  id: string;

  /** Original task ID this handoff serves */
  taskId: string;

  /** Public key of the sending ant (or router) */
  fromAgentPublicKey: string;

  /** Public key of the receiving ant */
  toAgentPublicKey: string;

  /** Target cells — scoped to the receiving ant's territory */
  scopeCells: H3Cell[];

  /** Inherited from original cert's scopeFacets */
  scopeFacets: AntFacet[];

  /** Sub-delegation depth remaining */
  remainingDepth: number;

  /** ISO 8601 — inherited from original cert's validUntil */
  validUntil: string;

  /** SHA-256 of the original DelegationCert that authorized this handoff */
  parentCertHash: string;

  /** Ed25519 signature by the router's key (or sending ant's key) */
  routerSignature: string;

  issuedAt: string;
}

// ---------------------------------------------------------------------------
// Extended RoutingDecision  (updated to carry handoff)
// ---------------------------------------------------------------------------

export interface HandoffRoutingDecision extends RoutingDecision {
  /** Populated when a cross-jurisdictional handoff was triggered */
  handoff?: HandoffDecision;

  /** Whether L2 geometry repair was applied before dispatch */
  geometryRepaired?: boolean;

  /** Repair results if geometry was auto-corrected */
  geometryRepairs?: GeometryRepairResult[];
}
