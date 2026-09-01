// ===========================================
// GEIANT — revocation enforcement tests
// Covers: chain.checkRevocation, AuditEngine init/preflight/dropBreadcrumb gates
// Run: npx vitest run test/revocation.test.ts
// ===========================================

import { describe, it, expect, beforeAll } from 'vitest';
import nacl from 'tweetnacl';
import {
  bytesToHex,
  canonicalJson,
  hashDelegationCert,
  checkRevocation,
  verifyDelegationCert,
} from '../src/chain';
import { DelegationCertificate } from '../src/types';
import { AuditEngine } from '../src/middleware';

const ROME_H3 = '851e8053fffffff';
const MILAN_H3 = '851e8827fffffff';
const encoder = new TextEncoder();

let agentKp: nacl.SignKeyPair;
let principalKp: nacl.SignKeyPair;
let agentPk: string;
let agentSk: string;
let validCert: DelegationCertificate;
let validCertHash: string;

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
  return {
    ...body,
    principal_signature: bytesToHex(nacl.sign.detached(encoder.encode(data), sk)),
  };
}

function createMockSupabase() {
  const store: Record<string, any[]> = {
    delegation_certificates: [],
    agent_registry: [],
    agent_breadcrumbs: [],
    compliance_violations: [],
  };

  const mockFrom = (table: string) => {
    let filters: Array<{ col: string; val: any }> = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;

    const chain: any = {
      select: () => {
        filters = [];
        orderCol = null;
        limitN = null;
        return chain;
      },
      insert: (row: any) => {
        const rows = Array.isArray(row) ? row : [row];
        for (const item of rows) {
          store[table].push({
            ...item,
            id: store[table].length + 1,
            created_at: new Date().toISOString(),
          });
        }
        return Promise.resolve({ data: rows, error: null });
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
        let result = [...(store[table] ?? [])];
        for (const f of filters) result = result.filter((r: any) => r[f.col] === f.val);
        if (orderCol) {
          result.sort((a: any, b: any) =>
            orderAsc ? (a[orderCol!] > b[orderCol!] ? 1 : -1) : (a[orderCol!] < b[orderCol!] ? 1 : -1),
          );
        }
        if (limitN) result = result.slice(0, limitN);
        return Promise.resolve({ data: result[0] ?? null, error: null });
      },
    };
    return chain;
  };

  return { client: { from: mockFrom } as any, store };
}

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
  (engine as any).supabase = mock.client;
  return { engine, mock };
}

beforeAll(async () => {
  agentKp = nacl.sign.keyPair();
  principalKp = nacl.sign.keyPair();
  agentPk = bytesToHex(agentKp.publicKey);
  agentSk = bytesToHex(agentKp.secretKey);

  validCert = signCert(
    {
      version: 1,
      agent_pk: agentPk,
      principal_pk: bytesToHex(principalKp.publicKey),
      h3_cells: [ROME_H3],
      facets: ['energy@italy-geiant'],
      not_before: '2026-01-01T00:00:00.000Z',
      not_after: '2027-12-31T23:59:59.000Z',
      max_depth: 0,
      constraints: { allowed_tools: ['perception_weather'], max_ops_per_hour: 1000 },
    },
    principalKp.secretKey,
  );
  validCertHash = await hashDelegationCert(validCert);
});

// ===========================================
// 1. checkRevocation — pure gate
// ===========================================

describe('checkRevocation', () => {
  it('allows a live cert (revoked_at null/undefined/empty)', () => {
    expect(checkRevocation(null).allowed).toBe(true);
    expect(checkRevocation(undefined).allowed).toBe(true);
    expect(checkRevocation('').allowed).toBe(true);
  });

  it('rejects a cert revoked in the past', () => {
    const r = checkRevocation('2026-08-31T12:46:11.648Z', new Date('2026-09-01T00:00:00Z'));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/revoked at/i);
    expect(r.revoked_at).toBe('2026-08-31T12:46:11.648Z');
  });

  it('honours a future-dated revocation only once reached', () => {
    const future = '2026-12-01T00:00:00.000Z';
    expect(checkRevocation(future, new Date('2026-09-01T00:00:00Z')).allowed).toBe(true);
    expect(checkRevocation(future, new Date('2027-01-01T00:00:00Z')).allowed).toBe(false);
  });

  it('fails CLOSED on an unparseable revoked_at', () => {
    const r = checkRevocation('not-a-timestamp');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/unreadable/i);
  });
});

// ===========================================
// 2. init() gate — before insert-on-first-sight
// ===========================================

describe('AuditEngine.init revocation gate', () => {
  it('rejects init when the registered cert is revoked', async () => {
    const { engine, mock } = createTestEngine();
    mock.store.delegation_certificates.push({
      cert_hash: validCertHash,
      agent_pk: agentPk,
      revoked_at: '2026-08-31T12:46:11.648Z',
    });

    await expect(engine.init()).rejects.toThrow(/revoked/i);
  });

  it('does NOT re-insert or register the agent for a revoked cert', async () => {
    const { engine, mock } = createTestEngine();
    mock.store.delegation_certificates.push({
      cert_hash: validCertHash,
      agent_pk: agentPk,
      revoked_at: '2026-08-31T12:46:11.648Z',
    });

    await expect(engine.init()).rejects.toThrow();

    // insert-on-first-sight must not have run for either table
    expect(mock.store.delegation_certificates).toHaveLength(1);
    expect(mock.store.agent_registry).toHaveLength(0);
  });

  it('records a revoked_credential violation, distinct from jurisdiction_breach', async () => {
    const { engine, mock } = createTestEngine();
    mock.store.delegation_certificates.push({
      cert_hash: validCertHash,
      agent_pk: agentPk,
      revoked_at: '2026-08-31T12:46:11.648Z',
    });

    await expect(engine.init()).rejects.toThrow();

    const violations = mock.store.compliance_violations;
    expect(violations).toHaveLength(1);
    expect(violations[0].violation_type).toBe('revoked_credential');
    expect(violations[0].violation_type).not.toBe('jurisdiction_breach');
    expect(violations[0].severity).toBe('critical');
    expect(violations[0].description).toMatch(/revoked/i);
  });

  it('still initializes normally when the cert is live', async () => {
    const { engine, mock } = createTestEngine();
    await expect(engine.init()).resolves.not.toThrow();

    expect(mock.store.delegation_certificates).toHaveLength(1);
    expect(mock.store.agent_registry).toHaveLength(1);
    expect(mock.store.compliance_violations).toHaveLength(0);
  });

  it('initializes when a cert row exists with revoked_at explicitly null', async () => {
    const { engine, mock } = createTestEngine();
    mock.store.delegation_certificates.push({
      cert_hash: validCertHash,
      agent_pk: agentPk,
      revoked_at: null,
    });

    await expect(engine.init()).resolves.not.toThrow();
    expect(mock.store.compliance_violations).toHaveLength(0);
  });
});

// ===========================================
// 3. preflight() gate
// ===========================================

describe('AuditEngine.preflight revocation gate', () => {
  it('passes preflight for a live cert in scope', async () => {
    const { engine } = createTestEngine();
    await engine.init();

    const r = engine.preflight('perception_weather', ROME_H3);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('fails preflight once the cert is revoked', async () => {
    const { engine } = createTestEngine();
    await engine.init();

    (engine as any).certRevokedAt = '2026-08-31T12:46:11.648Z';

    const r = engine.preflight('perception_weather', ROME_H3);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /revoked/i.test(e))).toBe(true);
  });

  it('reports revocation distinctly from a jurisdiction breach', async () => {
    const { engine } = createTestEngine();
    await engine.init();

    // out-of-scope cell, cert still live -> jurisdiction only
    const jurisdiction = engine.preflight('perception_weather', MILAN_H3);
    expect(jurisdiction.errors.some(e => /not in delegation scope/i.test(e))).toBe(true);
    expect(jurisdiction.errors.some(e => /revoked/i.test(e))).toBe(false);

    // revoked cert, in-scope cell -> revocation only
    (engine as any).certRevokedAt = '2026-08-31T12:46:11.648Z';
    const revoked = engine.preflight('perception_weather', ROME_H3);
    expect(revoked.errors.some(e => /revoked/i.test(e))).toBe(true);
    expect(revoked.errors.some(e => /not in delegation scope/i.test(e))).toBe(false);
  });
});

// ===========================================
// 4. dropBreadcrumb() re-check — revocation mid-flight
// ===========================================

describe('AuditEngine.dropBreadcrumb revocation re-check', () => {
  it('blocks a running agent revoked after init, without a restart', async () => {
    const { engine, mock } = createTestEngine();
    await engine.init();

    // revoke out-of-band, as an operator would
    mock.store.delegation_certificates[0].revoked_at = '2026-08-31T12:46:11.648Z';
    // force the TTL window open so the re-read happens
    (engine as any).revocationCheckedAt = 0;

    await expect(
      engine.dropBreadcrumb({
        toolName: 'perception_weather',
        toolInput: { cell: ROME_H3 },
        toolOutput: { ok: true },
        durationMs: 12,
      }),
    ).rejects.toThrow(/revoked/i);

    // nothing was appended to the chain
    expect(mock.store.agent_breadcrumbs).toHaveLength(0);
    expect(
      mock.store.compliance_violations.some(v => v.violation_type === 'revoked_credential'),
    ).toBe(true);
  });

  it('still writes a breadcrumb while the cert is live', async () => {
    const { engine, mock } = createTestEngine();
    await engine.init();
    (engine as any).revocationCheckedAt = 0;

    await expect(
      engine.dropBreadcrumb({
        toolName: 'perception_weather',
        toolInput: { cell: ROME_H3 },
        toolOutput: { ok: true },
        durationMs: 12,
      }),
    ).resolves.toBeDefined();

    expect(mock.store.agent_breadcrumbs).toHaveLength(1);
    expect(mock.store.compliance_violations).toHaveLength(0);
  });
});

// ===========================================
// 5. Agent-level denylist (agent_registry.revoked_at)
// ===========================================

describe('AuditEngine agent denylist', () => {
  const REVOKED_AT = '2026-08-31T12:46:11.648Z';

  function denylistAgent(mock: ReturnType<typeof createMockSupabase>, reason?: string) {
    mock.store.agent_registry.push({
      agent_pk: agentPk,
      revoked_at: REVOKED_AT,
      revocation_reason: reason ?? null,
      breadcrumb_count: 0,
    });
  }

  it('rejects init for a denylisted agent', async () => {
    const { engine, mock } = createTestEngine();
    denylistAgent(mock);
    await expect(engine.init()).rejects.toThrow(/Agent is revoked/i);
  });

  it('surfaces the operator revocation_reason when present', async () => {
    const { engine, mock } = createTestEngine();
    denylistAgent(mock, 'key leaked in public repo');
    await expect(engine.init()).rejects.toThrow(/key leaked in public repo/i);
  });

  it('does not insert a certificate or touch the registry for a denylisted agent', async () => {
    const { engine, mock } = createTestEngine();
    denylistAgent(mock);
    await expect(engine.init()).rejects.toThrow();

    // the outermost gate must run before ANY insert-on-first-sight
    expect(mock.store.delegation_certificates).toHaveLength(0);
    expect(mock.store.agent_registry).toHaveLength(1); // only the seeded denylist row
  });

  // --- the regression that motivated this gate -------------------------------
  it('rejects a denylisted agent presenting a DIFFERENT, unrevoked certificate', async () => {
    // A second principal self-signs a fresh cert for the SAME agent_pk with broader
    // scope. Certificates vouch for themselves (verifyDelegationCert checks the
    // signature against the principal_pk inside the cert) and there is no trusted
    // principal allowlist, so this cert is cryptographically valid and its cert_hash
    // is unknown to the registry — cert-level revocation cannot catch it.
    const otherPrincipal = nacl.sign.keyPair();
    const widerCert = signCert(
      {
        version: 1,
        agent_pk: agentPk,
        principal_pk: bytesToHex(otherPrincipal.publicKey),
        h3_cells: [ROME_H3, MILAN_H3],
        facets: ['energy@italy-geiant', '*'],
        not_before: '2026-01-01T00:00:00.000Z',
        not_after: '2027-12-31T23:59:59.000Z',
        max_depth: 0,
        constraints: { allowed_tools: ['perception_weather', 'spatial_query'], max_ops_per_hour: 9999 },
      },
      otherPrincipal.secretKey,
    );

    // sanity: the cert really is valid and really is a different cert
    expect(verifyDelegationCert(widerCert)).toBe(true);
    expect(await hashDelegationCert(widerCert)).not.toBe(validCertHash);

    const { engine, mock } = createTestEngine(widerCert);
    denylistAgent(mock);

    await expect(engine.init()).rejects.toThrow(/Agent is revoked/i);
    // and it must not have registered itself on the way in
    expect(mock.store.delegation_certificates).toHaveLength(0);
  });

  it('still rejects when the agent is clean but the certificate is revoked', async () => {
    const { engine, mock } = createTestEngine();
    mock.store.delegation_certificates.push({
      cert_hash: validCertHash,
      agent_pk: agentPk,
      revoked_at: REVOKED_AT,
    });
    await expect(engine.init()).rejects.toThrow(/revoked/i);
  });

  it('initializes normally when neither agent nor certificate is revoked', async () => {
    const { engine, mock } = createTestEngine();
    await expect(engine.init()).resolves.not.toThrow();
    expect(mock.store.agent_registry).toHaveLength(1);
    expect(mock.store.compliance_violations).toHaveLength(0);
  });

  it('preflight distinguishes agent revocation from certificate revocation', async () => {
    const { engine } = createTestEngine();
    await engine.init();

    (engine as any).agentRevokedAt = REVOKED_AT;
    const agentOnly = engine.preflight('perception_weather', ROME_H3);
    expect(agentOnly.ok).toBe(false);
    expect(agentOnly.errors.some(e => /Agent is revoked/i.test(e))).toBe(true);

    (engine as any).agentRevokedAt = null;
    (engine as any).certRevokedAt = REVOKED_AT;
    const certOnly = engine.preflight('perception_weather', ROME_H3);
    expect(certOnly.ok).toBe(false);
    expect(certOnly.errors.some(e => /Agent is revoked/i.test(e))).toBe(false);
    expect(certOnly.errors.some(e => /revoked at/i.test(e))).toBe(true);
  });

  it('blocks dropBreadcrumb when the agent is denylisted mid-flight', async () => {
    const { engine, mock } = createTestEngine();
    await engine.init();

    // operator denylists the agent out-of-band, after the process is running
    mock.store.agent_registry[0].revoked_at = REVOKED_AT;
    (engine as any).revocationCheckedAt = 0;

    await expect(
      engine.dropBreadcrumb({
        toolName: 'perception_weather',
        toolInput: { cell: ROME_H3 },
        toolOutput: { ok: true },
        durationMs: 5,
      }),
    ).rejects.toThrow(/Agent is revoked/i);

    expect(mock.store.agent_breadcrumbs).toHaveLength(0);
    expect(
      mock.store.compliance_violations.some(v => v.violation_type === 'revoked_credential'),
    ).toBe(true);
  });
});
