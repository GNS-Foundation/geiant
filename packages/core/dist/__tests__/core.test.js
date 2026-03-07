// =============================================================================
// GEIANT — Core Test Suite
// =============================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { validateGeometries, validateGeometry, formatValidationError, computeTier, tierSatisfies, isInTerritory, buildHandle, parseHandle, InMemoryRegistry, resolveJurisdiction, isOperationPermitted, } from '../index.js';
import { latLngToCell, gridDisk } from 'h3-js';
// ---------------------------------------------------------------------------
// Geometry Validation
// ---------------------------------------------------------------------------
describe('GeometryGuard — validateGeometries', () => {
    it('accepts a valid point', () => {
        const result = validateGeometries([{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [12.496366, 41.902782] }, // Rome
                properties: {},
            }]);
        expect(result.valid).toBe(true);
    });
    it('rejects NaN coordinates', () => {
        const result = validateGeometry({ type: 'Point', coordinates: [NaN, 41.9] });
        expect(result.valid).toBe(false);
        expect(result.errorType).toBe('invalid_coordinate');
    });
    it('detects lat/lng transposition', () => {
        // Longitude 41.9 (looks like lat), Latitude 12.5 (looks like lng) — swapped
        const result = validateGeometry({ type: 'Point', coordinates: [41.9, 12.5] });
        // 41.9 is valid as longitude, so no transposition error — but coordinate [41.9, 12.5] is valid WGS84
        expect(result.valid).toBe(true);
        // This should be caught: clearly wrong — lat 200, lng 41
        const bad = validateGeometry({ type: 'Point', coordinates: [200, 41.9] });
        expect(bad.valid).toBe(false);
        expect(bad.errorType).toBe('coordinate_transposed');
        expect(bad.suggestion).toContain('swapping');
    });
    it('rejects out-of-range coordinates', () => {
        const result = validateGeometry({ type: 'Point', coordinates: [200, 200] });
        expect(result.valid).toBe(false);
        expect(result.errorType).toBe('invalid_coordinate');
    });
    it('rejects unclosed polygon ring', () => {
        const result = validateGeometry({
            type: 'Polygon',
            coordinates: [[[12.4, 41.9], [12.5, 41.9], [12.5, 42.0], [12.4, 42.0]]],
            // Note: no closing coordinate — last !== first
        });
        expect(result.valid).toBe(false);
        expect(result.errorType).toBe('unclosed_ring');
        expect(result.suggestion).toBeDefined();
    });
    it('accepts a valid closed polygon', () => {
        const result = validateGeometry({
            type: 'Polygon',
            coordinates: [[[12.4, 41.9], [12.5, 41.9], [12.5, 42.0], [12.4, 42.0], [12.4, 41.9]]],
        });
        expect(result.valid).toBe(true);
    });
    it('rejects self-intersecting polygon (bowtie)', () => {
        // Classic bowtie: two triangles sharing a vertex with crossing edges
        const result = validateGeometry({
            type: 'Polygon',
            coordinates: [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]],
        });
        expect(result.valid).toBe(false);
        expect(result.errorType).toBe('self_intersection');
    });
    it('rejects polygon with too few points', () => {
        const result = validateGeometry({
            type: 'Polygon',
            coordinates: [[[12.4, 41.9], [12.5, 41.9], [12.4, 41.9]]],
        });
        expect(result.valid).toBe(false);
        expect(result.errorType).toBe('unclosed_ring');
    });
    it('provides human-readable error messages', () => {
        const result = validateGeometry({ type: 'Point', coordinates: [NaN, 41.9] });
        const msg = formatValidationError(result);
        expect(msg).toContain('GEIANT GeometryGuard');
        expect(msg).toContain('invalid_coordinate');
    });
});
// ---------------------------------------------------------------------------
// Agent Identity / Tier
// ---------------------------------------------------------------------------
describe('AntIdentity — tier computation', () => {
    it('provisioned at 0 ops', () => expect(computeTier(0)).toBe('provisioned'));
    it('observed at 50 ops', () => expect(computeTier(50)).toBe('observed'));
    it('trusted at 500 ops', () => expect(computeTier(500)).toBe('trusted'));
    it('certified at 5000 ops', () => expect(computeTier(5000)).toBe('certified'));
    it('sovereign at 50000 ops', () => expect(computeTier(50000)).toBe('sovereign'));
    it('certified at 49999 ops', () => expect(computeTier(49999)).toBe('certified'));
    it('tierSatisfies — sovereign satisfies all', () => {
        const tiers = ['provisioned', 'observed', 'trusted', 'certified', 'sovereign'];
        tiers.forEach(t => expect(tierSatisfies('sovereign', t)).toBe(true));
    });
    it('tierSatisfies — provisioned only satisfies provisioned', () => {
        expect(tierSatisfies('provisioned', 'provisioned')).toBe(true);
        expect(tierSatisfies('provisioned', 'observed')).toBe(false);
    });
});
describe('Handle parsing', () => {
    it('builds correct handle', () => expect(buildHandle('health', 'eu-north')).toBe('health@eu-north'));
    it('sanitizes territory name', () => expect(buildHandle('grid', 'Rome Zone 1!')).toBe('grid@rome-zone-1-'));
    it('parses handle', () => {
        const p = parseHandle('finance@swiss');
        expect(p?.facet).toBe('finance');
        expect(p?.territory).toBe('swiss');
    });
    it('returns null for invalid handle', () => expect(parseHandle('no-at-sign')).toBeNull());
});
// ---------------------------------------------------------------------------
// Territory checks
// ---------------------------------------------------------------------------
describe('Territory containment', () => {
    it('cell is in its own territory', () => {
        const cell = latLngToCell(41.9, 12.5, 5); // Rome
        expect(isInTerritory(cell, [cell])).toBe(true);
    });
    it('cell is not in unrelated territory', () => {
        const rome = latLngToCell(41.9, 12.5, 5);
        const stockholm = latLngToCell(59.3, 18.0, 5);
        expect(isInTerritory(rome, [stockholm])).toBe(false);
    });
    it('border buffer allows adjacent cell', () => {
        const center = latLngToCell(41.9, 12.5, 5);
        const ring = gridDisk(center, 1);
        const adjacent = ring.find(c => c !== center);
        // Without buffer: fails
        expect(isInTerritory(adjacent, [center], false)).toBe(false);
        // With buffer: passes
        expect(isInTerritory(adjacent, [center], true)).toBe(true);
    });
});
// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
describe('InMemoryRegistry', () => {
    let registry;
    const makeManifest = (pk, facet, lat, lng) => ({
        identity: {
            publicKey: pk.padEnd(64, '0'),
            handle: buildHandle(facet, 'test-zone'),
            facet,
            territoryCells: gridDisk(latLngToCell(lat, lng, 5), 1),
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
    beforeEach(() => { registry = new InMemoryRegistry(); });
    it('registers and retrieves an ant', async () => {
        const ant = makeManifest('abc123', 'grid', 41.9, 12.5);
        await registry.register(ant);
        const retrieved = await registry.get(ant.identity.publicKey);
        expect(retrieved?.identity.handle).toBe('grid@test-zone');
    });
    it('rejects manifest with mismatched tier', async () => {
        const ant = makeManifest('abc456', 'health', 52.0, 10.0);
        ant.operationCount = 10; // should be 'provisioned', but tier says 'trusted'
        await expect(registry.register(ant)).rejects.toThrow('tier');
    });
    it('finds eligible ants by facet and territory', async () => {
        const gridAnt = makeManifest('g01', 'grid', 41.9, 12.5);
        const healthAnt = makeManifest('h01', 'health', 52.0, 10.0);
        await registry.register(gridAnt);
        await registry.register(healthAnt);
        const romeCell = latLngToCell(41.9, 12.5, 5);
        const eligible = await registry.findEligibleAnts(romeCell, 'grid', 'observed');
        expect(eligible.length).toBe(1);
        expect(eligible[0].identity.facet).toBe('grid');
    });
});
// ---------------------------------------------------------------------------
// Jurisdiction resolver
// ---------------------------------------------------------------------------
describe('Jurisdiction resolver', () => {
    it('resolves Rome to Italy with EU frameworks', async () => {
        const romeCell = latLngToCell(41.9, 12.5, 7);
        const result = await resolveJurisdiction(romeCell);
        expect(result).not.toBeNull();
        expect(result.countryCode).toBe('IT');
        expect(result.dataResidency).toBe('eu');
        expect(result.frameworks.some(f => f.id === 'GDPR')).toBe(true);
        expect(result.frameworks.some(f => f.id === 'EU_AI_ACT')).toBe(true);
    });
    it('resolves Zurich to Switzerland with FINMA', async () => {
        const zurichCell = latLngToCell(47.4, 8.5, 7);
        const result = await resolveJurisdiction(zurichCell);
        expect(result.countryCode).toBe('CH');
        expect(result.frameworks.some(f => f.id === 'FINMA')).toBe(true);
    });
    it('resolves San Francisco to US-CA with CCPA', async () => {
        const sfCell = latLngToCell(37.7, -122.4, 7);
        const result = await resolveJurisdiction(sfCell);
        expect(result.countryCode).toBe('US');
        expect(result.frameworks.some(f => f.id === 'CCPA')).toBe(true);
    });
    it('permits sovereign in US jurisdiction', async () => {
        const usCell = latLngToCell(40.7, -74.0, 7); // NYC
        const jurisdiction = await resolveJurisdiction(usCell);
        const check = isOperationPermitted(jurisdiction, 'sovereign');
        expect(check.permitted).toBe(true);
    });
    it('restricts sovereign in GDPR jurisdiction', async () => {
        const berlinCell = latLngToCell(52.5, 13.4, 7);
        const jurisdiction = await resolveJurisdiction(berlinCell);
        const check = isOperationPermitted(jurisdiction, 'sovereign');
        // GDPR maxAutonomyTier is 'trusted' — sovereign is too high
        expect(check.permitted).toBe(false);
        expect(check.restrictingFramework?.id).toBe('GDPR');
    });
});
//# sourceMappingURL=core.test.js.map