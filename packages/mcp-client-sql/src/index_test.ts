/**
 * @geiant/mcp-client-sql — unit tests
 * Tests preflight governance without requiring a live MCP server.
 */

import { preflight } from './index.js';
import type { DelegationCert } from '@gns-aip/sdk';

// ── Fixture ───────────────────────────────────────────────────────────────────

function makeCert(overrides: Partial<DelegationCert> = {}): DelegationCert {
  const now = Date.now();
  return {
    version:               1,
    certId:                'test-cert-001',
    deployerIdentity:      'deployer_pk',
    principalIdentity:     'principal_pk',
    agentIdentity:         'agent_pk',
    territoryCells:        ['851e8053fffffff'], // Rome R7
    facetPermissions:      ['energy'],
    maxSubDelegationDepth: 0,
    validFrom:             new Date(now - 60_000).toISOString(),   // ← correct field
    validUntil:            new Date(now + 86_400_000).toISOString(), // ← correct field
    principalSignature:    'sig',
    certHash:              'abc123',
    ...overrides,
  };
}

// ── Pre-flight tests ──────────────────────────────────────────────────────────

const ROME_R7  = '851e8053fffffff';
const MILAN_R7 = '851f2d6ffffffff';

describe('preflight()', () => {
  it('allows a valid request within territory and facet', () => {
    expect(preflight(makeCert(), ROME_R7, 'energy').allowed).toBe(true);
  });

  it('blocks an expired certificate', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const result = preflight(makeCert({ validUntil: past }), ROME_R7, 'energy');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not active/i);
  });

  it('blocks a not-yet-valid certificate', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const result = preflight(makeCert({ validFrom: future }), ROME_R7, 'energy');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not active/i);
  });

  it('blocks an H3 cell outside authorised territory', () => {
    const result = preflight(makeCert(), MILAN_R7, 'energy');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/outside authorised territory/i);
  });

  it('blocks an unauthorised facet', () => {
    const result = preflight(makeCert(), ROME_R7, 'finance');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/facet/i);
  });

  it('blocks an invalid H3 cell string', () => {
    const result = preflight(makeCert(), 'not-a-cell', 'energy');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/invalid h3/i);
  });
});
