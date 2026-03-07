import { AntManifest, AntFacet, AntTier, H3Cell } from '../types/index.js';
export interface AgentRegistry {
    register(manifest: AntManifest): Promise<void>;
    unregister(publicKey: string): Promise<void>;
    get(publicKey: string): Promise<AntManifest | null>;
    findEligibleAnts(cell: H3Cell, facet: AntFacet, minTier: AntTier): Promise<AntManifest[]>;
    hasAntsForFacet(facet: AntFacet): Promise<boolean>;
    list(): Promise<AntManifest[]>;
}
export declare class InMemoryRegistry implements AgentRegistry {
    private ants;
    register(manifest: AntManifest): Promise<void>;
    unregister(publicKey: string): Promise<void>;
    get(publicKey: string): Promise<AntManifest | null>;
    /**
     * Find all ants eligible for a task.
     * Eligibility: territory covers the cell + facet matches + tier ≥ minTier.
     */
    findEligibleAnts(cell: H3Cell, facet: AntFacet, minTier: AntTier): Promise<AntManifest[]>;
    hasAntsForFacet(facet: AntFacet): Promise<boolean>;
    list(): Promise<AntManifest[]>;
    get size(): number;
}
export declare function getRegistry(): AgentRegistry;
export declare function setRegistry(registry: AgentRegistry): void;
export declare function seedDevRegistry(registry: AgentRegistry): Promise<void>;
//# sourceMappingURL=registry.d.ts.map