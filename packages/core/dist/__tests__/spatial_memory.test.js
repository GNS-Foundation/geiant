"use strict";
// =============================================================================
// GEIANT — Spatial Memory Test Suite
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const spatial_memory_1 = require("../memory/spatial_memory");
// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
// Rome city center polygon (valid, closed)
const romePolygon = {
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
const ternaZonePolygon = {
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
const ternaZoneExpanded = {
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
const milanPolygon = {
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
const bowtiePoly = {
    type: 'Feature',
    geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]],
    },
    properties: {},
};
// Invalid — unclosed ring
const unclosedPoly = {
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
(0, vitest_1.describe)('SpatialMemoryGraph — create', () => {
    let graph;
    (0, vitest_1.beforeEach)(() => { graph = new spatial_memory_1.SpatialMemoryGraph(); });
    (0, vitest_1.it)('creates a genesis node with correct fields', async () => {
        const result = await graph.create({
            feature: romePolygon,
            featureId: 'rome-centro',
            taskId: TASK_ID,
            agentPublicKey: AGENT_ROME,
            delegationCertHash: CERT_HASH,
        });
        (0, vitest_1.expect)(result.node.hash).toBeTruthy();
        (0, vitest_1.expect)(result.node.prevHash).toBeUndefined();
        (0, vitest_1.expect)(result.node.mutationType).toBe('create');
        (0, vitest_1.expect)(result.node.agentPublicKey).toBe(AGENT_ROME);
        (0, vitest_1.expect)(result.node.h3Cells.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(result.node.agentSignature).toBeTruthy();
    });
    (0, vitest_1.it)('generates a virtual breadcrumb on create', async () => {
        const result = await graph.create({
            feature: romePolygon,
            featureId: 'rome-centro',
            taskId: TASK_ID,
            agentPublicKey: AGENT_ROME,
            delegationCertHash: CERT_HASH,
        });
        (0, vitest_1.expect)(result.breadcrumb.eventType).toBe('geometry_mutated');
        (0, vitest_1.expect)(result.breadcrumb.agentPublicKey).toBe(AGENT_ROME);
        (0, vitest_1.expect)(result.breadcrumb.taskId).toBe(TASK_ID);
        (0, vitest_1.expect)(result.breadcrumb.cell).toBeTruthy();
    });
    (0, vitest_1.it)('rejects invalid geometry — bowtie self-intersection', async () => {
        await (0, vitest_1.expect)(graph.create({
            feature: bowtiePoly,
            featureId: 'bad-poly',
            taskId: TASK_ID,
            agentPublicKey: AGENT_ROME,
            delegationCertHash: CERT_HASH,
        })).rejects.toThrow(spatial_memory_1.GeometryValidationError);
    });
    (0, vitest_1.it)('rejects invalid geometry — unclosed ring', async () => {
        await (0, vitest_1.expect)(graph.create({
            feature: unclosedPoly,
            featureId: 'unclosed',
            taskId: TASK_ID,
            agentPublicKey: AGENT_ROME,
            delegationCertHash: CERT_HASH,
        })).rejects.toThrow(spatial_memory_1.GeometryValidationError);
    });
    (0, vitest_1.it)('indexes H3 cells correctly', async () => {
        await graph.create({
            feature: romePolygon,
            featureId: 'rome-centro',
            taskId: TASK_ID,
            agentPublicKey: AGENT_ROME,
            delegationCertHash: CERT_HASH,
        });
        (0, vitest_1.expect)(graph.stats.indexedCells).toBeGreaterThan(0);
        (0, vitest_1.expect)(graph.stats.totalFeatures).toBe(1);
        (0, vitest_1.expect)(graph.stats.totalNodes).toBe(1);
    });
});
(0, vitest_1.describe)('SpatialMemoryGraph — mutate', () => {
    let graph;
    (0, vitest_1.beforeEach)(async () => {
        graph = new spatial_memory_1.SpatialMemoryGraph();
        await graph.create({
            feature: ternaZonePolygon,
            featureId: 'terna-nord',
            taskId: TASK_ID,
            agentPublicKey: AGENT_ROME,
            delegationCertHash: CERT_HASH,
        });
    });
    (0, vitest_1.it)('chains mutations via prevHash', async () => {
        const genesis = graph.getHead('terna-nord');
        const result = await graph.mutate({
            featureId: 'terna-nord',
            newFeature: ternaZoneExpanded,
            mutationType: 'buffer',
            taskId: TASK_ID,
            agentPublicKey: AGENT_ROME,
            delegationCertHash: CERT_HASH,
        });
        (0, vitest_1.expect)(result.node.prevHash).toBe(genesis.hash);
        (0, vitest_1.expect)(result.node.mutationType).toBe('buffer');
    });
    (0, vitest_1.it)('preserves previous node after mutation', async () => {
        const genesis = graph.getHead('terna-nord');
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
        (0, vitest_1.expect)(history.length).toBe(2);
        (0, vitest_1.expect)(history[history.length - 1].hash).toBe(genesis.hash);
    });
    (0, vitest_1.it)('rejects invalid geometry mutation', async () => {
        await (0, vitest_1.expect)(graph.mutate({
            featureId: 'terna-nord',
            newFeature: bowtiePoly,
            mutationType: 'transform',
            taskId: TASK_ID,
            agentPublicKey: AGENT_ROME,
            delegationCertHash: CERT_HASH,
        })).rejects.toThrow(spatial_memory_1.GeometryValidationError);
    });
    (0, vitest_1.it)('detects territory boundary crossing Rome → Milan', async () => {
        const result = await graph.mutate({
            featureId: 'terna-nord',
            newFeature: milanPolygon,
            mutationType: 'transform',
            taskId: TASK_ID,
            agentPublicKey: AGENT_ROME,
            delegationCertHash: CERT_HASH,
        });
        // Breadcrumb should flag the boundary crossing
        (0, vitest_1.expect)(result.breadcrumb.eventType).toBe('territory_boundary_crossed');
    });
    (0, vitest_1.it)('does NOT flag boundary crossing for small local buffer', async () => {
        const result = await graph.mutate({
            featureId: 'terna-nord',
            newFeature: ternaZoneExpanded,
            mutationType: 'buffer',
            taskId: TASK_ID,
            agentPublicKey: AGENT_ROME,
            delegationCertHash: CERT_HASH,
        });
        (0, vitest_1.expect)(result.breadcrumb.eventType).toBe('geometry_mutated');
    });
    (0, vitest_1.it)('throws if featureId not found', async () => {
        await (0, vitest_1.expect)(graph.mutate({
            featureId: 'nonexistent',
            newFeature: romePolygon,
            mutationType: 'buffer',
            taskId: TASK_ID,
            agentPublicKey: AGENT_ROME,
            delegationCertHash: CERT_HASH,
        })).rejects.toThrow('not found');
    });
});
(0, vitest_1.describe)('SpatialMemoryGraph — history and time travel', () => {
    let graph;
    (0, vitest_1.beforeEach)(async () => {
        graph = new spatial_memory_1.SpatialMemoryGraph();
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
    (0, vitest_1.it)('returns full history newest-first', async () => {
        const history = await graph.getHistory('terna-nord');
        (0, vitest_1.expect)(history.length).toBe(2);
        (0, vitest_1.expect)(history[0].mutationType).toBe('buffer');
        (0, vitest_1.expect)(history[1].mutationType).toBe('create');
    });
    (0, vitest_1.it)('getHead returns latest node', async () => {
        const head = graph.getHead('terna-nord');
        (0, vitest_1.expect)(head?.mutationType).toBe('buffer');
    });
    (0, vitest_1.it)('getAtTime returns correct historical state', async () => {
        const history = await graph.getHistory('terna-nord');
        const genesisTime = history[history.length - 1].timestamp;
        // Request state at genesis time — should return genesis node
        const atGenesis = await graph.getAtTime('terna-nord', genesisTime);
        (0, vitest_1.expect)(atGenesis?.mutationType).toBe('create');
    });
    (0, vitest_1.it)('returns null for unknown featureId', async () => {
        const head = graph.getHead('unknown-feature');
        (0, vitest_1.expect)(head).toBeNull();
    });
});
(0, vitest_1.describe)('SpatialMemoryGraph — query', () => {
    let graph;
    (0, vitest_1.beforeEach)(async () => {
        graph = new spatial_memory_1.SpatialMemoryGraph();
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
    (0, vitest_1.it)('queries by agent', async () => {
        const results = await graph.query({ agentPublicKey: AGENT_ROME });
        (0, vitest_1.expect)(results.length).toBe(2); // create + buffer
        (0, vitest_1.expect)(results.every(n => n.agentPublicKey === AGENT_ROME)).toBe(true);
    });
    (0, vitest_1.it)('queries by taskId', async () => {
        const results = await graph.query({ taskId: 'task-002' });
        (0, vitest_1.expect)(results.length).toBe(1);
        (0, vitest_1.expect)(results[0].agentPublicKey).toBe(AGENT_MILAN);
    });
    (0, vitest_1.it)('queries by mutationType', async () => {
        const results = await graph.query({ mutationType: 'buffer' });
        (0, vitest_1.expect)(results.length).toBe(1);
        (0, vitest_1.expect)(results[0].mutationType).toBe('buffer');
    });
    (0, vitest_1.it)('respects limit', async () => {
        const results = await graph.query({ limit: 1 });
        (0, vitest_1.expect)(results.length).toBe(1);
    });
    (0, vitest_1.it)('queries by H3 cell', async () => {
        // Get a cell from Rome's nodes
        const romeNode = graph.getHead('rome-centro');
        const romeCell = romeNode.h3Cells[0];
        const results = await graph.query({ cell: romeCell });
        (0, vitest_1.expect)(results.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(results.every(n => n.h3Cells.includes(romeCell))).toBe(true);
    });
});
(0, vitest_1.describe)('SpatialMemoryGraph — chain integrity', () => {
    let graph;
    (0, vitest_1.it)('verifies a clean chain', async () => {
        graph = new spatial_memory_1.SpatialMemoryGraph();
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
        (0, vitest_1.expect)(result.valid).toBe(true);
        (0, vitest_1.expect)(result.nodeCount).toBe(2);
    });
    (0, vitest_1.it)('returns valid:true and nodeCount:0 for unknown feature', async () => {
        graph = new spatial_memory_1.SpatialMemoryGraph();
        const result = await graph.verifyChain('nonexistent');
        (0, vitest_1.expect)(result.valid).toBe(true);
        (0, vitest_1.expect)(result.nodeCount).toBe(0);
    });
});
(0, vitest_1.describe)('SpatialMemoryGraph — rollback', () => {
    let graph;
    (0, vitest_1.it)('rolls back to a previous state', async () => {
        graph = new spatial_memory_1.SpatialMemoryGraph();
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
        const head = graph.getHead('rollback-test');
        (0, vitest_1.expect)(JSON.stringify(head.feature.geometry))
            .toBe(JSON.stringify(romePolygon.geometry));
        // Full history has 3 nodes: create + buffer + rollback
        const history = await graph.getHistory('rollback-test');
        (0, vitest_1.expect)(history.length).toBe(3);
    });
});
(0, vitest_1.describe)('Singleton', () => {
    (0, vitest_1.it)('getSpatialMemory returns same instance', () => {
        (0, spatial_memory_1.resetSpatialMemory)();
        const a = (0, spatial_memory_1.getSpatialMemory)();
        const b = (0, spatial_memory_1.getSpatialMemory)();
        (0, vitest_1.expect)(a).toBe(b);
    });
});
//# sourceMappingURL=spatial_memory.test.js.map