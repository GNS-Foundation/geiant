// =============================================================================
// GEIANT — Spatial Memory Test Suite
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { SpatialMemoryGraph, GeometryValidationError, resetSpatialMemory, getSpatialMemory } from '../memory/spatial_memory';
import { SpatialFeature } from '../types/index';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// Rome city center polygon (valid, closed)
const romePolygon: SpatialFeature = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [12.46, 41.89],
      [12.52, 41.89],
      [12.52, 41.92],
      [12.46, 41.92],
      [12.46, 41.89],
    ]],
  },
  properties: { name: 'Rome Centro' },
};

// Terna grid zone — northern Rome (valid)
const ternaZonePolygon: SpatialFeature = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [12.45, 41.93],
      [12.55, 41.93],
      [12.55, 41.98],
      [12.45, 41.98],
      [12.45, 41.93],
    ]],
  },
  properties: { name: 'Terna Zone Nord-Roma' },
};

// Expanded zone after buffer operation
const ternaZoneExpanded: SpatialFeature = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [12.40, 41.90],
      [12.60, 41.90],
      [12.60, 42.02],
      [12.40, 42.02],
      [12.40, 41.90],
    ]],
  },
  properties: { name: 'Terna Zone Nord-Roma (buffered 500m)' },
};

// Milan — far from Rome, should trigger boundary crossing detection
const milanPolygon: SpatialFeature = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [9.18, 45.46],
      [9.22, 45.46],
      [9.22, 45.49],
      [9.18, 45.49],
      [9.18, 45.46],
    ]],
  },
  properties: { name: 'Milan Centro' },
};

// Invalid — self-intersecting bowtie
const bowtiePoly: SpatialFeature = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]],
  },
  properties: {},
};

// Invalid — unclosed ring
const unclosedPoly: SpatialFeature = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[[12.46, 41.89], [12.52, 41.89], [12.52, 41.92], [12.46, 41.92]]],
  },
  properties: {},
};

const AGENT_ROME = 'a'.repeat(64);
const AGENT_MILAN = 'b'.repeat(64);
const CERT_HASH = 'cert_hash_stub_001';
const TASK_ID = 'task-terna-001';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SpatialMemoryGraph — create', () => {
  let graph: SpatialMemoryGraph;
  beforeEach(() => { graph = new SpatialMemoryGraph(); });

  it('creates a genesis node with correct fields', async () => {
    const result = await graph.create({
      feature: romePolygon,
      featureId: 'rome-centro',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    });

    expect(result.node.hash).toBeTruthy();
    expect(result.node.prevHash).toBeUndefined();
    expect(result.node.mutationType).toBe('create');
    expect(result.node.agentPublicKey).toBe(AGENT_ROME);
    expect(result.node.h3Cells.length).toBeGreaterThan(0);
    expect(result.node.agentSignature).toBeTruthy();
  });

  it('generates a virtual breadcrumb on create', async () => {
    const result = await graph.create({
      feature: romePolygon,
      featureId: 'rome-centro',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    });

    expect(result.breadcrumb.eventType).toBe('geometry_mutated');
    expect(result.breadcrumb.agentPublicKey).toBe(AGENT_ROME);
    expect(result.breadcrumb.taskId).toBe(TASK_ID);
    expect(result.breadcrumb.cell).toBeTruthy();
  });

  it('rejects invalid geometry — bowtie self-intersection', async () => {
    await expect(graph.create({
      feature: bowtiePoly,
      featureId: 'bad-poly',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    })).rejects.toThrow(GeometryValidationError);
  });

  it('rejects invalid geometry — unclosed ring', async () => {
    await expect(graph.create({
      feature: unclosedPoly,
      featureId: 'unclosed',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    })).rejects.toThrow(GeometryValidationError);
  });

  it('indexes H3 cells correctly', async () => {
    await graph.create({
      feature: romePolygon,
      featureId: 'rome-centro',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    });

    expect(graph.stats.indexedCells).toBeGreaterThan(0);
    expect(graph.stats.totalFeatures).toBe(1);
    expect(graph.stats.totalNodes).toBe(1);
  });
});

describe('SpatialMemoryGraph — mutate', () => {
  let graph: SpatialMemoryGraph;
  beforeEach(async () => {
    graph = new SpatialMemoryGraph();
    await graph.create({
      feature: ternaZonePolygon,
      featureId: 'terna-nord',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    });
  });

  it('chains mutations via prevHash', async () => {
    const genesis = graph.getHead('terna-nord')!;

    const result = await graph.mutate({
      featureId: 'terna-nord',
      newFeature: ternaZoneExpanded,
      mutationType: 'buffer',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    });

    expect(result.node.prevHash).toBe(genesis.hash);
    expect(result.node.mutationType).toBe('buffer');
  });

  it('preserves previous node after mutation', async () => {
    const genesis = graph.getHead('terna-nord')!;
    await graph.mutate({
      featureId: 'terna-nord',
      newFeature: ternaZoneExpanded,
      mutationType: 'buffer',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    });

    // Genesis node still exists
    const history = await graph.getHistory('terna-nord');
    expect(history.length).toBe(2);
    expect(history[history.length - 1].hash).toBe(genesis.hash);
  });

  it('rejects invalid geometry mutation', async () => {
    await expect(graph.mutate({
      featureId: 'terna-nord',
      newFeature: bowtiePoly,
      mutationType: 'transform',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    })).rejects.toThrow(GeometryValidationError);
  });

  it('detects territory boundary crossing Rome → Milan', async () => {
    const result = await graph.mutate({
      featureId: 'terna-nord',
      newFeature: milanPolygon,
      mutationType: 'transform',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    });

    // Breadcrumb should flag the boundary crossing
    expect(result.breadcrumb.eventType).toBe('territory_boundary_crossed');
  });

  it('does NOT flag boundary crossing for small local buffer', async () => {
    const result = await graph.mutate({
      featureId: 'terna-nord',
      newFeature: ternaZoneExpanded,
      mutationType: 'buffer',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    });

    expect(result.breadcrumb.eventType).toBe('geometry_mutated');
  });

  it('throws if featureId not found', async () => {
    await expect(graph.mutate({
      featureId: 'nonexistent',
      newFeature: romePolygon,
      mutationType: 'buffer',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    })).rejects.toThrow('not found');
  });
});

describe('SpatialMemoryGraph — history and time travel', () => {
  let graph: SpatialMemoryGraph;

  beforeEach(async () => {
    graph = new SpatialMemoryGraph();
    await graph.create({
      feature: ternaZonePolygon,
      featureId: 'terna-nord',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    });
    await graph.mutate({
      featureId: 'terna-nord',
      newFeature: ternaZoneExpanded,
      mutationType: 'buffer',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    });
  });

  it('returns full history newest-first', async () => {
    const history = await graph.getHistory('terna-nord');
    expect(history.length).toBe(2);
    expect(history[0].mutationType).toBe('buffer');
    expect(history[1].mutationType).toBe('create');
  });

  it('getHead returns latest node', async () => {
    const head = graph.getHead('terna-nord');
    expect(head?.mutationType).toBe('buffer');
  });

  it('getAtTime returns correct historical state', async () => {
    const history = await graph.getHistory('terna-nord');
    const genesisTime = history[history.length - 1].timestamp;

    // Request state at genesis time — should return genesis node
    const atGenesis = await graph.getAtTime('terna-nord', genesisTime);
    expect(atGenesis?.mutationType).toBe('create');
  });

  it('returns null for unknown featureId', async () => {
    const head = graph.getHead('unknown-feature');
    expect(head).toBeNull();
  });
});

describe('SpatialMemoryGraph — query', () => {
  let graph: SpatialMemoryGraph;

  beforeEach(async () => {
    graph = new SpatialMemoryGraph();
    await graph.create({
      feature: romePolygon,
      featureId: 'rome-centro',
      taskId: 'task-001',
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    });
    await graph.create({
      feature: milanPolygon,
      featureId: 'milan-centro',
      taskId: 'task-002',
      agentPublicKey: AGENT_MILAN,
      delegationCertHash: CERT_HASH,
    });
    await graph.mutate({
      featureId: 'rome-centro',
      newFeature: ternaZoneExpanded,
      mutationType: 'buffer',
      taskId: 'task-001',
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    });
  });

  it('queries by agent', async () => {
    const results = await graph.query({ agentPublicKey: AGENT_ROME });
    expect(results.length).toBe(2); // create + buffer
    expect(results.every(n => n.agentPublicKey === AGENT_ROME)).toBe(true);
  });

  it('queries by taskId', async () => {
    const results = await graph.query({ taskId: 'task-002' });
    expect(results.length).toBe(1);
    expect(results[0].agentPublicKey).toBe(AGENT_MILAN);
  });

  it('queries by mutationType', async () => {
    const results = await graph.query({ mutationType: 'buffer' });
    expect(results.length).toBe(1);
    expect(results[0].mutationType).toBe('buffer');
  });

  it('respects limit', async () => {
    const results = await graph.query({ limit: 1 });
    expect(results.length).toBe(1);
  });

  it('queries by H3 cell', async () => {
    // Get a cell from Rome's nodes
    const romeNode = graph.getHead('rome-centro')!;
    const romeCell = romeNode.h3Cells[0];

    const results = await graph.query({ cell: romeCell });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(n => n.h3Cells.includes(romeCell))).toBe(true);
  });
});

describe('SpatialMemoryGraph — chain integrity', () => {
  let graph: SpatialMemoryGraph;

  it('verifies a clean chain', async () => {
    graph = new SpatialMemoryGraph();
    await graph.create({
      feature: romePolygon,
      featureId: 'rome-test',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    });
    await graph.mutate({
      featureId: 'rome-test',
      newFeature: ternaZoneExpanded,
      mutationType: 'buffer',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    });

    const result = await graph.verifyChain('rome-test');
    expect(result.valid).toBe(true);
    expect(result.nodeCount).toBe(2);
  });

  it('returns valid:true and nodeCount:0 for unknown feature', async () => {
    graph = new SpatialMemoryGraph();
    const result = await graph.verifyChain('nonexistent');
    expect(result.valid).toBe(true);
    expect(result.nodeCount).toBe(0);
  });
});

describe('SpatialMemoryGraph — rollback', () => {
  let graph: SpatialMemoryGraph;

  it('rolls back to a previous state', async () => {
    graph = new SpatialMemoryGraph();
    const genesis = await graph.create({
      feature: romePolygon,
      featureId: 'rollback-test',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    });

    await graph.mutate({
      featureId: 'rollback-test',
      newFeature: ternaZoneExpanded,
      mutationType: 'buffer',
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    });

    const rb = await graph.rollback({
      featureId: 'rollback-test',
      targetHash: genesis.node.hash,
      taskId: TASK_ID,
      agentPublicKey: AGENT_ROME,
      delegationCertHash: CERT_HASH,
    });

    // Head is now the rollback tombstone with genesis geometry
    const head = graph.getHead('rollback-test')!;
    expect(JSON.stringify(head.feature.geometry))
      .toBe(JSON.stringify(romePolygon.geometry));

    // Full history has 3 nodes: create + buffer + rollback
    const history = await graph.getHistory('rollback-test');
    expect(history.length).toBe(3);
  });
});

describe('Singleton', () => {
  it('getSpatialMemory returns same instance', () => {
    resetSpatialMemory();
    const a = getSpatialMemory();
    const b = getSpatialMemory();
    expect(a).toBe(b);
  });
});
