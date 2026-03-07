// =============================================================================
// GEIANT — AGENT REGISTRY
// The directory of registered ants. The router queries this to find candidates.
// =============================================================================
//
// Phase 0: In-memory registry (Map). Fast, zero-dependency, testable.
// Phase 1: Supabase-backed registry with H3 spatial indexing.
// Phase 2: Distributed registry with GNS-node integration.
//
// The registry is the geospatial agent directory — the "DNS for ants".
// It answers: "Which ants can handle a task at this location with this facet?"
// =============================================================================
import { isInTerritory, tierSatisfies, validateManifestStructure, computeTier, derivestellarAccountId } from '../agent/identity.js';
// ---------------------------------------------------------------------------
// Phase 0: In-memory implementation
// ---------------------------------------------------------------------------
export class InMemoryRegistry {
    ants = new Map();
    async register(manifest) {
        const { valid, errors } = validateManifestStructure(manifest);
        if (!valid) {
            throw new Error(`Invalid manifest: ${errors.join(', ')}`);
        }
        this.ants.set(manifest.identity.publicKey, manifest);
        console.log(`[GEIANT Registry] Registered ant: ${manifest.identity.handle} (${manifest.identity.tier})`);
    }
    async unregister(publicKey) {
        this.ants.delete(publicKey);
    }
    async get(publicKey) {
        return this.ants.get(publicKey) ?? null;
    }
    /**
     * Find all ants eligible for a task.
     * Eligibility: territory covers the cell + facet matches + tier ≥ minTier.
     */
    async findEligibleAnts(cell, facet, minTier) {
        return Array.from(this.ants.values()).filter(ant => {
            const facetMatch = ant.identity.facet === facet || ant.identity.facet === 'general';
            const tierOk = tierSatisfies(ant.identity.tier, minTier);
            const territoryOk = isInTerritory(cell, ant.identity.territoryCells, true);
            return facetMatch && tierOk && territoryOk;
        });
    }
    async hasAntsForFacet(facet) {
        return Array.from(this.ants.values()).some(ant => ant.identity.facet === facet || ant.identity.facet === 'general');
    }
    async list() {
        return Array.from(this.ants.values());
    }
    get size() {
        return this.ants.size;
    }
}
// ---------------------------------------------------------------------------
// Registry factory
// ---------------------------------------------------------------------------
let _registry = null;
export function getRegistry() {
    if (!_registry) {
        _registry = new InMemoryRegistry();
    }
    return _registry;
}
export function setRegistry(registry) {
    _registry = registry;
}
// ---------------------------------------------------------------------------
// Seed data — example ants for development / testing
// ---------------------------------------------------------------------------
export async function seedDevRegistry(registry) {
    const { latLngToCell, gridDisk } = await import('h3-js');
    const makeAnt = (publicKey, handle, facet, lat, lng, operationCount) => {
        const centerCell = latLngToCell(lat, lng, 5);
        const cells = gridDisk(centerCell, 2);
        return {
            identity: {
                publicKey,
                handle,
                facet,
                territoryCells: cells,
                tier: computeTier(operationCount),
                provisionedAt: '2026-01-01T00:00:00Z',
                stellarAccountId: derivestellarAccountId(publicKey),
            },
            description: `GEIANT ${facet} agent for ${handle.split('@')[1]}`,
            capabilities: [facet, 'h3', 'gdal'],
            mcpEndpoints: [],
            operationCount,
            complianceScore: 85,
            signature: 'a'.repeat(128),
            updatedAt: new Date().toISOString(),
        };
    };
    const seeds = [
        // Rome — grid/infrastructure (Terna/Areti use case)
        makeAnt('a'.repeat(64), 'grid@rome-zone-1', 'grid', 41.9, 12.5, 1200),
        // Milan — finance
        makeAnt('b'.repeat(64), 'finance@milan', 'finance', 45.5, 9.2, 650),
        // EU North — health/GDPR
        makeAnt('c'.repeat(64), 'health@eu-north', 'health', 52.0, 10.0, 5500),
        // Zurich — finance/FINMA
        makeAnt('d'.repeat(64), 'finance@swiss', 'finance', 47.4, 8.5, 8200),
        // General EU environment/EO
        makeAnt('e'.repeat(64), 'environment@eu', 'environment', 48.0, 7.0, 300),
    ];
    for (const ant of seeds) {
        await registry.register(ant);
    }
    console.log(`[GEIANT Registry] Seeded ${seeds.length} dev ants`);
}
//# sourceMappingURL=registry.js.map