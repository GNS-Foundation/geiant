// ===========================================
// GNS-Foundation/geiant#10 — delegation-cert hash primitive consistency
// Run: npx vitest run test/cert_hash_consistency.test.ts
//
// setup-agent.ts now computes its cert hash with the SAME runtime function the
// middleware uses — `await hashDelegationCert(cert)` — so the two paths cannot
// disagree by construction. This test locks that function to REAL SHA-256, not
// the nacl.hash/SHA-512-truncated primitive that was the root cause of #10.
// ===========================================

import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { canonicalJson, sha256Hex, hashDelegationCert, bytesToHex } from '../src/chain';
import { DelegationCertificate } from '../src/types';

describe('geiant#10 — one certificate, one hash', () => {
  const cert = {
    version: 1,
    agent_pk: 'a'.repeat(64),
    principal_pk: 'b'.repeat(64),
    h3_cells: ['851e8053fffffff'],
    facets: ['energy@italy-geiant'],
    not_before: '2026-08-31T00:00:00.000Z',
    not_after: '2027-08-31T00:00:00.000Z',
    max_depth: 0,
    constraints: { allowed_tools: ['perception_weather'], max_ops_per_hour: 1000 },
    principal_signature: 'c'.repeat(128),
  } as unknown as DelegationCertificate;

  // The canonical signed body (principal_signature excluded) — exactly what both
  // hashDelegationCert (runtime) and setup-agent's `dataToSign` are built from.
  const body = canonicalJson({
    version: cert.version,
    agent_pk: cert.agent_pk,
    principal_pk: cert.principal_pk,
    h3_cells: cert.h3_cells,
    facets: cert.facets,
    not_before: cert.not_before,
    not_after: cert.not_after,
    max_depth: cert.max_depth,
    constraints: (cert as { constraints?: unknown }).constraints,
  });

  // Real SHA-256 of `body` (independently verified). setup-agent and the middleware
  // both land on this via hashDelegationCert.
  const EXPECTED_SHA256 =
    'e8dd67e11292da79436c0cb03409ceb5346453206ed3d4f9865ba3a9cce6301f';

  it('hashDelegationCert is real SHA-256 over the canonical body (the setup-agent path == runtime path)', async () => {
    const runtime = await hashDelegationCert(cert);
    expect(runtime).toBe(await sha256Hex(body)); // it IS sha256Hex over the canonical body
    expect(runtime).toBe(EXPECTED_SHA256);       // and that value is real SHA-256
  });

  it('is NOT the old truncated-SHA-512 primitive (the #10 regression guard)', async () => {
    const oldTruncatedSha512 = bytesToHex(nacl.hash(new TextEncoder().encode(body)).slice(0, 32));
    expect(await hashDelegationCert(cert)).not.toBe(oldTruncatedSha512);
    expect(EXPECTED_SHA256).not.toBe(oldTruncatedSha512);
  });
});
