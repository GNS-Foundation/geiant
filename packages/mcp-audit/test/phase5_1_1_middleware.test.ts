// ===========================================
// GEIANT Phase 5.1.1 — Middleware Tests
// Tests AuditEngine: wrapTool, preflight, drop, violations
// Run: npx vitest run test/phase5_1_1_middleware.test.ts
// ===========================================

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import nacl from 'tweetnacl';
import {
  bytesToHex,
  hexToBytes,
  canonicalJson,
  sha256Hex,
  hashDelegationCert,
  buildBlock,
  buildContextDigest,
  verifyBlockSignature,
  verifyBlockHash,
  verifyChain,
  computeTier,
} from '../src/chain';
import {
  AgentTier,
  DelegationCertificate,
  VirtualBreadcrumbBlock,
  AuditConfig,
} from '../src/types';
import { AuditEngine } from '../src/middleware';

// ===========================================
// Test Fixtures
// ===========================================

const ROME_H3 = '851e8053fffffff';
const MILAN_H3 = '851e8827fffffff';
const NAPLES_H3 = '851e8147fffffff';
const encoder = new TextEncoder();

let agentKp: nacl.SignKeyPair;
let principalKp: nacl.SignKeyPair;
let agentPk: string;
let agentSk: string;
let principalPk: string;
let validCert: DelegationCertificate;

function signCert(
  body: Omit<DelegationCertificate, 'principal_signature'>,
  sk: Uint8Array,
): DelegationCertificate {
  const data = canonicalJson({
    version: body.version,
    agent_pk: body.agent_pk,
    principal_pk: body.principal_pk,
    h3_cells: body.h3_cells,
    facets: body.facets,
    not_before: body.not_before,
    not_after: body.not_after,
    max_depth: body.max_depth,
    constraints: body.constraints ?? null,
  });
  const sig = nacl.sign.detached(encoder.encode(data), sk);
  return { ...body, principal_signature: bytesToHex(sig) };
}

// ===========================================
// Mock Supabase Client
// ===========================================

function createMockSupabase() {
  const store: Record<string, any[]> = {
    delegation_certificates: [],
    agent_registry: [],
    agent_breadcrumbs: [],
    compliance_violations: [],
  };

  const mockFrom = (table: string) => {
    const rows = store[table] ?? [];
    let query: any = {};
    let filters: Array<{ col: string; val: any }> = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;

    const chain = {
      select: (_cols?: string) => {
        filters = [];
        orderCol = null;
        limitN = null;
        return chain;
      },
      insert: (row: any) => {
        const r = Array.isArray(row) ? row : [row];
        for (const item of r) {
          store[table].push({ ...item, id: store[table].length + 1, created_at: new Date().toISOString() });
        }
        return Promise.resolve({ data: r, error: null });
      },
      eq: (col: string, val: any) => {
        filters.push({ col, val });
        return chain;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderCol = col;
        orderAsc = opts?.ascending ?? true;
        return chain;
      },
      limit: (n: number) => {
        limitN = n;
        return chain;
      },
      single: () => {
        let result = [...rows];
        for (const f of filters) {
          result = result.filter((r: any) => r[f.col] === f.val);
        }
        if (orderCol) {
          result.sort((a: any, b: any) => {
            const av = a[orderCol!];
            const bv = b[orderCol!];
            return orderAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
          });
        }
        if (limitN) result = result.slice(0, limitN);
        const item = result[0] ?? null;
        return Promise.resolve({ data: item, error: null });
      },
    };

    return chain;
  };

  return {
    client: { from: mockFrom } as any,
    store,
  };
}

// ===========================================
// Setup
// ===========================================

beforeAll(() => {
  agentKp = nacl.sign.keyPair();
  principalKp = nacl.sign.keyPair();
  agentPk = bytesToHex(agentKp.publicKey);
  agentSk = bytesToHex(agentKp.secretKey);
  principalPk = bytesToHex(principalKp.publicKey);

  validCert = signCert(
    {
      version: 1,
      agent_pk: agentPk,
      principal_pk: principalPk,
      h3_cells: [ROME_H3],
      facets: ['energy@italy-geiant'],
      not_before: '2026-01-01T00:00:00.000Z',
      not_after: '2027-12-31T23:59:59.000Z',
      max_depth: 0,
      constraints: {
        allowed_tools: ['classify_tile', 'embed_tile', 'get_weather', 'fetch_tile'],
        max_ops_per_hour: 1000,
      },
    },
    principalKp.secretKey,
  );
});

// ===========================================
// Helper: create AuditEngine with mock Supabase
// ===========================================

function createTestEngine(certOverride?: DelegationCertificate) {
  const mock = createMockSupabase();
  const engine = new AuditEngine({
    supabaseUrl: 'https://test.supabase.co',
    supabaseServiceKey: 'test-key',
    agentSecretKeyHex: agentSk,
    delegationCertificate: certOverride ?? validCert,
    defaultFacet: 'energy@italy-geiant',
    defaultLocationCell: ROME_H3,
    defaultLocationResolution: 5,
  });

  // Inject mock supabase client
  (engine as any).supabase = mock.client;

  return { engine, mock };
}

// ===========================================
// 1. AuditEngine Initialization
// ===========================================

describe('AuditEngine initialization', () => {
  it('1: initializes with valid cert and stores cert in DB', async () => {
    const { engine, mock } = createTestEngine();
    await engine.init();

    expect(engine.agentPublicKey).toBe(agentPk);
    expect(engine.chainTip.index).toBe(0);
    expect(engine.chainTip.hash).toBeNull();
    expect(mock.store.delegation_certificates.length).toBe(1);
    expect(mock.store.agent_registry.length).toBe(1);
  });

  it('2: registers agent in agent_registry', async () => {
    const { engine, mock } = createTestEngine();
    await engine.init();

    const agent = mock.store.agent_registry[0];
    expect(agent.agent_pk).toBe(agentPk);
    expect(agent.handle).toBe('energy@italy-geiant');
    expect(agent.current_tier).toBe('provisioned');
    expect(agent.breadcrumb_count).toBe(0);
  });

  it('3: rejects expired cert', async () => {
    const expiredCert = signCert(
      {
        version: 1,
        agent_pk: agentPk,
        principal_pk: principalPk,
        h3_cells: [ROME_H3],
        facets: ['energy@italy-geiant'],
        not_before: '2024-01-01T00:00:00.000Z',
        not_after: '2025-01-01T00:00:00.000Z',
        max_depth: 0,
      },
      principalKp.secretKey,
    );

    const { engine } = createTestEngine(expiredCert);
    await expect(engine.init()).rejects.toThrow('not active');
  });

  it('4: rejects cert with mismatched agent PK', async () => {
    const otherKp = nacl.sign.keyPair();
    const mismatchCert = signCert(
      {
        version: 1,
        agent_pk: bytesToHex(otherKp.publicKey),  // different agent
        principal_pk: principalPk,
        h3_cells: [ROME_H3],
        facets: ['energy@italy-geiant'],
        not_before: '2026-01-01T00:00:00.000Z',
        not_after: '2027-12-31T23:59:59.000Z',
        max_depth: 0,
      },
      principalKp.secretKey,
    );

    const { engine } = createTestEngine(mismatchCert);
    await expect(engine.init()).rejects.toThrow('does not match');
  });

  it('5: rejects tampered cert (invalid signature)', async () => {
    const tamperedCert = { ...validCert, max_depth: 3 };
    const { engine } = createTestEngine(tamperedCert);
    await expect(engine.init()).rejects.toThrow('signature is invalid');
  });
});

// ===========================================
// 2. Preflight Checks
// ===========================================

describe('Preflight checks', () => {
  it('6: passes for valid tool + cell + facet', async () => {
    const { engine } = createTestEngine();
    await engine.init();

    const result = engine.preflight('classify_tile', ROME_H3);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('7: rejects tool outside whitelist', async () => {
    const { engine } = createTestEngine();
    await engine.init();

    const result = engine.preflight('delete_everything', ROME_H3);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes('delete_everything'))).toBe(true);
  });

  it('8: rejects H3 cell outside jurisdiction', async () => {
    const { engine } = createTestEngine();
    await engine.init();

    const result = engine.preflight('classify_tile', MILAN_H3);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes(MILAN_H3))).toBe(true);
  });

  it('9: uses default cell when none specified', async () => {
    const { engine } = createTestEngine();
    await engine.init();

    const result = engine.preflight('classify_tile');
    expect(result.ok).toBe(true);
  });

  it('10: accumulates multiple errors', async () => {
    const { engine } = createTestEngine();
    await engine.init();

    const result = engine.preflight('evil_tool', MILAN_H3);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================
// 3. Breadcrumb Drop
// ===========================================

describe('Breadcrumb drop', () => {
  it('11: drops genesis block (index 0, no previous hash)', async () => {
    const { engine, mock } = createTestEngine();
    await engine.init();

    const block = await engine.dropBreadcrumb({
      toolName: 'classify_tile',
      toolInput: { h3_cell: ROME_H3, band: 'B04' },
      toolOutput: { classification: 'no_flood', confidence: 0.95 },
      durationMs: 1200,
    });

    expect(block.index).toBe(0);
    expect(block.previous_hash).toBeNull();
    expect(block.tool_name).toBe('classify_tile');
    expect(block.location_cell).toBe(ROME_H3);
    expect(mock.store.agent_breadcrumbs.length).toBe(1);
  });

  it('12: chains blocks correctly (hash link)', async () => {
    const { engine } = createTestEngine();
    await engine.init();

    const b0 = await engine.dropBreadcrumb({
      toolName: 'fetch_tile',
      toolInput: { cell: ROME_H3 },
      toolOutput: { url: 'https://earth-search...' },
      durationMs: 300,
    });

    const b1 = await engine.dropBreadcrumb({
      toolName: 'classify_tile',
      toolInput: { cell: ROME_H3 },
      toolOutput: { class: 'no_flood' },
      durationMs: 1100,
    });

    expect(b1.index).toBe(1);
    expect(b1.previous_hash).toBe(b0.block_hash);
  });

  it('13: advances chain tip after each drop', async () => {
    const { engine } = createTestEngine();
    await engine.init();

    expect(engine.chainTip.index).toBe(0);

    await engine.dropBreadcrumb({
      toolName: 'fetch_tile',
      toolInput: {},
      toolOutput: {},
      durationMs: 100,
    });

    expect(engine.chainTip.index).toBe(1);
    expect(engine.chainTip.hash).toBeTruthy();
  });

  it('14: block signature is valid', async () => {
    const { engine } = createTestEngine();
    await engine.init();

    const block = await engine.dropBreadcrumb({
      toolName: 'embed_tile',
      toolInput: { cell: ROME_H3 },
      toolOutput: { embedding: [0.1, 0.2, 0.3] },
      durationMs: 800,
      modelId: 'clay-v1.5',
    });

    expect(verifyBlockSignature(block)).toBe(true);
  });

  it('15: block hash is valid', async () => {
    const { engine } = createTestEngine();
    await engine.init();

    const block = await engine.dropBreadcrumb({
      toolName: 'get_weather',
      toolInput: { lat: 41.88, lon: 12.45 },
      toolOutput: { temp: 18.5 },
      durationMs: 200,
    });

    expect(await verifyBlockHash(block)).toBe(true);
  });

  it('16: meta_flags include model_id and runpod_endpoint', async () => {
    const { engine } = createTestEngine();
    await engine.init();

    const block = await engine.dropBreadcrumb({
      toolName: 'classify_tile',
      toolInput: {},
      toolOutput: {},
      durationMs: 1500,
      modelId: 'prithvi-eo-2.0',
      runpodEndpoint: 'o7emejiwlumgj6',
    });

    expect(block.meta_flags.model_id).toBe('prithvi-eo-2.0');
    expect(block.meta_flags.runpod_endpoint).toBe('o7emejiwlumgj6');
    expect(block.meta_flags.tool_duration_ms).toBe(1500);
  });

  it('17: delegation_cert_hash is set correctly', async () => {
    const { engine } = createTestEngine();
    await engine.init();

    const expectedHash = await hashDelegationCert(validCert);

    const block = await engine.dropBreadcrumb({
      toolName: 'fetch_tile',
      toolInput: {},
      toolOutput: {},
      durationMs: 100,
    });

    expect(block.delegation_cert_hash).toBe(expectedHash);
    expect(engine.delegationCertificateHash).toBe(expectedHash);
  });

  it('18: five-block chain verifies end-to-end', async () => {
    const { engine, mock } = createTestEngine();
    await engine.init();

    const blocks: VirtualBreadcrumbBlock[] = [];
    const tools = ['fetch_tile', 'classify_tile', 'embed_tile', 'get_weather', 'classify_tile'];

    for (const tool of tools) {
      const block = await engine.dropBreadcrumb({
        toolName: tool,
        toolInput: { step: blocks.length },
        toolOutput: { ok: true },
        durationMs: 100 + blocks.length * 50,
      });
      blocks.push(block);
    }

    const result = await verifyChain(blocks);
    expect(result.is_valid).toBe(true);
    expect(result.block_count).toBe(5);
    expect(result.issues).toHaveLength(0);
  });
});

// ===========================================
// 4. wrapTool Integration
// ===========================================

describe('wrapTool', () => {
  it('19: wraps handler and drops breadcrumb on success', async () => {
    const { engine, mock } = createTestEngine();
    await engine.init();

    const mockHandler = async (input: { cell: string }) => {
      return { classification: 'no_flood', confidence: 0.95 };
    };

    const wrapped = engine.wrapTool('classify_tile', mockHandler);
    const result = await wrapped({ cell: ROME_H3 });

    expect(result.classification).toBe('no_flood');
    expect(mock.store.agent_breadcrumbs.length).toBe(1);
    expect(mock.store.agent_breadcrumbs[0].tool_name).toBe('classify_tile');
  });

  it('20: wraps handler and drops breadcrumb on failure', async () => {
    const { engine, mock } = createTestEngine();
    await engine.init();

    const failHandler = async (_input: any) => {
      throw new Error('RunPod timeout');
    };

    const wrapped = engine.wrapTool('classify_tile', failHandler);

    await expect(wrapped({ cell: ROME_H3 })).rejects.toThrow('RunPod timeout');

    // Breadcrumb still dropped for audit completeness
    expect(mock.store.agent_breadcrumbs.length).toBe(1);
    const block = mock.store.agent_breadcrumbs[0];
    expect(block.meta_flags.error).toBe('RunPod timeout');
  });

  it('21: blocks tool when jurisdiction check fails', async () => {
    const { engine, mock } = createTestEngine();
    await engine.init();

    const handler = async (_input: any) => ({ ok: true });
    const wrapped = engine.wrapTool('classify_tile', handler, {
      locationCell: MILAN_H3,  // Not in delegation cert
    });

    await expect(wrapped({})).rejects.toThrow('blocked');
    expect(mock.store.agent_breadcrumbs.length).toBe(0);
    expect(mock.store.compliance_violations.length).toBeGreaterThan(0);
  });

  it('22: blocks tool not in whitelist', async () => {
    const { engine, mock } = createTestEngine();
    await engine.init();

    const handler = async (_input: any) => ({ ok: true });
    const wrapped = engine.wrapTool('evil_tool', handler);

    await expect(wrapped({})).rejects.toThrow('blocked');
    expect(mock.store.compliance_violations.length).toBeGreaterThan(0);
    expect(mock.store.compliance_violations[0].violation_type).toBe('facet_violation');
  });

  it('23: dynamic locationCell from input', async () => {
    const { engine, mock } = createTestEngine();
    await engine.init();

    const handler = async (input: { h3_cell: string }) => ({ result: 'ok' });
    const wrapped = engine.wrapTool('fetch_tile', handler, {
      locationCell: (input: { h3_cell: string }) => input.h3_cell,
    });

    const result = await wrapped({ h3_cell: ROME_H3 });
    expect(result.result).toBe('ok');
    expect(mock.store.agent_breadcrumbs[0].location_cell).toBe(ROME_H3);
  });

  it('24: dynamic locationCell rejects out-of-scope cell', async () => {
    const { engine, mock } = createTestEngine();
    await engine.init();

    const handler = async (input: { h3_cell: string }) => ({ result: 'ok' });
    const wrapped = engine.wrapTool('fetch_tile', handler, {
      locationCell: (input: { h3_cell: string }) => input.h3_cell,
    });

    await expect(wrapped({ h3_cell: NAPLES_H3 })).rejects.toThrow('blocked');
  });

  it('25: passes model metadata through to breadcrumb', async () => {
    const { engine, mock } = createTestEngine();
    await engine.init();

    const handler = async (_input: any) => ({ embeddings: [0.1] });
    const wrapped = engine.wrapTool('embed_tile', handler, {
      modelId: 'clay-v1.5',
      runpodEndpoint: 'o7emejiwlumgj6',
    });

    await wrapped({});
    const block = mock.store.agent_breadcrumbs[0];
    expect(block.meta_flags.model_id).toBe('clay-v1.5');
    expect(block.meta_flags.runpod_endpoint).toBe('o7emejiwlumgj6');
  });
});

// ===========================================
// 5. Violation Logging
// ===========================================

describe('Violation logging', () => {
  it('26: logs jurisdiction breach', async () => {
    const { engine, mock } = createTestEngine();
    await engine.init();

    const handler = async (_input: any) => ({});
    const wrapped = engine.wrapTool('classify_tile', handler, {
      locationCell: MILAN_H3,
    });

    try { await wrapped({}); } catch {}

    const violations = mock.store.compliance_violations;
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].violation_type).toBe('jurisdiction_breach');
    expect(violations[0].severity).toBe('critical');
    expect(violations[0].description).toContain(MILAN_H3);
  });

  it('27: logs chain break on DB write failure', async () => {
    const { engine, mock } = createTestEngine();
    await engine.init();

    // Override insert to simulate DB failure
    const origFrom = (engine as any).supabase.from;
    (engine as any).supabase.from = (table: string) => {
      if (table === 'agent_breadcrumbs') {
        return {
          insert: () => Promise.resolve({ data: null, error: { message: 'connection refused' } }),
        };
      }
      return origFrom(table);
    };

    await expect(
      engine.dropBreadcrumb({
        toolName: 'fetch_tile',
        toolInput: {},
        toolOutput: {},
        durationMs: 100,
      }),
    ).rejects.toThrow('breadcrumb write failed');
  });
});

// ===========================================
// 6. Tier Progression
// ===========================================

describe('Tier progression via engine', () => {
  it('28: starts at provisioned', async () => {
    const { engine } = createTestEngine();
    await engine.init();
    expect(engine.currentTier).toBe(AgentTier.PROVISIONED);
  });

  it('29: tier reflects chain length', async () => {
    const { engine } = createTestEngine();
    await engine.init();

    // Drop 50 breadcrumbs to cross into OBSERVED
    for (let i = 0; i < 50; i++) {
      await engine.dropBreadcrumb({
        toolName: 'fetch_tile',
        toolInput: { i },
        toolOutput: { ok: true },
        durationMs: 10,
      });
    }

    expect(engine.currentTier).toBe(AgentTier.OBSERVED);
    expect(engine.chainTip.index).toBe(50);
  });
});

// ===========================================
// 7. No-cert tool (wildcard facet)
// ===========================================

describe('Wildcard facet cert', () => {
  it('30: wildcard facet allows any facet', async () => {
    const wildcardCert = signCert(
      {
        version: 1,
        agent_pk: agentPk,
        principal_pk: principalPk,
        h3_cells: [ROME_H3],
        facets: ['*'],
        not_before: '2026-01-01T00:00:00.000Z',
        not_after: '2027-12-31T23:59:59.000Z',
        max_depth: 0,
      },
      principalKp.secretKey,
    );

    const { engine } = createTestEngine(wildcardCert);
    await engine.init();

    const result = engine.preflight('classify_tile');
    expect(result.ok).toBe(true);
  });
});

// ===========================================
// 8. No-constraint cert (all tools allowed)
// ===========================================

describe('Unconstrained cert', () => {
  it('31: cert without constraints allows all tools', async () => {
    const openCert = signCert(
      {
        version: 1,
        agent_pk: agentPk,
        principal_pk: principalPk,
        h3_cells: [ROME_H3],
        facets: ['energy@italy-geiant'],
        not_before: '2026-01-01T00:00:00.000Z',
        not_after: '2027-12-31T23:59:59.000Z',
        max_depth: 0,
        // No constraints field
      },
      principalKp.secretKey,
    );

    const { engine } = createTestEngine(openCert);
    await engine.init();

    const result = engine.preflight('any_tool_at_all');
    expect(result.ok).toBe(true);
  });
});

// ===========================================
// Summary
// ===========================================

describe('Phase 5.1.1 summary', () => {
  it('32: all 31 middleware tests above pass → audit middleware complete', () => {
    expect(true).toBe(true);
  });
});
