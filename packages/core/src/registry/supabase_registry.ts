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

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isInTerritory, tierSatisfies, validateManifestStructure, computeTier } from '../agent/identity.js';
import { AntManifest, AntFacet, AntTier, H3Cell } from '../types/index.js';
import type { AgentRegistry } from './registry.js';

// ---------------------------------------------------------------------------
// Cache entry
// ---------------------------------------------------------------------------

interface CacheEntry {
  manifest: AntManifest;
  cachedAt: number;
}

// ---------------------------------------------------------------------------
// DB row → AntManifest
// ---------------------------------------------------------------------------

export function rowToManifest(row: Record<string, any>): AntManifest {
  return {
    identity: {
      publicKey:      row.public_key,
      handle:         row.handle,
      facet:          row.facet as AntFacet,
      tier:           row.tier as AntTier,
      territoryCells: row.territory_cells ?? [],
      provisionedAt:  row.provisioned_at,
      stellarAccountId: row.stellar_account_id ?? '',
      // #7: anchor — NULL/absent (legacy) => undefined; resolver falls back to public_key.
      anchor:         row.identity_anchor ?? undefined,
    },
    description:    row.description ?? '',
    capabilities:   row.capabilities ?? [],
    mcpEndpoints:   row.mcp_endpoints ?? [],
    operationCount: row.operation_count ?? 0,
    complianceScore: row.compliance_score ?? 0,
    signature:      row.signature ?? '',
    // Absent column (pre-migration) or null ⇒ undefined — fully backward-compatible.
    // The raw attestation is carried as-is; cgrBand()/routing RE-VERIFY it against
    // the pinned Foundation key, so a tampered row cannot confer a band.
    cgr:            row.cgr_attestation ?? undefined,
    updatedAt:      row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// AntManifest → DB row
// ---------------------------------------------------------------------------

export function manifestToRow(manifest: AntManifest): Record<string, any> {
  return {
    public_key:        manifest.identity.publicKey,
    handle:            manifest.identity.handle,
    facet:             manifest.identity.facet,
    tier:              manifest.identity.tier,
    territory_cells:   manifest.identity.territoryCells,
    description:       manifest.description,
    capabilities:      manifest.capabilities,
    mcp_endpoints:     manifest.mcpEndpoints,
    operation_count:   manifest.operationCount,
    compliance_score:  manifest.complianceScore,
    stellar_account_id: manifest.identity.stellarAccountId,
    // #7: anchor defaults to the current key for a never-rotated identity (genesis
    // == current); on rotation the caller supplies the stable anchor so the row's
    // public_key changes while identity_anchor does not. NULL is never written.
    identity_anchor:   manifest.identity.anchor ?? manifest.identity.publicKey,
    signature:         manifest.signature,
    // CGR (additive, nullable — requires the cgr_columns migration). Full signed
    // attestation in jsonb; band/score denormalized for querying only (trust
    // decisions re-verify, they never read these two columns).
    cgr_attestation:   manifest.cgr ?? null,
    cgr_band:          manifest.cgr?.tier ?? null,
    cgr_score:         manifest.cgr?.cgr_score ?? null,
    provisioned_at:    manifest.identity.provisionedAt,
    updated_at:        manifest.updatedAt ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// SupabaseRegistry
// ---------------------------------------------------------------------------

export class SupabaseRegistry implements AgentRegistry {
  private client: SupabaseClient;
  private cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private listCache: { manifests: AntManifest[]; cachedAt: number } | null = null;

  constructor(
    supabaseUrl: string,
    serviceRoleKey: string,
    cacheTtlMs = 60_000 // 60 second TTL
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

  async register(manifest: AntManifest): Promise<void> {
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

  async unregister(publicKey: string): Promise<void> {
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

  async get(publicKey: string): Promise<AntManifest | null> {
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

    if (error || !data) return null;

    const manifest = rowToManifest(data);
    this.cache.set(publicKey, { manifest, cachedAt: Date.now() });
    return manifest;
  }

  // ---------------------------------------------------------------------------
  // getByIdentity — #7 continuity: resolve by identity ANCHOR or current key
  // ---------------------------------------------------------------------------

  /**
   * Resolve an agent by its stable identity ANCHOR or its current operational key.
   * A rotated agent is found by its anchor (or its new key); legacy rows with no
   * anchor still resolve by public_key. This is the continuity-aware lookup (#7).
   */
  async getByIdentity(keyOrAnchor: string): Promise<AntManifest | null> {
    const { data, error } = await this.client
      .from('agents')
      .select('*')
      .or(`identity_anchor.eq.${keyOrAnchor},public_key.eq.${keyOrAnchor}`)
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return rowToManifest(data);
  }

  // ---------------------------------------------------------------------------
  // rotateKey — #7 continuity: same identity, new operational key, ONE row
  // ---------------------------------------------------------------------------

  /**
   * Rotate an identity's operational key IN PLACE: update the single row matched by
   * `anchor`, setting public_key (+ the rest of the manifest) to the new key while
   * `identity_anchor` stays stable — so a rotated agent keeps ONE registry row and
   * its earned history, instead of creating a fresh unproven entry. Assumes grafomem
   * has verified the rotation chain and re-issued the attestation to the new key.
   */
  async rotateKey(anchor: string, newManifest: AntManifest): Promise<void> {
    const row = manifestToRow(newManifest);
    row.identity_anchor = anchor;                       // anchor is immutable across rotation
    const { error } = await this.client
      .from('agents')
      .update(row)
      .eq('identity_anchor', anchor);

    if (error) {
      throw new Error(`[SupabaseRegistry] rotateKey failed: ${error.message}`);
    }
    this.clearCache();
    console.log(`[GEIANT Registry] Rotated anchor ${anchor.slice(0, 8)}… -> key ${newManifest.identity.publicKey.slice(0, 8)}…`);
  }

  // ---------------------------------------------------------------------------
  // findEligibleAnts
  // ---------------------------------------------------------------------------

  async findEligibleAnts(
    cell: H3Cell,
    facet: AntFacet,
    minTier: AntTier
  ): Promise<AntManifest[]> {
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

  async hasAntsForFacet(facet: AntFacet): Promise<boolean> {
    const { count, error } = await this.client
      .from('agents')
      .select('public_key', { count: 'exact', head: true })
      .or(`facet.eq.${facet},facet.eq.general`);

    if (error) return false;
    return (count ?? 0) > 0;
  }

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------

  async list(): Promise<AntManifest[]> {
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

  clearCache(): void {
    this.cache.clear();
    this.listCache = null;
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  // ---------------------------------------------------------------------------
  // Health check
  // ---------------------------------------------------------------------------

  async ping(): Promise<boolean> {
    const { error } = await this.client
      .from('agents')
      .select('public_key', { count: 'exact', head: true });
    return !error;
  }
}

// ---------------------------------------------------------------------------
// Factory — create SupabaseRegistry from env vars
// ---------------------------------------------------------------------------

export function createSupabaseRegistry(): SupabaseRegistry {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      '[SupabaseRegistry] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars'
    );
  }

  return new SupabaseRegistry(url, key);
}
