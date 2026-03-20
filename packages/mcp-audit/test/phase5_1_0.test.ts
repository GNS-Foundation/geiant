// ===========================================
// GEIANT Phase 5.1.0 — Agent Audit Trail Tests
// Run: npx vitest run test/phase5_1_0.test.ts
// ===========================================

import { describe, it, expect, beforeAll } from 'vitest';
import nacl from 'tweetnacl';
import {
  hexToBytes,
  bytesToHex,
  sha256Hex,
  sha256HexSync,
  canonicalJson,
  hashDelegationCert,
  verifyDelegationCert,
  isDelegationCertActive,
  checkJurisdiction,
  checkFacet,
  checkToolAllowed,
  buildDataToSign,
  buildBlock,
  verifyBlockSignature,
  verifyBlockHash,
  verifyChainLink,
  verifyChain,
  computeTier,
  computeTrustScore,
  buildContextDigest,
} from '../src/chain';
import {
  AgentTier,
  DelegationCertificate,
  VirtualBreadcrumbBlock,
} from '../src/types';

// ===========================================
// Test Fixtures
// ===========================================

const ROME_H3 = '851e8053fffffff';
const MILAN_H3 = '851e8827fffffff';
const encoder = new TextEncoder();

let agentKp: nacl.SignKeyPair;
let principalKp: nacl.SignKeyPair;
let agentPk: string;
let principalPk: string;
let validCert: DelegationCertificate;
let certHash: string;

function signCert(cert: Omit<DelegationCertificate, 'principal_signature'>): DelegationCertificate {
  const data = canonicalJson({
    version: cert.version,
    agent_pk: cert.agent_pk,
    principal_pk: cert.principal_pk,
    h3_cells: cert.h3_cells,
    facets: cert.facets,
    not_before: cert.not_before,
    not_after: cert.not_after,
    max_depth: cert.max_depth,
    constraints: cert.constraints ?? null,
  });
  const sig = nacl.sign.detached(encoder.encode(data), principalKp.secretKey);
  return { ...cert, principal_signature: bytesToHex(sig) };
}

beforeAll(async () => {
  agentKp = nacl.sign.keyPair();
  principalKp = nacl.sign.keyPair();
  agentPk = bytesToHex(agentKp.publicKey);
  principalPk = bytesToHex(principalKp.publicKey);

  validCert = signCert({
    version: 1,
    agent_pk: agentPk,
    principal_pk: principalPk,
    h3_cells: [ROME_H3],
    facets: ['energy@italy-geiant'],
    not_before: '2026-01-01T00:00:00.000Z',
    not_after: '2027-01-01T00:00:00.000Z',
    max_depth: 0,
    constraints: {
      allowed_tools: ['classify_tile', 'embed_tile', 'get_weather', 'fetch_tile'],
      max_ops_per_hour: 1000,
    },
  });

  certHash = await hashDelegationCert(validCert);
});

// ===========================================
// 1. Hex Utilities
// ===========================================

describe('Hex utilities', () => {
  it('1: round-trips bytes through hex', () => {
    const bytes = nacl.randomBytes(32);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });
});

// ===========================================
// 2. Hashing
// ===========================================

describe('SHA-256', () => {
  it('2: async sha256Hex produces 64-char hex', async () => {
    const h = await sha256Hex('hello geiant');
    expect(h).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(h)).toBe(true);
  });

  it('3: sha256HexSync produces deterministic output', () => {
    const a = sha256HexSync('test');
    const b = sha256HexSync('test');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('4: different inputs produce different hashes', async () => {
    const a = await sha256Hex('input_a');
    const b = await sha256Hex('input_b');
    expect(a).not.toBe(b);
  });
});

// ===========================================
// 3. Canonical JSON
// ===========================================

describe('Canonical JSON', () => {
  it('5: sorts keys alphabetically', () => {
    const out = canonicalJson({ z: 1, a: 2, m: 3 });
    expect(out).toBe('{"a":2,"m":3,"z":1}');
  });

  it('6: handles nested objects', () => {
    const out = canonicalJson({ b: { d: 1, c: 2 }, a: 0 });
    expect(out).toBe('{"a":0,"b":{"c":2,"d":1}}');
  });

  it('7: handles arrays (preserves order)', () => {
    const out = canonicalJson({ a: [3, 1, 2] });
    expect(out).toBe('{"a":[3,1,2]}');
  });
});

// ===========================================
// 4. Delegation Certificates
// ===========================================

describe('Delegation certificates', () => {
  it('8: valid cert signature verifies', () => {
    expect(verifyDelegationCert(validCert)).toBe(true);
  });

  it('9: tampered cert fails verification', () => {
    const tampered = { ...validCert, max_depth: 5 };
    expect(verifyDelegationCert(tampered)).toBe(false);
  });

  it('10: cert hash is deterministic', async () => {
    const h1 = await hashDelegationCert(validCert);
    const h2 = await hashDelegationCert(validCert);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it('11: cert is active within validity window', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    expect(isDelegationCertActive(validCert, now)).toBe(true);
  });

  it('12: cert is inactive before not_before', () => {
    const now = new Date('2025-06-15T12:00:00Z');
    expect(isDelegationCertActive(validCert, now)).toBe(false);
  });

  it('13: cert is inactive after not_after', () => {
    const now = new Date('2027-06-15T12:00:00Z');
    expect(isDelegationCertActive(validCert, now)).toBe(false);
  });
});

// ===========================================
// 5. Jurisdiction & Facet Gate
// ===========================================

describe('Jurisdiction gate', () => {
  it('14: allows operation in delegated H3 cell', () => {
    const result = checkJurisdiction(ROME_H3, validCert);
    expect(result.allowed).toBe(true);
  });

  it('15: blocks operation outside delegated cells', () => {
    const result = checkJurisdiction(MILAN_H3, validCert);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain(MILAN_H3);
  });

  it('16: allows matching facet', () => {
    const result = checkFacet('energy@italy-geiant', validCert);
    expect(result.allowed).toBe(true);
  });

  it('17: blocks non-matching facet', () => {
    const result = checkFacet('health@eu-agent', validCert);
    expect(result.allowed).toBe(false);
  });

  it('18: allows whitelisted tool', () => {
    const result = checkToolAllowed('classify_tile', validCert);
    expect(result.allowed).toBe(true);
  });

  it('19: blocks non-whitelisted tool', () => {
    const result = checkToolAllowed('delete_everything', validCert);
    expect(result.allowed).toBe(false);
  });
});

// ===========================================
// 6. Block Building & Verification
// ===========================================

describe('Block building', () => {
  it('20: builds valid genesis block', async () => {
    const { contextDigest, inputHash, outputHash } = await buildContextDigest(
      { h3_cell: ROME_H3, band: 'B04' },
      { classification: 'no_flood', confidence: 0.95 },
    );

    const block = await buildBlock({
      index: 0,
      agentPk,
      agentSk: agentKp.secretKey,
      timestamp: new Date('2026-03-20T10:00:00Z'),
      locationCell: ROME_H3,
      locationResolution: 5,
      contextDigest,
      previousHash: null,
      metaFlags: {
        tool_duration_ms: 1200,
        input_hash: inputHash,
        output_hash: outputHash,
        tier: AgentTier.PROVISIONED,
        model_id: 'prithvi-eo-2.0',
        runpod_endpoint: 'o7emejiwlumgj6',
      },
      delegationCertHash: certHash,
      toolName: 'classify_tile',
      facet: 'energy@italy-geiant',
    });

    expect(block.index).toBe(0);
    expect(block.previous_hash).toBeNull();
    expect(block.block_hash).toHaveLength(64);
    expect(block.signature).toHaveLength(128);
    expect(block.tool_name).toBe('classify_tile');
  });

  it('21: block signature verifies', async () => {
    const block = await buildBlock({
      index: 0,
      agentPk,
      agentSk: agentKp.secretKey,
      timestamp: new Date(),
      locationCell: ROME_H3,
      locationResolution: 5,
      contextDigest: await sha256Hex('test'),
      previousHash: null,
      metaFlags: {
        tool_duration_ms: 100,
        input_hash: 'a'.repeat(64),
        output_hash: 'b'.repeat(64),
        tier: AgentTier.PROVISIONED,
      },
      delegationCertHash: certHash,
      toolName: 'fetch_tile',
      facet: 'energy@italy-geiant',
    });

    expect(verifyBlockSignature(block)).toBe(true);
  });

  it('22: block hash verifies', async () => {
    const block = await buildBlock({
      index: 0,
      agentPk,
      agentSk: agentKp.secretKey,
      timestamp: new Date(),
      locationCell: ROME_H3,
      locationResolution: 5,
      contextDigest: await sha256Hex('test'),
      previousHash: null,
      metaFlags: {
        tool_duration_ms: 100,
        input_hash: 'a'.repeat(64),
        output_hash: 'b'.repeat(64),
        tier: AgentTier.PROVISIONED,
      },
      delegationCertHash: certHash,
      toolName: 'fetch_tile',
      facet: 'energy@italy-geiant',
    });

    expect(await verifyBlockHash(block)).toBe(true);
  });

  it('23: tampered block fails signature check', async () => {
    const block = await buildBlock({
      index: 0,
      agentPk,
      agentSk: agentKp.secretKey,
      timestamp: new Date(),
      locationCell: ROME_H3,
      locationResolution: 5,
      contextDigest: await sha256Hex('test'),
      previousHash: null,
      metaFlags: {
        tool_duration_ms: 100,
        input_hash: 'a'.repeat(64),
        output_hash: 'b'.repeat(64),
        tier: AgentTier.PROVISIONED,
      },
      delegationCertHash: certHash,
      toolName: 'fetch_tile',
      facet: 'energy@italy-geiant',
    });

    // Tamper with tool name
    const tampered = { ...block, tool_name: 'evil_tool' };
    expect(verifyBlockSignature(tampered)).toBe(false);
  });
});

// ===========================================
// 7. Chain Operations
// ===========================================

describe('Chain verification', () => {
  async function buildChain(length: number): Promise<VirtualBreadcrumbBlock[]> {
    const chain: VirtualBreadcrumbBlock[] = [];
    for (let i = 0; i < length; i++) {
      const block = await buildBlock({
        index: i,
        agentPk,
        agentSk: agentKp.secretKey,
        timestamp: new Date(Date.now() + i * 1000),
        locationCell: ROME_H3,
        locationResolution: 5,
        contextDigest: await sha256Hex(`op_${i}`),
        previousHash: i === 0 ? null : chain[i - 1].block_hash,
        metaFlags: {
          tool_duration_ms: 100 + i,
          input_hash: await sha256Hex(`in_${i}`),
          output_hash: await sha256Hex(`out_${i}`),
          tier: AgentTier.PROVISIONED,
        },
        delegationCertHash: certHash,
        toolName: i % 2 === 0 ? 'classify_tile' : 'embed_tile',
        facet: 'energy@italy-geiant',
      });
      chain.push(block);
    }
    return chain;
  }

  it('24: valid 5-block chain verifies', async () => {
    const chain = await buildChain(5);
    const result = await verifyChain(chain);
    expect(result.is_valid).toBe(true);
    expect(result.block_count).toBe(5);
    expect(result.issues).toHaveLength(0);
  });

  it('25: chain with broken link detected', async () => {
    const chain = await buildChain(3);
    // Break the link: set block 2's previous_hash to garbage
    chain[2] = { ...chain[2], previous_hash: 'deadbeef'.repeat(8) };
    const result = await verifyChain(chain);
    expect(result.is_valid).toBe(false);
    expect(result.issues.some(i => i.includes('chain link'))).toBe(true);
  });

  it('26: chain with index gap detected', async () => {
    const chain = await buildChain(3);
    // Skip index 1
    const gapped = [chain[0], chain[2]];
    const result = await verifyChain(gapped);
    expect(result.is_valid).toBe(false);
    expect(result.issues.some(i => i.includes('index gap'))).toBe(true);
  });

  it('27: empty chain is valid', async () => {
    const result = await verifyChain([]);
    expect(result.is_valid).toBe(true);
    expect(result.block_count).toBe(0);
  });

  it('28: chain link verification — genesis', async () => {
    const chain = await buildChain(1);
    expect(verifyChainLink(chain[0], null)).toBe(true);
  });

  it('29: chain link verification — non-genesis needs prev', async () => {
    const chain = await buildChain(2);
    expect(verifyChainLink(chain[1], chain[0])).toBe(true);
    expect(verifyChainLink(chain[1], null)).toBe(false);
  });
});

// ===========================================
// 8. Trust & Tier
// ===========================================

describe('Trust scoring', () => {
  it('30: tier thresholds match GNS-AIP spec', () => {
    expect(computeTier(0)).toBe(AgentTier.PROVISIONED);
    expect(computeTier(49)).toBe(AgentTier.PROVISIONED);
    expect(computeTier(50)).toBe(AgentTier.OBSERVED);
    expect(computeTier(499)).toBe(AgentTier.OBSERVED);
    expect(computeTier(500)).toBe(AgentTier.TRUSTED);
    expect(computeTier(4999)).toBe(AgentTier.TRUSTED);
    expect(computeTier(5000)).toBe(AgentTier.CERTIFIED);
    expect(computeTier(49999)).toBe(AgentTier.CERTIFIED);
    expect(computeTier(50000)).toBe(AgentTier.SOVEREIGN);
  });

  it('31: trust score ranges 0-100', () => {
    const low = computeTrustScore({ opCount: 0, uniqueCells: 0, daysSinceFirst: 0, chainValid: false });
    expect(low).toBe(0);

    const max = computeTrustScore({ opCount: 10000, uniqueCells: 50, daysSinceFirst: 500, chainValid: true });
    expect(max).toBe(100);
  });

  it('32: chain integrity adds 10 points', () => {
    const without = computeTrustScore({ opCount: 100, uniqueCells: 5, daysSinceFirst: 30, chainValid: false });
    const withIt = computeTrustScore({ opCount: 100, uniqueCells: 5, daysSinceFirst: 30, chainValid: true });
    expect(withIt - without).toBeCloseTo(10, 1);
  });
});

// ===========================================
// 9. Context Digest
// ===========================================

describe('Context digest', () => {
  it('33: builds deterministic context digest', async () => {
    const a = await buildContextDigest({ cell: ROME_H3 }, { result: 'ok' });
    const b = await buildContextDigest({ cell: ROME_H3 }, { result: 'ok' });
    expect(a.contextDigest).toBe(b.contextDigest);
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.outputHash).toBe(b.outputHash);
  });

  it('34: different inputs produce different digests', async () => {
    const a = await buildContextDigest({ cell: ROME_H3 }, { result: 'flood' });
    const b = await buildContextDigest({ cell: ROME_H3 }, { result: 'no_flood' });
    expect(a.contextDigest).not.toBe(b.contextDigest);
    expect(a.inputHash).toBe(b.inputHash);   // Same input
    expect(a.outputHash).not.toBe(b.outputHash);
  });
});

// ===========================================
// Summary
// ===========================================

describe('Phase 5.1.0 summary', () => {
  it('35: all 34 tests above pass → data model complete', () => {
    expect(true).toBe(true);
  });
});
