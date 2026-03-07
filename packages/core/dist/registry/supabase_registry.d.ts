import { AntManifest, AntFacet, AntTier, H3Cell } from '../types/index.js';
import type { AgentRegistry } from './registry.js';
export declare class SupabaseRegistry implements AgentRegistry {
    private client;
    private cache;
    private readonly cacheTtlMs;
    private listCache;
    constructor(supabaseUrl: string, serviceRoleKey: string, cacheTtlMs?: number);
    register(manifest: AntManifest): Promise<void>;
    unregister(publicKey: string): Promise<void>;
    get(publicKey: string): Promise<AntManifest | null>;
    findEligibleAnts(cell: H3Cell, facet: AntFacet, minTier: AntTier): Promise<AntManifest[]>;
    hasAntsForFacet(facet: AntFacet): Promise<boolean>;
    list(): Promise<AntManifest[]>;
    clearCache(): void;
    getCacheSize(): number;
    ping(): Promise<boolean>;
}
export declare function createSupabaseRegistry(): SupabaseRegistry;
//# sourceMappingURL=supabase_registry.d.ts.map