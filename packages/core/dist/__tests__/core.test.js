"use strict";
// =============================================================================
// GEIANT — Core Test Suite
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const index_1 = require("../index");
const h3_js_1 = require("h3-js");
// ---------------------------------------------------------------------------
// Geometry Validation
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('GeometryGuard — validateGeometries', () => {
    (0, vitest_1.it)('accepts a valid point', () => {
        const result = (0, index_1.validateGeometries)([{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [12.496366, 41.902782] }, // Rome
                properties: {},
            }]);
        (0, vitest_1.expect)(result.valid).toBe(true);
    });
    (0, vitest_1.it)('rejects NaN coordinates', () => {
        const result = (0, index_1.validateGeometry)({ type: 'Point', coordinates: [NaN, 41.9] });
        (0, vitest_1.expect)(result.valid).toBe(false);
        (0, vitest_1.expect)(result.errorType).toBe('invalid_coordinate');
    });
    (0, vitest_1.it)('detects lat/lng transposition', () => {
        // Longitude 41.9 (looks like lat), Latitude 12.5 (looks like lng) — swapped
        const result = (0, index_1.validateGeometry)({ type: 'Point', coordinates: [41.9, 12.5] });
        // 41.9 is valid as longitude, so no transposition error — but coordinate [41.9, 12.5] is valid WGS84
        (0, vitest_1.expect)(result.valid).toBe(true);
        // This should be caught: clearly wrong — lat 200, lng 41
        const bad = (0, index_1.validateGeometry)({ type: 'Point', coordinates: [200, 41.9] });
        (0, vitest_1.expect)(bad.valid).toBe(false);
        (0, vitest_1.expect)(bad.errorType).toBe('coordinate_transposed');
        (0, vitest_1.expect)(bad.suggestion).toContain('swapping');
    });
    (0, vitest_1.it)('rejects out-of-range coordinates', () => {
        const result = (0, index_1.validateGeometry)({ type: 'Point', coordinates: [200, 200] });
        (0, vitest_1.expect)(result.valid).toBe(false);
        (0, vitest_1.expect)(result.errorType).toBe('invalid_coordinate');
    });
    (0, vitest_1.it)('rejects unclosed polygon ring', () => {
        const result = (0, index_1.validateGeometry)({
            type: 'Polygon',
            coordinates: [[[12.4, 41.9], [12.5, 41.9], [12.5, 42.0], [12.4, 42.0]]],
            // Note: no closing coordinate — last !== first
        });
        (0, vitest_1.expect)(result.valid).toBe(false);
        (0, vitest_1.expect)(result.errorType).toBe('unclosed_ring');
        (0, vitest_1.expect)(result.suggestion).toBeDefined();
    });
    (0, vitest_1.it)('accepts a valid closed polygon', () => {
        const result = (0, index_1.validateGeometry)({
            type: 'Polygon',
            coordinates: [[[12.4, 41.9], [12.5, 41.9], [12.5, 42.0], [12.4, 42.0], [12.4, 41.9]]],
        });
        (0, vitest_1.expect)(result.valid).toBe(true);
    });
    (0, vitest_1.it)('rejects self-intersecting polygon (bowtie)', () => {
        // Classic bowtie: two triangles sharing a vertex with crossing edges
        const result = (0, index_1.validateGeometry)({
            type: 'Polygon',
            coordinates: [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]],
        });
        (0, vitest_1.expect)(result.valid).toBe(false);
        (0, vitest_1.expect)(result.errorType).toBe('self_intersection');
    });
    (0, vitest_1.it)('rejects polygon with too few points', () => {
        const result = (0, index_1.validateGeometry)({
            type: 'Polygon',
            coordinates: [[[12.4, 41.9], [12.5, 41.9], [12.4, 41.9]]],
        });
        (0, vitest_1.expect)(result.valid).toBe(false);
        (0, vitest_1.expect)(result.errorType).toBe('unclosed_ring');
    });
    (0, vitest_1.it)('provides human-readable error messages', () => {
        const result = (0, index_1.validateGeometry)({ type: 'Point', coordinates: [NaN, 41.9] });
        const msg = (0, index_1.formatValidationError)(result);
        (0, vitest_1.expect)(msg).toContain('GEIANT GeometryGuard');
        (0, vitest_1.expect)(msg).toContain('invalid_coordinate');
    });
});
// ---------------------------------------------------------------------------
// Agent Identity / Tier
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('AntIdentity — tier computation', () => {
    (0, vitest_1.it)('provisioned at 0 ops', () => (0, vitest_1.expect)((0, index_1.computeTier)(0)).toBe('provisioned'));
    (0, vitest_1.it)('observed at 50 ops', () => (0, vitest_1.expect)((0, index_1.computeTier)(50)).toBe('observed'));
    (0, vitest_1.it)('trusted at 500 ops', () => (0, vitest_1.expect)((0, index_1.computeTier)(500)).toBe('trusted'));
    (0, vitest_1.it)('certified at 5000 ops', () => (0, vitest_1.expect)((0, index_1.computeTier)(5000)).toBe('certified'));
    (0, vitest_1.it)('sovereign at 50000 ops', () => (0, vitest_1.expect)((0, index_1.computeTier)(50000)).toBe('sovereign'));
    (0, vitest_1.it)('certified at 49999 ops', () => (0, vitest_1.expect)((0, index_1.computeTier)(49999)).toBe('certified'));
    (0, vitest_1.it)('tierSatisfies — sovereign satisfies all', () => {
        const tiers = ['provisioned', 'observed', 'trusted', 'certified', 'sovereign'];
        tiers.forEach(t => (0, vitest_1.expect)((0, index_1.tierSatisfies)('sovereign', t)).toBe(true));
    });
    (0, vitest_1.it)('tierSatisfies — provisioned only satisfies provisioned', () => {
        (0, vitest_1.expect)((0, index_1.tierSatisfies)('provisioned', 'provisioned')).toBe(true);
        (0, vitest_1.expect)((0, index_1.tierSatisfies)('provisioned', 'observed')).toBe(false);
    });
});
(0, vitest_1.describe)('Handle parsing', () => {
    (0, vitest_1.it)('builds correct handle', () => (0, vitest_1.expect)((0, index_1.buildHandle)('health', 'eu-north')).toBe('health@eu-north'));
    (0, vitest_1.it)('sanitizes territory name', () => (0, vitest_1.expect)((0, index_1.buildHandle)('grid', 'Rome Zone 1!')).toBe('grid@rome-zone-1-'));
    (0, vitest_1.it)('parses handle', () => {
        const p = (0, index_1.parseHandle)('finance@swiss');
        (0, vitest_1.expect)(p?.facet).toBe('finance');
        (0, vitest_1.expect)(p?.territory).toBe('swiss');
    });
    (0, vitest_1.it)('returns null for invalid handle', () => (0, vitest_1.expect)((0, index_1.parseHandle)('no-at-sign')).toBeNull());
});
// ---------------------------------------------------------------------------
// Territory checks
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('Territory containment', () => {
    (0, vitest_1.it)('cell is in its own territory', () => {
        const cell = (0, h3_js_1.latLngToCell)(41.9, 12.5, 5); // Rome
        (0, vitest_1.expect)((0, index_1.isInTerritory)(cell, [cell])).toBe(true);
    });
    (0, vitest_1.it)('cell is not in unrelated territory', () => {
        const rome = (0, h3_js_1.latLngToCell)(41.9, 12.5, 5);
        const stockholm = (0, h3_js_1.latLngToCell)(59.3, 18.0, 5);
        (0, vitest_1.expect)((0, index_1.isInTerritory)(rome, [stockholm])).toBe(false);
    });
    (0, vitest_1.it)('border buffer allows adjacent cell', () => {
        const center = (0, h3_js_1.latLngToCell)(41.9, 12.5, 5);
        const ring = (0, h3_js_1.gridDisk)(center, 1);
        const adjacent = ring.find(c => c !== center);
        // Without buffer: fails
        (0, vitest_1.expect)((0, index_1.isInTerritory)(adjacent, [center], false)).toBe(false);
        // With buffer: passes
        (0, vitest_1.expect)((0, index_1.isInTerritory)(adjacent, [center], true)).toBe(true);
    });
});
// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('InMemoryRegistry', () => {
    let registry;
    const makeManifest = (pk, facet, lat, lng) => ({
        identity: {
            publicKey: pk.padEnd(64, '0'),
            handle: (0, index_1.buildHandle)(facet, 'test-zone'),
            facet,
            territoryCells: (0, h3_js_1.gridDisk)((0, h3_js_1.latLngToCell)(lat, lng, 5), 1),
            tier: 'trusted',
            provisionedAt: new Date().toISOString(),
            stellarAccountId: 'G_STUB',
        },
        description: 'test ant',
        capabilities: [facet],
        mcpEndpoints: [],
        operationCount: 500,
        complianceScore: 90,
        signature: 'a'.repeat(128),
        updatedAt: new Date().toISOString(),
    });
    (0, vitest_1.beforeEach)(() => { registry = new index_1.InMemoryRegistry(); });
    (0, vitest_1.it)('registers and retrieves an ant', async () => {
        const ant = makeManifest('abc123', 'grid', 41.9, 12.5);
        await registry.register(ant);
        const retrieved = await registry.get(ant.identity.publicKey);
        (0, vitest_1.expect)(retrieved?.identity.handle).toBe('grid@test-zone');
    });
    (0, vitest_1.it)('rejects manifest with mismatched tier', async () => {
        const ant = makeManifest('abc456', 'health', 52.0, 10.0);
        ant.operationCount = 10; // should be 'provisioned', but tier says 'trusted'
        await (0, vitest_1.expect)(registry.register(ant)).rejects.toThrow('tier');
    });
    (0, vitest_1.it)('finds eligible ants by facet and territory', async () => {
        const gridAnt = makeManifest('g01', 'grid', 41.9, 12.5);
        const healthAnt = makeManifest('h01', 'health', 52.0, 10.0);
        await registry.register(gridAnt);
        await registry.register(healthAnt);
        const romeCell = (0, h3_js_1.latLngToCell)(41.9, 12.5, 5);
        const eligible = await registry.findEligibleAnts(romeCell, 'grid', 'observed');
        (0, vitest_1.expect)(eligible.length).toBe(1);
        (0, vitest_1.expect)(eligible[0].identity.facet).toBe('grid');
    });
});
// ---------------------------------------------------------------------------
// Jurisdiction resolver
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('Jurisdiction resolver', () => {
    (0, vitest_1.it)('resolves Rome to Italy with EU frameworks', async () => {
        const romeCell = (0, h3_js_1.latLngToCell)(41.9, 12.5, 7);
        const result = await (0, index_1.resolveJurisdiction)(romeCell);
        (0, vitest_1.expect)(result).not.toBeNull();
        (0, vitest_1.expect)(result.countryCode).toBe('IT');
        (0, vitest_1.expect)(result.dataResidency).toBe('eu');
        (0, vitest_1.expect)(result.frameworks.some(f => f.id === 'GDPR')).toBe(true);
        (0, vitest_1.expect)(result.frameworks.some(f => f.id === 'EU_AI_ACT')).toBe(true);
    });
    (0, vitest_1.it)('resolves Zurich to Switzerland with FINMA', async () => {
        const zurichCell = (0, h3_js_1.latLngToCell)(47.4, 8.5, 7);
        const result = await (0, index_1.resolveJurisdiction)(zurichCell);
        (0, vitest_1.expect)(result.countryCode).toBe('CH');
        (0, vitest_1.expect)(result.frameworks.some(f => f.id === 'FINMA')).toBe(true);
    });
    (0, vitest_1.it)('resolves San Francisco to US-CA with CCPA', async () => {
        const sfCell = (0, h3_js_1.latLngToCell)(37.7, -122.4, 7);
        const result = await (0, index_1.resolveJurisdiction)(sfCell);
        (0, vitest_1.expect)(result.countryCode).toBe('US');
        (0, vitest_1.expect)(result.frameworks.some(f => f.id === 'CCPA')).toBe(true);
    });
    (0, vitest_1.it)('permits sovereign in US jurisdiction', async () => {
        const usCell = (0, h3_js_1.latLngToCell)(40.7, -74.0, 7); // NYC
        const jurisdiction = await (0, index_1.resolveJurisdiction)(usCell);
        const check = (0, index_1.isOperationPermitted)(jurisdiction, 'sovereign');
        (0, vitest_1.expect)(check.permitted).toBe(true);
    });
    (0, vitest_1.it)('restricts sovereign in GDPR jurisdiction', async () => {
        const berlinCell = (0, h3_js_1.latLngToCell)(52.5, 13.4, 7);
        const jurisdiction = await (0, index_1.resolveJurisdiction)(berlinCell);
        const check = (0, index_1.isOperationPermitted)(jurisdiction, 'sovereign');
        // GDPR maxAutonomyTier is 'trusted' — sovereign is too high
        (0, vitest_1.expect)(check.permitted).toBe(false);
        (0, vitest_1.expect)(check.restrictingFramework?.id).toBe('GDPR');
    });
});
//# sourceMappingURL=core.test.js.map