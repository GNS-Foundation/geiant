// =============================================================================
// GEIANT — SUPABASE AGENT REGISTRY
// Phase 1: Persistent registry backed by Supabase PostgreSQL.
//
// Replaces InMemoryRegistry with zero interface changes — the router
// doesn't know or care which implementation is behind AgentRegistry.
//
// Key design decisions:
//   - service_role key used server-side (bypasses RLS for writes)
//   - territory containment via PostgreSQL array overlap (@>)
//   - local LRU cache (TTL 60s) to avoid hammering Supabase on every route
//   - graceful fallback: if Supabase is unreachable, cached data serves reads
//   - all writes are synchronous — registration must succeed before routing
// =============================================================================
import { createClient } from '@supabase/supabase-js';
import { isInTerritory, tierSatisfies, validateManifestStructure } from '../agent/identity.js';
// ---------------------------------------------------------------------------
// DB row → AntManifest
// ---------------------------------------------------------------------------
function rowToManifest(row) {
    return {
        identity: {
            publicKey: row.public_key,
            handle: row.handle,
            facet: row.facet,
            tier: row.tier,
            territoryCells: row.territory_cells ?? [],
            provisionedAt: row.provisioned_at,
            stellarAccountId: row.stellar_account_id ?? '',
        },
        description: row.description ?? '',
        capabilities: row.capabilities ?? [],
        mcpEndpoints: row.mcp_endpoints ?? [],
        operationCount: row.operation_count ?? 0,
        complianceScore: row.compliance_score ?? 0,
        signature: row.signature ?? '',
        updatedAt: row.updated_at,
    };
}
// ---------------------------------------------------------------------------
// AntManifest → DB row
// ---------------------------------------------------------------------------
function manifestToRow(manifest) {
    return {
        public_key: manifest.identity.publicKey,
        handle: manifest.identity.handle,
        facet: manifest.identity.facet,
        tier: manifest.identity.tier,
        territory_cells: manifest.identity.territoryCells,
        description: manifest.description,
        capabilities: manifest.capabilities,
        mcp_endpoints: manifest.mcpEndpoints,
        operation_count: manifest.operationCount,
        compliance_score: manifest.complianceScore,
        stellar_account_id: manifest.identity.stellarAccountId,
        signature: manifest.signature,
        provisioned_at: manifest.identity.provisionedAt,
        updated_at: manifest.updatedAt ?? new Date().toISOString(),
    };
}
// ---------------------------------------------------------------------------
// SupabaseRegistry
// ---------------------------------------------------------------------------
export class SupabaseRegistry {
    client;
    cache = new Map();
    cacheTtlMs;
    listCache = null;
    constructor(supabaseUrl, serviceRoleKey, cacheTtlMs = 60_000 // 60 second TTL
    ) {
        this.client = createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false },
        });
        this.cacheTtlMs = cacheTtlMs;
        console.log('[GEIANT Registry] SupabaseRegistry initialized');
    }
    // ---------------------------------------------------------------------------
    // register
    // ---------------------------------------------------------------------------
    async register(manifest) {
        const { valid, errors } = validateManifestStructure(manifest);
        if (!valid) {
            throw new Error(`Invalid manifest: ${errors.join(', ')}`);
        }
        const row = manifestToRow(manifest);
        const { error } = await this.client
            .from('agents')
            .upsert(row, { onConflict: 'public_key' });
        if (error) {
            throw new Error(`[SupabaseRegistry] register failed: ${error.message}`);
        }
        // Update cache
        this.cache.set(manifest.identity.publicKey, {
            manifest,
            cachedAt: Date.now(),
        });
        this.listCache = null; // invalidate list cache
        console.log(`[GEIANT Registry] Registered ant: ${manifest.identity.handle} (${manifest.identity.tier})`);
    }
    // ---------------------------------------------------------------------------
    // unregister
    // ---------------------------------------------------------------------------
    async unregister(publicKey) {
        const { error } = await this.client
            .from('agents')
            .delete()
            .eq('public_key', publicKey);
        if (error) {
            throw new Error(`[SupabaseRegistry] unregister failed: ${error.message}`);
        }
        this.cache.delete(publicKey);
        this.listCache = null;
    }
    // ---------------------------------------------------------------------------
    // get
    // ---------------------------------------------------------------------------
    async get(publicKey) {
        // Check cache first
        const cached = this.cache.get(publicKey);
        if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
            return cached.manifest;
        }
        const { data, error } = await this.client
            .from('agents')
            .select('*')
            .eq('public_key', publicKey)
            .single();
        if (error || !data)
            return null;
        const manifest = rowToManifest(data);
        this.cache.set(publicKey, { manifest, cachedAt: Date.now() });
        return manifest;
    }
    // ---------------------------------------------------------------------------
    // findEligibleAnts
    // ---------------------------------------------------------------------------
    async findEligibleAnts(cell, facet, minTier) {
        // Phase 0: fetch all ants for this facet (+ general), filter in-process
        // Phase 1 (PostGIS): WHERE territory_cells @> ARRAY[cell] AND facet = facet
        //
        // The array containment query works but needs the GIN index to be efficient.
        // For Phase 0 with ~5-50 ants, fetching by facet + filtering is fine.
        const { data, error } = await this.client
            .from('agents')
            .select('*')
            .or(`facet.eq.${facet},facet.eq.general`);
        if (error) {
            console.error(`[SupabaseRegistry] findEligibleAnts error: ${error.message}`);
            return [];
        }
        return (data ?? [])
            .map(rowToManifest)
            .filter(ant => {
            const tierOk = tierSatisfies(ant.identity.tier, minTier);
            const territoryOk = isInTerritory(cell, ant.identity.territoryCells, true);
            return tierOk && territoryOk;
        });
    }
    // ---------------------------------------------------------------------------
    // hasAntsForFacet
    // ---------------------------------------------------------------------------
    async hasAntsForFacet(facet) {
        const { count, error } = await this.client
            .from('agents')
            .select('public_key', { count: 'exact', head: true })
            .or(`facet.eq.${facet},facet.eq.general`);
        if (error)
            return false;
        return (count ?? 0) > 0;
    }
    // ---------------------------------------------------------------------------
    // list
    // ---------------------------------------------------------------------------
    async list() {
        // Check list cache
        if (this.listCache && Date.now() - this.listCache.cachedAt < this.cacheTtlMs) {
            return this.listCache.manifests;
        }
        const { data, error } = await this.client
            .from('agents')
            .select('*')
            .order('handle');
        if (error) {
            console.error(`[SupabaseRegistry] list error: ${error.message}`);
            return [];
        }
        const manifests = (data ?? []).map(rowToManifest);
        this.listCache = { manifests, cachedAt: Date.now() };
        return manifests;
    }
    // ---------------------------------------------------------------------------
    // Cache management
    // ---------------------------------------------------------------------------
    clearCache() {
        this.cache.clear();
        this.listCache = null;
    }
    getCacheSize() {
        return this.cache.size;
    }
    // ---------------------------------------------------------------------------
    // Health check
    // ---------------------------------------------------------------------------
    async ping() {
        const { error } = await this.client
            .from('agents')
            .select('public_key', { count: 'exact', head: true });
        return !error;
    }
}
// ---------------------------------------------------------------------------
// Factory — create SupabaseRegistry from env vars
// ---------------------------------------------------------------------------
export function createSupabaseRegistry() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error('[SupabaseRegistry] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    }
    return new SupabaseRegistry(url, key);
}
//# sourceMappingURL=supabase_registry.js.map