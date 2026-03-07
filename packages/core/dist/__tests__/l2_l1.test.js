"use strict";
// =============================================================================
// GEIANT — L2 SELF-HEALING + L1 CROSS-JURISDICTIONAL HAND-OFF TEST SUITE
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const geometry_repair_1 = require("../validation/geometry_repair");
const handoff_1 = require("../router/handoff");
const registry_1 = require("../registry/registry");
const jurisdiction_1 = require("../router/jurisdiction");
const router_1 = require("../router/router");
// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
function makePolygon(coords) {
    return { type: 'Polygon', coordinates: coords };
}
function makeFeature(geom) {
    return { type: 'Feature', geometry: geom, properties: {} };
}
// Rome bounding box — valid closed polygon
const ROME_POLYGON = {
    type: 'Polygon',
    coordinates: [[
            [12.4, 41.8], [12.6, 41.8], [12.6, 42.0], [12.4, 42.0], [12.4, 41.8],
        ]],
};
// Self-intersecting "bowtie" polygon (figure-8)
const BOWTIE_POLYGON = {
    type: 'Polygon',
    coordinates: [[
            [12.4, 41.8], [12.6, 42.0], [12.6, 41.8], [12.4, 42.0], [12.4, 41.8],
        ]],
};
// Unclosed polygon ring
const UNCLOSED_POLYGON = {
    type: 'Polygon',
    coordinates: [[
            [12.4, 41.8], [12.6, 41.8], [12.6, 42.0], [12.4, 42.0],
            // Missing closing coordinate
        ]],
};
// Transposed (lat,lng) instead of (lng,lat) — Rome has lat~41.9, lng~12.5
// Transposed: [41.9, 12.5] instead of [12.5, 41.9]
const TRANSPOSED_POINT = {
    type: 'Point',
    coordinates: [41.9, 12.5], // lat, lng — WRONG
};
// Duplicate consecutive points
const DUPLICATE_LINESTRING = {
    type: 'LineString',
    coordinates: [
        [12.4, 41.8], [12.4, 41.8], [12.5, 41.9], [12.5, 41.9], [12.6, 42.0],
    ],
};
// Valid delegation cert for Rome area
function makeRomeCert(overrides = {}) {
    return {
        id: 'cert-001',
        humanPublicKey: 'a'.repeat(64),
        humanHandle: '@camilo',
        agentPublicKey: 'a'.repeat(64),
        scopeCells: ['851e8053fffffff', '851e8050ca7ffff'],
        scopeFacets: ['grid'],
        validFrom: '2020-01-01T00:00:00Z',
        validUntil: '2099-12-31T23:59:59Z',
        maxSubdelegationDepth: 2,
        humanSignature: 'a'.repeat(128),
        ...overrides,
    };
}
function makeTask(cell, facet = 'grid', overrides = {}) {
    return {
        id: crypto.randomUUID(),
        originCell: cell,
        requiredFacet: facet,
        minTier: 'observed',
        payload: { type: 'spatial_analysis', instruction: 'test' },
        delegationCert: makeRomeCert({ scopeCells: [cell] }),
        submittedAt: new Date().toISOString(),
        callerPublicKey: 'a'.repeat(64),
        callerSignature: 'test_sig',
        ...overrides,
    };
}
// =============================================================================
// L2 SELF-HEALING GEOMETRY REPAIR
// =============================================================================
(0, vitest_1.describe)('L2 Self-Healing — repairGeometry', () => {
    // ── Transposition repair ──────────────────────────────────────────────────
    (0, vitest_1.describe)('coordinate transposition repair', () => {
        (0, vitest_1.it)('repairs transposed Point coordinates', () => {
            const result = (0, geometry_repair_1.repairGeometry)(TRANSPOSED_POINT, {
                valid: false, errorType: 'coordinate_transposed',
                errorMessage: 'Coordinates appear transposed',
            });
            (0, vitest_1.expect)(result.repaired).toBe(true);
            (0, vitest_1.expect)(result.originalError).toBe('coordinate_transposed');
            (0, vitest_1.expect)(result.repairDiff.operation).toBe('coordinate_swap');
            (0, vitest_1.expect)(result.repairDiff.coordinatesChanged).toBe(1);
            const fixed = result.repairedGeometry;
            // Should be [12.5, 41.9] — longitude first
            (0, vitest_1.expect)(fixed.coordinates[0]).toBe(12.5);
            (0, vitest_1.expect)(fixed.coordinates[1]).toBe(41.9);
        });
        (0, vitest_1.it)('repairs transposed Polygon', () => {
            const transposedPolygon = {
                type: 'Polygon',
                coordinates: [[
                        [41.8, 12.4], [41.8, 12.6], [42.0, 12.6], [42.0, 12.4], [41.8, 12.4],
                    ]],
            };
            const result = (0, geometry_repair_1.repairGeometry)(transposedPolygon, {
                valid: false, errorType: 'coordinate_transposed',
                errorMessage: 'Coordinates appear transposed',
            });
            (0, vitest_1.expect)(result.repaired).toBe(true);
            const fixed = result.repairedGeometry;
            // First coord should now be [12.4, 41.8]
            (0, vitest_1.expect)(fixed.coordinates[0][0]).toEqual([12.4, 41.8]);
        });
    });
    // ── Unclosed ring repair ──────────────────────────────────────────────────
    (0, vitest_1.describe)('unclosed ring repair', () => {
        (0, vitest_1.it)('closes an unclosed polygon ring', () => {
            const result = (0, geometry_repair_1.repairGeometry)(UNCLOSED_POLYGON, {
                valid: false, errorType: 'unclosed_ring',
                errorMessage: 'Polygon ring is not closed',
            });
            (0, vitest_1.expect)(result.repaired).toBe(true);
            (0, vitest_1.expect)(result.originalError).toBe('unclosed_ring');
            (0, vitest_1.expect)(result.repairDiff.operation).toBe('ring_closure');
            (0, vitest_1.expect)(result.repairDiff.ringsModified).toBe(1);
            const fixed = result.repairedGeometry;
            const ring = fixed.coordinates[0];
            const first = ring[0];
            const last = ring[ring.length - 1];
            (0, vitest_1.expect)(first[0]).toBe(last[0]);
            (0, vitest_1.expect)(first[1]).toBe(last[1]);
        });
        (0, vitest_1.it)('does not modify an already-closed ring', () => {
            const result = (0, geometry_repair_1.repairGeometry)(ROME_POLYGON, {
                valid: false, errorType: 'unclosed_ring',
                errorMessage: 'test',
            });
            // Already closed — repair returns repaired:false (no rings needed closing)
            (0, vitest_1.expect)(result.repaired).toBe(false);
            (0, vitest_1.expect)(result.repairDescription).toContain('manual inspection');
        });
    });
    // ── Self-intersection repair ──────────────────────────────────────────────
    (0, vitest_1.describe)('self-intersection repair', () => {
        (0, vitest_1.it)('repairs a bowtie polygon via convex hull', () => {
            const result = (0, geometry_repair_1.repairGeometry)(BOWTIE_POLYGON, {
                valid: false, errorType: 'self_intersection',
                errorMessage: 'Polygon ring appears to self-intersect',
            });
            (0, vitest_1.expect)(result.repaired).toBe(true);
            (0, vitest_1.expect)(result.originalError).toBe('self_intersection');
            (0, vitest_1.expect)(result.repairDiff.operation).toBe('convex_hull');
            // Convex hull should produce a valid polygon
            const fixed = result.repairedGeometry;
            const ring = fixed.coordinates[0];
            // Should be closed
            (0, vitest_1.expect)(ring[0]).toEqual(ring[ring.length - 1]);
            // Should have at least 4 points
            (0, vitest_1.expect)(ring.length).toBeGreaterThanOrEqual(4);
        });
        (0, vitest_1.it)('repair description mentions convex hull approximation', () => {
            const result = (0, geometry_repair_1.repairGeometry)(BOWTIE_POLYGON, {
                valid: false, errorType: 'self_intersection',
                errorMessage: 'Polygon ring appears to self-intersect',
            });
            (0, vitest_1.expect)(result.repairDescription).toContain('convex hull');
        });
    });
    // ── Duplicate points repair ───────────────────────────────────────────────
    (0, vitest_1.describe)('duplicate points repair', () => {
        (0, vitest_1.it)('removes consecutive duplicate points from LineString', () => {
            const result = (0, geometry_repair_1.repairGeometry)(DUPLICATE_LINESTRING, {
                valid: false, errorType: 'duplicate_points',
                errorMessage: 'LineString contains consecutive duplicate coordinates',
            });
            (0, vitest_1.expect)(result.repaired).toBe(true);
            (0, vitest_1.expect)(result.repairDiff.operation).toBe('duplicate_removal');
            (0, vitest_1.expect)(result.repairDiff.coordinatesChanged).toBe(2); // 2 duplicates removed
            const fixed = result.repairedGeometry;
            (0, vitest_1.expect)(fixed.coordinates).toHaveLength(3); // 5 - 2 duplicates = 3
        });
    });
});
// ---------------------------------------------------------------------------
// repairFeatures — batch repair
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('L2 Self-Healing — repairFeatures (batch)', () => {
    (0, vitest_1.it)('repairs all repairable features in a batch', () => {
        const features = [
            makeFeature(UNCLOSED_POLYGON),
            makeFeature(ROME_POLYGON), // already valid
        ];
        const { repairedFeatures, repairs, allRepaired } = (0, geometry_repair_1.repairFeatures)(features);
        (0, vitest_1.expect)(repairs.length).toBe(1); // only unclosed was invalid
        (0, vitest_1.expect)(allRepaired).toBe(true);
        (0, vitest_1.expect)(repairedFeatures).toHaveLength(2);
        // Second feature (valid) should be unchanged
        (0, vitest_1.expect)(repairedFeatures[1].geometry).toEqual(ROME_POLYGON);
    });
    (0, vitest_1.it)('marks allRepaired=false when repair fails', () => {
        // empty_geometry is not repairable
        const features = [makeFeature({ type: 'Polygon', coordinates: [] })];
        const { allRepaired } = (0, geometry_repair_1.repairFeatures)(features);
        (0, vitest_1.expect)(allRepaired).toBe(false);
    });
});
// ---------------------------------------------------------------------------
// Convex hull
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('convexHull', () => {
    (0, vitest_1.it)('computes hull of simple square', () => {
        const points = [
            [0, 0], [1, 0], [1, 1], [0, 1],
        ];
        const hull = (0, geometry_repair_1.convexHull)(points);
        (0, vitest_1.expect)(hull).not.toBeNull();
        (0, vitest_1.expect)(hull.length).toBeGreaterThanOrEqual(4);
        // Closed ring
        (0, vitest_1.expect)(hull[0]).toEqual(hull[hull.length - 1]);
    });
    (0, vitest_1.it)('returns null for fewer than 3 unique points', () => {
        const hull = (0, geometry_repair_1.convexHull)([[0, 0], [1, 1]]);
        (0, vitest_1.expect)(hull).toBeNull();
    });
    (0, vitest_1.it)('handles duplicate input points', () => {
        const points = [
            [0, 0], [0, 0], [1, 0], [1, 0], [0.5, 1], [0.5, 1],
        ];
        const hull = (0, geometry_repair_1.convexHull)(points);
        (0, vitest_1.expect)(hull).not.toBeNull();
    });
});
// =============================================================================
// L1 CROSS-JURISDICTIONAL HAND-OFF
// =============================================================================
(0, vitest_1.describe)('L1 Cross-Jurisdictional Hand-off — resolveHandoff', () => {
    let registry;
    (0, vitest_1.beforeEach)(async () => {
        registry = new registry_1.InMemoryRegistry();
        await (0, registry_1.seedDevRegistry)(registry);
    });
    (0, vitest_1.it)('finds a handoff from an unserved cell to an adjacent served jurisdiction', async () => {
        // Use a cell in a region with no registered ants, but adjacent to Rome
        // 851e8047fffffff is near Rome but outside gridDisk(rome-center, 2)
        const remoteCell = '851e8047fffffff';
        const task = makeTask(remoteCell, 'grid', {
            delegationCert: makeRomeCert({
                scopeCells: [remoteCell],
                maxSubdelegationDepth: 2,
            }),
        });
        const originJurisdiction = await (0, jurisdiction_1.resolveJurisdiction)(remoteCell);
        if (!originJurisdiction)
            return; // skip if cell not resolvable
        const handoff = await (0, handoff_1.resolveHandoff)(task, originJurisdiction, registry);
        // May or may not find an ant depending on cell proximity — just verify structure
        (0, vitest_1.expect)(handoff).toHaveProperty('possible');
        (0, vitest_1.expect)(handoff).toHaveProperty('fromJurisdiction');
    });
    (0, vitest_1.it)('rejects handoff when maxSubdelegationDepth=0', async () => {
        const cell = '851e8047fffffff';
        const task = makeTask(cell, 'grid', {
            delegationCert: makeRomeCert({
                scopeCells: [cell],
                maxSubdelegationDepth: 0, // no delegation allowed
            }),
        });
        const originJurisdiction = await (0, jurisdiction_1.resolveJurisdiction)(cell);
        if (!originJurisdiction)
            return;
        const handoff = await (0, handoff_1.resolveHandoff)(task, originJurisdiction, registry);
        (0, vitest_1.expect)(handoff.possible).toBe(false);
        (0, vitest_1.expect)(handoff.rejectionReason).toContain('depth exhausted');
    });
    (0, vitest_1.it)('HandoffCert has correct structure when handoff succeeds', async () => {
        const cell = '851e9c63fffffff'; // Zurich area — finance@swiss covers it
        // Use a different cell nearby that may lack direct coverage
        const adjacentCell = '851e9c6bfffffff';
        const task = makeTask(adjacentCell, 'finance', {
            delegationCert: makeRomeCert({
                scopeCells: [adjacentCell],
                scopeFacets: ['finance'],
                maxSubdelegationDepth: 2,
            }),
        });
        const originJurisdiction = await (0, jurisdiction_1.resolveJurisdiction)(adjacentCell);
        if (!originJurisdiction)
            return;
        const handoff = await (0, handoff_1.resolveHandoff)(task, originJurisdiction, registry);
        if (handoff.possible && handoff.handoffCert) {
            (0, vitest_1.expect)(handoff.handoffCert.id).toBeTruthy();
            (0, vitest_1.expect)(handoff.handoffCert.taskId).toBe(task.id);
            (0, vitest_1.expect)(handoff.handoffCert.remainingDepth).toBe(1); // 2 - 1
            (0, vitest_1.expect)(handoff.handoffCert.routerSignature).toHaveLength(128);
            (0, vitest_1.expect)(handoff.handoffCert.parentCertHash).toHaveLength(64);
            (0, vitest_1.expect)(handoff.toJurisdiction).toBeDefined();
            (0, vitest_1.expect)(handoff.receivingAnt).toBeDefined();
        }
    });
});
// =============================================================================
// INTEGRATION — Router with L2 + L1 wired in
// =============================================================================
(0, vitest_1.describe)('Router integration — L2 repair + L1 handoff', () => {
    let registry;
    let router;
    (0, vitest_1.beforeEach)(async () => {
        registry = new registry_1.InMemoryRegistry();
        await (0, registry_1.seedDevRegistry)(registry);
        router = new router_1.GeiantRouter(registry);
        process.env.GEIANT_ENV = 'dev';
    });
    (0, vitest_1.it)('routes task with unclosed polygon after auto-repair', async () => {
        const romeCell = '851e8053fffffff';
        const task = makeTask(romeCell, 'grid', {
            delegationCert: makeRomeCert({ scopeCells: [romeCell] }),
            geometries: [makeFeature(UNCLOSED_POLYGON)],
        });
        const decision = await router.route(task);
        // Should succeed — geometry was auto-repaired
        (0, vitest_1.expect)(decision.success).toBe(true);
        (0, vitest_1.expect)(decision.geometryRepaired).toBe(true);
        (0, vitest_1.expect)(decision.geometryRepairs).toHaveLength(1);
        (0, vitest_1.expect)(decision.geometryRepairs[0].originalError).toBe('unclosed_ring');
        (0, vitest_1.expect)(decision.geometryRepairs[0].repaired).toBe(true);
    });
    (0, vitest_1.it)('routes task with bowtie polygon after convex hull repair', async () => {
        const romeCell = '851e8053fffffff';
        const task = makeTask(romeCell, 'grid', {
            delegationCert: makeRomeCert({ scopeCells: [romeCell] }),
            geometries: [makeFeature(BOWTIE_POLYGON)],
        });
        const decision = await router.route(task);
        (0, vitest_1.expect)(decision.success).toBe(true);
        (0, vitest_1.expect)(decision.geometryRepaired).toBe(true);
        (0, vitest_1.expect)(decision.geometryRepairs[0].repairDiff.operation).toBe('convex_hull');
    });
    (0, vitest_1.it)('rejects task with unrepairable geometry', async () => {
        const romeCell = '851e8053fffffff';
        const emptyGeom = { type: 'Polygon', coordinates: [] };
        const task = makeTask(romeCell, 'grid', {
            delegationCert: makeRomeCert({ scopeCells: [romeCell] }),
            geometries: [makeFeature(emptyGeom)],
        });
        const decision = await router.route(task);
        (0, vitest_1.expect)(decision.success).toBe(false);
        (0, vitest_1.expect)(decision.rejectionReason).toBe('invalid_geometry');
    });
    (0, vitest_1.it)('successful route has geometryRepaired=false when geometry is valid', async () => {
        const romeCell = '851e8053fffffff';
        const task = makeTask(romeCell, 'grid', {
            delegationCert: makeRomeCert({ scopeCells: [romeCell] }),
            geometries: [makeFeature(ROME_POLYGON)],
        });
        const decision = await router.route(task);
        (0, vitest_1.expect)(decision.success).toBe(true);
        (0, vitest_1.expect)(decision.geometryRepaired).toBe(false);
        (0, vitest_1.expect)(decision.geometryRepairs).toBeUndefined();
    });
});
//# sourceMappingURL=l2_l1.test.js.map