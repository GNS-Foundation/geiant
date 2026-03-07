"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryRegistry = void 0;
exports.getRegistry = getRegistry;
exports.setRegistry = setRegistry;
exports.seedDevRegistry = seedDevRegistry;
const identity_js_1 = require("../agent/identity.js");
// ---------------------------------------------------------------------------
// Phase 0: In-memory implementation
// ---------------------------------------------------------------------------
class InMemoryRegistry {
    ants = new Map();
    async register(manifest) {
        const { valid, errors } = (0, identity_js_1.validateManifestStructure)(manifest);
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
            const tierOk = (0, identity_js_1.tierSatisfies)(ant.identity.tier, minTier);
            const territoryOk = (0, identity_js_1.isInTerritory)(cell, ant.identity.territoryCells, true);
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
exports.InMemoryRegistry = InMemoryRegistry;
// ---------------------------------------------------------------------------
// Registry factory
// ---------------------------------------------------------------------------
let _registry = null;
function getRegistry() {
    if (!_registry) {
        _registry = new InMemoryRegistry();
    }
    return _registry;
}
function setRegistry(registry) {
    _registry = registry;
}
// ---------------------------------------------------------------------------
// Seed data — example ants for development / testing
// ---------------------------------------------------------------------------
async function seedDevRegistry(registry) {
    const { latLngToCell, gridDisk } = await Promise.resolve().then(() => __importStar(require('h3-js')));
    const makeAnt = (publicKey, handle, facet, lat, lng, operationCount) => {
        const centerCell = latLngToCell(lat, lng, 5);
        const cells = gridDisk(centerCell, 2);
        return {
            identity: {
                publicKey,
                handle,
                facet,
                territoryCells: cells,
                tier: (0, identity_js_1.computeTier)(operationCount),
                provisionedAt: '2026-01-01T00:00:00Z',
                stellarAccountId: (0, identity_js_1.derivestellarAccountId)(publicKey),
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