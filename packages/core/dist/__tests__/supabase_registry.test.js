// =============================================================================
// GEIANT — SUPABASE REGISTRY INTEGRATION TESTS
//
// These tests run against the real Supabase project.
// Requires env vars: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//
// Run with:
//   SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=eyJ... pnpm vitest run supabase_registry
//
// Tests use a test-specific public key prefix to avoid colliding with
// real dev seed data. Cleanup runs in afterEach.
// =============================================================================
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { SupabaseRegistry } from '../registry/supabase_registry.js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !SUPABASE_URL || !SERVICE_KEY;
// Test ant — unique public key prefix to isolate test data
const TEST_KEY = 'f'.repeat(64);
const TEST_KEY2 = 'f'.repeat(63) + 'e';
function makeTestAnt(publicKey, handle) {
    return {
        identity: {
            publicKey,
            handle,
            facet: 'grid',
            tier: 'trusted',
            territoryCells: ['851e8053fffffff', '851e8050ca7ffff', '851e8050ca3ffff'],
            provisionedAt: '2026-01-01T00:00:00Z',
            stellarAccountId: 'G_TEST',
        },
        description: 'Test ant for integration tests',
        capabilities: ['grid', 'h3'],
        mcpEndpoints: [],
        operationCount: 1200,
        complianceScore: 90,
        signature: 'a'.repeat(128),
        updatedAt: new Date().toISOString(),
    };
}
describe.skipIf(skip)('SupabaseRegistry — integration', () => {
    let registry;
    beforeAll(() => {
        registry = new SupabaseRegistry(SUPABASE_URL, SERVICE_KEY, 0); // TTL=0 disables cache
    });
    afterEach(async () => {
        // Clean up test ants
        await registry.unregister(TEST_KEY);
        await registry.unregister(TEST_KEY2);
    });
    // -------------------------------------------------------------------------
    it('ping returns true', async () => {
        const alive = await registry.ping();
        expect(alive).toBe(true);
    });
    it('lists seed ants from migration', async () => {
        const ants = await registry.list();
        expect(ants.length).toBeGreaterThanOrEqual(5);
        const handles = ants.map(a => a.identity.handle);
        expect(handles).toContain('grid@rome-zone-1');
        expect(handles).toContain('finance@swiss');
    });
    it('registers and retrieves an ant', async () => {
        const ant = makeTestAnt(TEST_KEY, 'grid@test-supabase');
        await registry.register(ant);
        const retrieved = await registry.get(TEST_KEY);
        expect(retrieved).not.toBeNull();
        expect(retrieved.identity.handle).toBe('grid@test-supabase');
        expect(retrieved.identity.facet).toBe('grid');
        expect(retrieved.identity.tier).toBe('trusted');
    });
    it('upserts on re-register', async () => {
        const ant = makeTestAnt(TEST_KEY, 'grid@test-supabase');
        await registry.register(ant);
        // operationCount 9999 → tier 'sovereign' (≥50000 is sovereign, ≥5000 certified)
        // Use 600 → still 'trusted' tier range to avoid tier mismatch
        const updated = { ...ant, operationCount: 600, complianceScore: 95 };
        await registry.register(updated);
        const retrieved = await registry.get(TEST_KEY);
        expect(retrieved.operationCount).toBe(600);
        expect(retrieved.complianceScore).toBe(95);
    });
    it('returns null for unknown public key', async () => {
        const result = await registry.get('0'.repeat(64));
        expect(result).toBeNull();
    });
    it('unregisters an ant', async () => {
        const ant = makeTestAnt(TEST_KEY, 'grid@test-supabase');
        await registry.register(ant);
        await registry.unregister(TEST_KEY);
        const retrieved = await registry.get(TEST_KEY);
        expect(retrieved).toBeNull();
    });
    it('finds eligible ants by cell + facet', async () => {
        const ant = makeTestAnt(TEST_KEY, 'grid@test-supabase');
        await registry.register(ant);
        // 851e8053fffffff is in the test ant's territory
        const eligible = await registry.findEligibleAnts('851e8053fffffff', 'grid', 'observed');
        const handles = eligible.map(a => a.identity.handle);
        expect(handles).toContain('grid@test-supabase');
        expect(handles).toContain('grid@rome-zone-1'); // seed ant
    });
    it('does not return ant for wrong facet', async () => {
        const ant = makeTestAnt(TEST_KEY, 'grid@test-supabase');
        await registry.register(ant);
        const eligible = await registry.findEligibleAnts('851e8053fffffff', 'finance', 'observed');
        const handles = eligible.map(a => a.identity.handle);
        expect(handles).not.toContain('grid@test-supabase');
    });
    it('does not return ant for cell outside territory', async () => {
        const ant = makeTestAnt(TEST_KEY, 'grid@test-supabase');
        await registry.register(ant);
        // Tokyo cell — far from Rome
        const eligible = await registry.findEligibleAnts('8530e57ffffffff', 'grid', 'observed');
        const handles = eligible.map(a => a.identity.handle);
        expect(handles).not.toContain('grid@test-supabase');
    });
    it('does not return ant below minTier', async () => {
        const ant = makeTestAnt(TEST_KEY, 'grid@test-supabase');
        await registry.register(ant); // tier = trusted
        const eligible = await registry.findEligibleAnts('851e8053fffffff', 'grid', 'certified');
        const handles = eligible.map(a => a.identity.handle);
        expect(handles).not.toContain('grid@test-supabase');
    });
    it('hasAntsForFacet returns true for grid', async () => {
        const has = await registry.hasAntsForFacet('grid');
        expect(has).toBe(true);
    });
    it('hasAntsForFacet returns false for unknown facet', async () => {
        const has = await registry.hasAntsForFacet('mobility');
        expect(has).toBe(false);
    });
    it('territory cells are persisted and retrieved correctly', async () => {
        const ant = makeTestAnt(TEST_KEY, 'grid@test-supabase');
        await registry.register(ant);
        const retrieved = await registry.get(TEST_KEY);
        expect(retrieved.identity.territoryCells).toEqual(expect.arrayContaining(['851e8053fffffff', '851e8050ca7ffff']));
    });
});
describe('SupabaseRegistry — unit (no network)', () => {
    it('throws if SUPABASE_URL missing', () => {
        // Supabase client throws synchronously on empty URL — that's fine, we want it to fail fast
        expect(() => {
            new SupabaseRegistry('', 'somekey');
        }).toThrow();
    });
    it('rejects invalid manifest on register', async () => {
        if (!SUPABASE_URL || !SERVICE_KEY)
            return;
        const registry = new SupabaseRegistry(SUPABASE_URL, SERVICE_KEY);
        const bad = { identity: { publicKey: 'tooshort', handle: 'x', facet: 'grid', tier: 'trusted', territoryCells: [], provisionedAt: '' }, description: '', capabilities: [], mcpEndpoints: [], operationCount: 0, complianceScore: 0, signature: '', updatedAt: '' };
        await expect(registry.register(bad)).rejects.toThrow();
    });
});
//# sourceMappingURL=supabase_registry.test.js.map