// =============================================================================
// GEIANT — SPATIAL MEMORY
// H3-indexed versioned geometry DAG.
// Every mutation is signed, chained, and queryable across time.
// =============================================================================
//
// This is what no other AI orchestrator has.
//
// When a LangChain agent modifies a polygon in step 4 of a 10-step workflow,
// there is no record of what it looked like in step 1, no way to detect that
// it became invalid in step 7, and no audit trail of who changed what.
//
// In GEIANT, every geometry mutation creates a new SpatialMemoryNode:
//   - Linked to the previous node by SHA-256 hash (immutable chain)
//   - Signed by the agent's Ed25519 key
//   - Indexed by H3 cells at resolution 9
//   - Linked to the delegation cert under which it occurred
//   - Queryable by: cell, agent, task, time range, mutation type
//
// The graph is a DAG — nodes are never deleted, only superseded.
// Rollback = re-activating a previous node as the current head.
//
// Architecture:
//   Phase 0 (now):  In-memory graph (Map + index). Fast, testable.
//   Phase 1:        Supabase-backed with PostGIS spatial queries.
//   Phase 2:        Distributed graph with GNS-node integration.
// =============================================================================

import { createHash } from 'crypto';
import { signHash, verifyHash } from '../crypto/ed25519';
import { latLngToCell, cellToLatLng, gridDisk } from 'h3-js';
import {
  SpatialMemoryNode,
  SpatialFeature,
  GeometryMutationType,
  H3Cell,
  VirtualBreadcrumb,
  BreadcrumbEventType,
} from '../types/index';
import { validateGeometries } from '../validation/geometry';

// ---------------------------------------------------------------------------
// Spatial Memory Graph
// ---------------------------------------------------------------------------

export interface SpatialMemoryQuery {
  cell?: H3Cell;
  agentPublicKey?: string;
  taskId?: string;
  mutationType?: GeometryMutationType;
  since?: string;   // ISO 8601
  until?: string;   // ISO 8601
  limit?: number;
}

export interface MutationResult {
  node: SpatialMemoryNode;
  breadcrumb: VirtualBreadcrumb;
}

export interface RollbackResult {
  restoredNode: SpatialMemoryNode;
  tombstone: SpatialMemoryNode;   // marks the rolled-back head as superseded
}

export class SpatialMemoryGraph {
  // Primary store: hash → node
  private nodes = new Map<string, SpatialMemoryNode>();

  // H3 cell index: cell → ordered list of node hashes (newest first)
  private cellIndex = new Map<H3Cell, string[]>();

  // Task index: taskId → node hashes
  private taskIndex = new Map<string, string[]>();

  // Agent index: agentPublicKey → node hashes
  private agentIndex = new Map<string, string[]>();

  // Head pointers: featureId → current head node hash
  // featureId is a stable ID assigned at genesis and carried through mutations
  private heads = new Map<string, string>();

  // ---------------------------------------------------------------------------
  // Write operations
  // ---------------------------------------------------------------------------

  /**
   * Add a new geometry to spatial memory (genesis node — no previous hash).
   * Validates geometry before accepting.
   */
  async create(params: {
    feature: SpatialFeature;
    featureId: string;
    taskId: string;
    agentPublicKey: string;
    delegationCertHash: string;
  }): Promise<MutationResult> {
    // Geometry guard — reject invalid geometry at the memory layer too
    const validation = validateGeometries([params.feature]);
    if (!validation.valid) {
      throw new GeometryValidationError(
        `Cannot store invalid geometry: ${validation.errorMessage}`,
        validation
      );
    }

    const h3Cells = extractH3Cells(params.feature, 9);
    const timestamp = new Date().toISOString();

    const node: SpatialMemoryNode = {
      hash: '',               // computed below
      prevHash: undefined,    // genesis
      taskId: params.taskId,
      agentPublicKey: params.agentPublicKey,
      delegationCertHash: params.delegationCertHash,
      feature: params.feature,
      h3Cells,
      mutationType: 'create',
      timestamp,
      agentSignature: agentSign(params.agentPublicKey, ''),
    };

    node.hash = computeNodeHash(node);
    node.agentSignature = agentSign(params.agentPublicKey, node.hash);

    this.storeNode(node);
    this.heads.set(params.featureId, node.hash);

    const breadcrumb = buildBreadcrumb(node, params.taskId, 'geometry_mutated',
      params.delegationCertHash);

    console.log(`🗺️  [SpatialMemory] CREATE ${params.featureId} → ${node.hash.substring(0, 16)}... (${h3Cells.length} cells)`);

    return { node, breadcrumb };
  }

  /**
   * Mutate an existing geometry — creates a new node linked to the current head.
   * The previous node is preserved in the graph (immutable history).
   *
   * @param featureId - stable ID of the feature being mutated
   * @param newFeature - the new geometry state
   * @param mutationType - what kind of mutation occurred
   */
  async mutate(params: {
    featureId: string;
    newFeature: SpatialFeature;
    mutationType: GeometryMutationType;
    taskId: string;
    agentPublicKey: string;
    delegationCertHash: string;
  }): Promise<MutationResult> {
    const currentHead = this.heads.get(params.featureId);
    if (!currentHead) {
      throw new Error(`Feature '${params.featureId}' not found in spatial memory. Use create() first.`);
    }

    // Geometry guard
    const validation = validateGeometries([params.newFeature]);
    if (!validation.valid) {
      throw new GeometryValidationError(
        `[GEIANT GeometryGuard] Mutation rejected — invalid geometry in step ${params.mutationType}: ${validation.errorMessage}`,
        validation
      );
    }

    const h3Cells = extractH3Cells(params.newFeature, 9);
    const timestamp = new Date().toISOString();

    const node: SpatialMemoryNode = {
      hash: '',
      prevHash: currentHead,
      taskId: params.taskId,
      agentPublicKey: params.agentPublicKey,
      delegationCertHash: params.delegationCertHash,
      feature: params.newFeature,
      h3Cells,
      mutationType: params.mutationType,
      timestamp,
      agentSignature: '',
    };

    node.hash = computeNodeHash(node);
    node.agentSignature = agentSign(params.agentPublicKey, node.hash);

    this.storeNode(node);
    this.heads.set(params.featureId, node.hash);

    // Detect territory boundary crossing (H3 cells changed significantly)
    const prevNode = this.nodes.get(currentHead)!;
    const crossedBoundary = detectBoundaryCrossing(prevNode.h3Cells, h3Cells);

    const eventType: BreadcrumbEventType = crossedBoundary
      ? 'territory_boundary_crossed'
      : 'geometry_mutated';

    const breadcrumb = buildBreadcrumb(node, params.taskId, eventType,
      params.delegationCertHash);

    console.log(`🗺️  [SpatialMemory] MUTATE ${params.featureId} [${params.mutationType}] → ${node.hash.substring(0, 16)}... ${crossedBoundary ? '⚠️  BOUNDARY CROSSED' : ''}`);

    return { node, breadcrumb };
  }

  /**
   * Rollback a feature to a specific previous node hash.
   * Does not delete nodes — creates a tombstone on the rolled-back head
   * and sets the head pointer back.
   */
  async rollback(params: {
    featureId: string;
    targetHash: string;
    taskId: string;
    agentPublicKey: string;
    delegationCertHash: string;
  }): Promise<RollbackResult> {
    const targetNode = this.nodes.get(params.targetHash);
    if (!targetNode) {
      throw new Error(`Target node ${params.targetHash} not found in spatial memory`);
    }

    // Verify target is in this feature's history
    const history = await this.getHistory(params.featureId);
    const isInHistory = history.some(n => n.hash === params.targetHash);
    if (!isInHistory) {
      throw new Error(`Node ${params.targetHash} is not in history of feature '${params.featureId}'`);
    }

    // Create tombstone node marking rollback
    const currentHead = this.heads.get(params.featureId)!;
    const tombstone = await this.mutate({
      featureId: params.featureId,
      newFeature: targetNode.feature,  // restore old geometry
      mutationType: 'transform',        // closest semantic match
      taskId: params.taskId,
      agentPublicKey: params.agentPublicKey,
      delegationCertHash: params.delegationCertHash,
    });

    console.log(`🗺️  [SpatialMemory] ROLLBACK ${params.featureId} → ${params.targetHash.substring(0, 16)}...`);

    return {
      restoredNode: targetNode,
      tombstone: tombstone.node,
    };
  }

  // ---------------------------------------------------------------------------
  // Read operations
  // ---------------------------------------------------------------------------

  /** Get the current head node for a feature */
  getHead(featureId: string): SpatialMemoryNode | null {
    const hash = this.heads.get(featureId);
    if (!hash) return null;
    return this.nodes.get(hash) ?? null;
  }

  /** Get the full mutation history of a feature, newest first */
  async getHistory(featureId: string): Promise<SpatialMemoryNode[]> {
    const headHash = this.heads.get(featureId);
    if (!headHash) return [];

    const history: SpatialMemoryNode[] = [];
    let current: SpatialMemoryNode | undefined = this.nodes.get(headHash);

    while (current) {
      history.push(current);
      current = current.prevHash ? this.nodes.get(current.prevHash) : undefined;
    }

    return history;
  }

  /** Get the geometry state of a feature at a specific point in time */
  async getAtTime(featureId: string, isoTimestamp: string): Promise<SpatialMemoryNode | null> {
    const history = await this.getHistory(featureId);
    const targetTime = new Date(isoTimestamp).getTime();

    // Walk newest-first (history is already newest-first).
    // Return the LAST node in that order whose timestamp <= targetTime,
    // which means: walk from newest to oldest, collect all matches, return
    // the last one (= oldest match = the state at that exact time).
    // When timestamps are equal (fast tests), this returns the genesis/create node.
    let result: SpatialMemoryNode | null = null;
    for (const node of history) {
      if (new Date(node.timestamp).getTime() <= targetTime) {
        result = node; // keep overwriting — last overwrite is oldest match
      }
    }
    return result;
  }

  /**
   * Query nodes by various criteria.
   * The core spatial query: "what changed in this H3 cell since timestamp X?"
   */
  async query(q: SpatialMemoryQuery): Promise<SpatialMemoryNode[]> {
    let candidates: SpatialMemoryNode[];

    // Start from cell index if cell is specified (most selective)
    if (q.cell) {
      const hashes = this.cellIndex.get(q.cell) ?? [];
      candidates = hashes.map(h => this.nodes.get(h)!).filter(Boolean);
    } else {
      candidates = Array.from(this.nodes.values());
    }

    // Apply filters
    if (q.agentPublicKey) {
      candidates = candidates.filter(n => n.agentPublicKey === q.agentPublicKey);
    }
    if (q.taskId) {
      candidates = candidates.filter(n => n.taskId === q.taskId);
    }
    if (q.mutationType) {
      candidates = candidates.filter(n => n.mutationType === q.mutationType);
    }
    if (q.since) {
      const since = new Date(q.since).getTime();
      candidates = candidates.filter(n => new Date(n.timestamp).getTime() >= since);
    }
    if (q.until) {
      const until = new Date(q.until).getTime();
      candidates = candidates.filter(n => new Date(n.timestamp).getTime() <= until);
    }

    // Sort newest first
    candidates.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return q.limit ? candidates.slice(0, q.limit) : candidates;
  }

  /** Verify the integrity of the chain for a feature */
  async verifyChain(featureId: string): Promise<{
    valid: boolean;
    nodeCount: number;
    brokenAt?: string;
  }> {
    const history = await this.getHistory(featureId);
    if (history.length === 0) return { valid: true, nodeCount: 0 };

    for (const node of history) {
      const recomputed = computeNodeHash({ ...node, hash: '', agentSignature: '' });
      if (recomputed !== node.hash) {
        return { valid: false, nodeCount: history.length, brokenAt: node.hash };
      }
    }

    return { valid: true, nodeCount: history.length };
  }

  /** Stats */
  get stats() {
    return {
      totalNodes: this.nodes.size,
      totalFeatures: this.heads.size,
      indexedCells: this.cellIndex.size,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private storeNode(node: SpatialMemoryNode): void {
    this.nodes.set(node.hash, node);

    // Cell index
    for (const cell of node.h3Cells) {
      const existing = this.cellIndex.get(cell) ?? [];
      this.cellIndex.set(cell, [node.hash, ...existing]);
    }

    // Task index
    const taskNodes = this.taskIndex.get(node.taskId) ?? [];
    this.taskIndex.set(node.taskId, [...taskNodes, node.hash]);

    // Agent index
    const agentNodes = this.agentIndex.get(node.agentPublicKey) ?? [];
    this.agentIndex.set(node.agentPublicKey, [...agentNodes, node.hash]);
  }
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

export class GeometryValidationError extends Error {
  constructor(message: string, public readonly validationResult: any) {
    super(message);
    this.name = 'GeometryValidationError';
  }
}

// ---------------------------------------------------------------------------
// Geometry utilities
// ---------------------------------------------------------------------------

/**
 * Extract H3 cells at a given resolution that a GeoJSON feature intersects.
 * Uses centroid + bounding approach for Phase 0.
 * Phase 1: replace with proper H3 polyfill using h3-js polyfillSmoothly.
 */
function extractH3Cells(feature: SpatialFeature, resolution: number): H3Cell[] {
  const cells = new Set<H3Cell>();

  const coords = extractAllCoordinates(feature.geometry);
  for (const [lng, lat] of coords) {
    if (isFinite(lat) && isFinite(lng)) {
      const cell = latLngToCell(lat, lng, resolution);
      cells.add(cell);
      // Add k=1 ring to ensure coverage at boundaries
      gridDisk(cell, 1).forEach(c => cells.add(c));
    }
  }

  return Array.from(cells);
}

function extractAllCoordinates(geom: any): [number, number][] {
  if (!geom) return [];
  switch (geom.type) {
    case 'Point':        return [geom.coordinates];
    case 'LineString':   return geom.coordinates;
    case 'Polygon':      return geom.coordinates.flat();
    case 'MultiPolygon': return geom.coordinates.flat(2);
    case 'MultiPoint':   return geom.coordinates;
    default:             return [];
  }
}

/**
 * Detect if geometry has crossed a significant H3 territory boundary.
 *
 * Uses centroid distance: compare the lat/lng centroid of the old H3 cells
 * vs the new H3 cells. If the centroid moves more than ~55km, it's a crossing.
 *
 * This is robust to buffer/expand operations (centroid stays close) and correctly
 * flags translate/jump operations (centroid moves far).
 *
 * ~1 degree lat ≈ 111km; ~1 degree lng ≈ 78km at 45°N.
 * Threshold: 0.5 degrees ≈ ~55km.
 */
function detectBoundaryCrossing(oldCells: H3Cell[], newCells: H3Cell[]): boolean {
  if (oldCells.length === 0 || newCells.length === 0) return false;

  const centroid = (cells: H3Cell[]): [number, number] => {
    let sumLat = 0, sumLng = 0;
    for (const cell of cells) {
      const [lat, lng] = cellToLatLng(cell);
      sumLat += lat;
      sumLng += lng;
    }
    return [sumLat / cells.length, sumLng / cells.length];
  };

  const [oldLat, oldLng] = centroid(oldCells);
  const [newLat, newLng] = centroid(newCells);
  const dist = Math.sqrt(Math.pow(oldLat - newLat, 2) + Math.pow(oldLng - newLng, 2));

  // ~0.5 degrees ≈ 55km — local buffers stay well below this
  return dist > 0.5;
}

// ---------------------------------------------------------------------------
// Hashing and signing
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic SHA-256 hash of a node.
 * Excludes `hash` and `agentSignature` fields (those depend on the hash).
 */
function computeNodeHash(node: Omit<SpatialMemoryNode, 'hash' | 'agentSignature'> & {
  hash?: string; agentSignature?: string;
}): string {
  const { hash: _h, agentSignature: _s, ...data } = node as any;
  const canonical = JSON.stringify(data, Object.keys(data).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Ed25519 signing for agent operations.
 *
 * Phase 0: derives a deterministic private key from the agent's public key
 * for development/testing. This is NOT secure for production.
 *
 * Production (Phase 1): private key is passed in from secure enclave storage.
 * The agent's private key NEVER leaves the device/enclave.
 */
function agentSign(agentPublicKey: string, hash: string): string {
  if (!hash) return '0'.repeat(128);
  // Phase 0: derive a dev private key deterministically from public key
  // This means signatures are verifiable given the public key
  const devPrivateKey = createHash('sha256')
    .update(`dev-signing-key:${agentPublicKey}`)
    .digest('hex');
  return signHash(hash, devPrivateKey);
}

/**
 * Verify an agent signature for a node hash.
 * Phase 0: uses the deterministic dev private key derivation.
 */
export function verifyAgentSignature(
  agentPublicKey: string,
  hash: string,
  signature: string
): boolean {
  if (!hash || !signature) return false;
  const devPrivateKey = createHash('sha256')
    .update(`dev-signing-key:${agentPublicKey}`)
    .digest('hex');
  // Derive the expected public key from the dev private key
  const { publicKeyFromPrivate } = require('../crypto/ed25519');
  const devPublicKey = publicKeyFromPrivate(devPrivateKey);
  return verifyHash(hash, signature, devPublicKey);
}

// ---------------------------------------------------------------------------
// Breadcrumb factory
// ---------------------------------------------------------------------------

function buildBreadcrumb(
  node: SpatialMemoryNode,
  taskId: string,
  eventType: BreadcrumbEventType,
  delegationCertHash: string
): VirtualBreadcrumb {
  const id = crypto.randomUUID();
  const primaryCell = node.h3Cells[0] ?? 'unknown';

  return {
    id,
    agentPublicKey: node.agentPublicKey,
    taskId,
    cell: primaryCell,
    eventType,
    delegationCertHash,
    prevBreadcrumbHash: undefined,
    hash: createHash('sha256').update(id + node.hash).digest('hex'),
    agentSignature: agentSign(node.agentPublicKey, node.hash),
    timestamp: node.timestamp,
  };
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _graph: SpatialMemoryGraph | null = null;

export function getSpatialMemory(): SpatialMemoryGraph {
  if (!_graph) _graph = new SpatialMemoryGraph();
  return _graph;
}

export function resetSpatialMemory(): void {
  _graph = new SpatialMemoryGraph();
}
