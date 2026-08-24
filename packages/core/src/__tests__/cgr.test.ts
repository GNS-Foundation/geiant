// =============================================================================
// GEIANT — CGR CONSUMPTION TEST SUITE (#4b)
//
// The golden fixture (cgr_attestation_v1_jcs.golden.json) is a REAL grafomem
// #4a.1 emission (RFC 8785 / JCS canonicalization) — it is the cross-language
// contract. Provenance: seed 0x11*32 (TEST KEY), CGRResult(..., 2/3, 6.0, 12, 3,
// 0.75, ...). We verify it here and prove one-byte tamper fails.
//
// Scoring/persistence tests mint attestations locally with the same seed (the
// derived pubkey equals the fixture's issuer_key_id), so the pinned key is shared.
// =============================================================================

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  verifyCGRAttestation, canonCGRBody, CGR_ATTESTATION_SCHEMA, CGR_ATTESTATION_SCHEMA_V2,
  CGR_ATTESTATION_SCHEMA_V3, CGR_ISSUER,
} from '../agent/cgr.js';
import {
  cgrBand, cgrIdentity, effectiveTrust, scoreAntFitness, cgrCapabilityAdvisory, computeTier,
} from '../agent/identity.js';
import { keypairFromSeed, signRawMessage } from '../crypto/ed25519.js';
import { rowToManifest, manifestToRow } from '../registry/supabase_registry.js';
import type { AntManifest, CGRAttestation, AntFacet, AntTier } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const loadFixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

const GOLDEN = loadFixture('cgr_attestation_v1_jcs.golden.json');   // v1, legacy (no subject_key)
const GOLDEN_V2 = loadFixture('cgr_attestation_v2_jcs.golden.json'); // v2, identity-bound
const PINNED: string = GOLDEN.issuer_key_id;                        // d04ab2… (Foundation pubkey; same for v1+v2)
const SEED: string = GOLDEN.provenance.foundation_signing_seed_hex;  // 0x11*32
const SUBJECT_V2: string = GOLDEN_V2.subject_key;                    // #7: CURRENT operational key (d759793b…, seed 0x44)
const SUBJECT_DID_V2: string = GOLDEN_V2.subject_did;                // #7: stable anchor did:key (of seed 0x33)
const kp = keypairFromSeed(SEED);

// The default stand-in agent GEIANT identity key (= manifest.identity.publicKey =
// the minted attestation's subject_key, so the #5 binding matches by default).
const AGENT_KEY = 'ab'.repeat(32);

// --- helpers ----------------------------------------------------------------

// Mints a v2 (identity-bound) attestation by default; subject_key defaults to
// AGENT_KEY so it binds to a manifest whose publicKey is AGENT_KEY.
function mint(over: Partial<CGRAttestation> & { agent_handle: string }): CGRAttestation {
  const body: Record<string, unknown> = {
    agent_handle: over.agent_handle,
    subject_key: over.subject_key ?? AGENT_KEY,      // #5: bound GEIANT identity key (in the signed body)
    dimension: over.dimension ?? 'receivables',
    tier: over.tier ?? 'gold',
    cgr_score: over.cgr_score ?? 0.9,
    confidence: over.confidence ?? 40,
    n_resolved: over.n_resolved ?? 40,
    capability_tier: over.capability_tier ?? 0.8,
    as_of: over.as_of ?? '2026-06-01T00:00:00Z',
    rationale: over.rationale ?? 'test',
    schema: over.schema ?? CGR_ATTESTATION_SCHEMA_V2,
    issuer: CGR_ISSUER,
    issuer_key_id: kp.publicKeyHex,
  };
  const signature = signRawMessage(canonCGRBody(body), kp.privateKeyHex);
  return { ...(body as unknown as CGRAttestation), signature, evidence_ref: null };
}

function manifest(over: {
  facet?: AntFacet; ops?: number; handle?: string; compliance?: number;
  cgr?: CGRAttestation; pubkey?: string;
}): AntManifest {
  const facet = over.facet ?? 'finance';
  const ops = over.ops ?? 100;
  const handle = over.handle ?? `${facet}@zurich`;
  return {
    identity: {
      publicKey: over.pubkey ?? AGENT_KEY, handle, facet, tier: computeTier(ops),
      territoryCells: ['cell1'], provisionedAt: '2026-01-01T00:00:00Z', stellarAccountId: '',
    },
    description: '', capabilities: [], mcpEndpoints: [],
    operationCount: ops, complianceScore: over.compliance ?? 50,
    signature: '', cgr: over.cgr, updatedAt: '2026-01-01T00:00:00Z',
  };
}

// --- canonicalization byte-parity (the contract) ----------------------------

describe('canonCGRBody — JCS byte-parity with grafomem', () => {
  it('reproduces the committed canonical bytes exactly', () => {
    expect(new TextDecoder().decode(canonCGRBody(GOLDEN.attestation))).toBe(GOLDEN.canonical_body_utf8);
  });
  it('JCS number/string rules: integer-valued float -> "6", raw UTF-8 ≥', () => {
    const s = GOLDEN.canonical_body_utf8 as string;
    expect(s).toContain('"confidence":6,');
    expect(s).toContain('≥');
    expect(s).not.toContain('\\u2265');
  });
});

// --- golden verify + rejection ----------------------------------------------

describe('verifyCGRAttestation — golden fixture (cross-language contract)', () => {
  it('verifies a real grafomem attestation against the pinned Foundation key', () => {
    expect(verifyCGRAttestation(GOLDEN.attestation, PINNED)).toMatchObject({ valid: true });
  });

  it('rejects one-byte tamper (score / band / handle)', () => {
    const cases: Array<[string, unknown]> = [
      ['cgr_score', 0.99], ['tier', 'gold'], ['agent_handle', 'attacker@evil'], ['n_resolved', 999],
    ];
    for (const [k, v] of cases) {
      expect(verifyCGRAttestation({ ...GOLDEN.attestation, [k]: v }, PINNED).valid).toBe(false);
    }
  });

  it('rejects a wrong (non-Foundation) key', () => {
    const wrong = keypairFromSeed('22'.repeat(32)).publicKeyHex;
    expect(verifyCGRAttestation(GOLDEN.attestation, wrong).valid).toBe(false);
  });

  it('rejects wrong issuer / schema / issuer_key_id before crypto', () => {
    expect(verifyCGRAttestation({ ...GOLDEN.attestation, issuer: 'evil' }, PINNED).valid).toBe(false);
    expect(verifyCGRAttestation({ ...GOLDEN.attestation, schema: 'x.v1' }, PINNED).valid).toBe(false);
    expect(verifyCGRAttestation({ ...GOLDEN.attestation, issuer_key_id: '00'.repeat(32) }, PINNED).valid).toBe(false);
  });

  it('no pinned key -> fails closed', () => {
    expect(verifyCGRAttestation(GOLDEN.attestation, undefined).valid).toBe(false);
  });

  it('freshness: stale as_of beyond maxAge -> false', () => {
    const nowMs = Date.parse('2027-01-01T00:00:00Z');
    expect(verifyCGRAttestation(GOLDEN.attestation, PINNED, { maxAgeMs: 1000, nowMs }).valid).toBe(false);
    expect(verifyCGRAttestation(GOLDEN.attestation, PINNED, { maxAgeMs: 1000 * 60 * 60 * 24 * 3650, nowMs }).valid).toBe(true);
  });

  it('handle binding: expectedHandle must match agent_handle', () => {
    expect(verifyCGRAttestation(GOLDEN.attestation, PINNED, { expectedHandle: 'someone-else' }).valid).toBe(false);
    expect(verifyCGRAttestation(GOLDEN.attestation, PINNED, { expectedHandle: GOLDEN.attestation.agent_handle }).valid).toBe(true);
  });
});

// --- cgrBand / effectiveTrust: re-verify, never trust stored band -----------

describe('cgrBand / effectiveTrust', () => {
  it('unproven when no attestation', () => {
    expect(cgrBand(manifest({ cgr: undefined }), PINNED)).toBe('unproven');
  });

  it('unproven when the stored attestation is tampered (band is not trusted)', () => {
    const good = mint({ agent_handle: 'finance@zurich', tier: 'gold' });
    const tampered = { ...good, cgr_score: 0.01 }; // signature no longer matches
    const m = manifest({ facet: 'finance', handle: 'finance@zurich', cgr: tampered });
    expect(cgrBand(m, PINNED)).toBe('unproven');
  });

  it('returns the verified band for a valid attestation', () => {
    const m = manifest({ facet: 'finance', handle: 'finance@zurich', cgr: mint({ agent_handle: 'finance@zurich', tier: 'silver' }) });
    expect(cgrBand(m, PINNED)).toBe('silver');
  });

  it('effectiveTrust exposes BOTH axes, never collapsed', () => {
    const m = manifest({ facet: 'finance', handle: 'finance@zurich', ops: 600, cgr: mint({ agent_handle: 'finance@zurich', tier: 'gold' }) });
    expect(effectiveTrust(m, PINNED)).toEqual({ tier: computeTier(600), cgrBand: 'gold' });
  });

  it('reads the pinned key from CGR_FOUNDATION_PUBKEY env when not passed', () => {
    const prev = process.env.CGR_FOUNDATION_PUBKEY;
    process.env.CGR_FOUNDATION_PUBKEY = PINNED;
    try {
      const m = manifest({ facet: 'finance', handle: 'finance@zurich', cgr: mint({ agent_handle: 'finance@zurich', tier: 'bronze' }) });
      expect(cgrBand(m)).toBe('bronze');
    } finally {
      if (prev === undefined) delete process.env.CGR_FOUNDATION_PUBKEY;
      else process.env.CGR_FOUNDATION_PUBKEY = prev;
    }
  });
});

// --- facet-aware scoreAntFitness --------------------------------------------

describe('scoreAntFitness — facet-aware', () => {
  const cell = 'cell1';
  const req: AntTier = 'observed';

  it('finance: gold + high-conf outranks a high-ops unproven agent (CGR dominates volume)', () => {
    const gold = manifest({ facet: 'finance', handle: 'finance@zurich', ops: 100, cgr: mint({ agent_handle: 'finance@zurich', tier: 'gold', n_resolved: 40 }) });
    const volume = manifest({ facet: 'finance', handle: 'finance@osaka', ops: 500_000, cgr: undefined });
    expect(scoreAntFitness(gold, cell, req, PINNED)).toBeGreaterThan(scoreAntFitness(volume, cell, req, PINNED));
  });

  it('legacy agent with no attestation scores EXACTLY as before', () => {
    const m = manifest({ facet: 'finance', handle: 'finance@zurich', ops: 1000, compliance: 50, cgr: undefined });
    const expected = 20 /*tier*/ + 50 /*compliance*/ + Math.min(20, Math.log10(1001) * 5);
    expect(scoreAntFitness(m, cell, req, PINNED)).toBeCloseTo(expected, 10);
  });

  it('verifiable facet keeps the volume signal + a modest CGR nudge', () => {
    const m = manifest({ facet: 'grid', handle: 'grid@zurich', ops: 1000, compliance: 50, cgr: mint({ agent_handle: 'grid@zurich', tier: 'gold', n_resolved: 40 }) });
    const expected = 20 + 50 + Math.min(20, Math.log10(1001) * 5) + 3 * 8 * 1; // rank gold=3, W_default=8, conf=1
    expect(scoreAntFitness(m, cell, req, PINNED)).toBeCloseTo(expected, 10);
  });
});

// --- persistence mapping round-trip -----------------------------------------

describe('persistence mapping (rowToManifest / manifestToRow)', () => {
  it('manifest -> row -> manifest preserves the attestation', () => {
    const att = mint({ agent_handle: 'finance@zurich', tier: 'silver' });
    const row = manifestToRow(manifest({ facet: 'finance', handle: 'finance@zurich', cgr: att }));
    expect(row.cgr_attestation).toEqual(att);
    expect(row.cgr_band).toBe('silver');
    expect(row.cgr_score).toBe(att.cgr_score);
    expect(rowToManifest(row).cgr).toEqual(att);
  });

  it('absent column (pre-migration row) -> cgr undefined', () => {
    const row = manifestToRow(manifest({ cgr: undefined }));
    delete row.cgr_attestation; // simulate a row written before the migration
    expect(rowToManifest(row).cgr).toBeUndefined();
  });
});

// --- Task F: advisory capability ceiling ------------------------------------

describe('cgrCapabilityAdvisory (advisory-only, not a hard gate)', () => {
  it('warns when a certified agent lacks the advised band', () => {
    const m = manifest({ facet: 'finance', handle: 'finance@zurich', ops: 5000, cgr: undefined }); // certified + unproven
    const a = cgrCapabilityAdvisory(m, PINNED);
    expect(a.ok).toBe(false);
    expect(a.warning).toMatch(/financial-autonomy/);
  });
  it('ok when a certified agent has a sufficient band', () => {
    const m = manifest({ facet: 'finance', handle: 'finance@zurich', ops: 5000, cgr: mint({ agent_handle: 'finance@zurich', tier: 'silver' }) });
    expect(cgrCapabilityAdvisory(m, PINNED).ok).toBe(true);
  });
  it('does not gate sub-financial tiers', () => {
    const m = manifest({ facet: 'finance', handle: 'finance@zurich', ops: 100, cgr: undefined }); // observed
    expect(cgrCapabilityAdvisory(m, PINNED).ok).toBe(true);
  });
});

// --- #5 identity-key binding (v2) — the crux of this ticket -----------------

describe('v2 identity-key binding', () => {
  it('golden v2 verifies true with expectedKey = subject_key + pinned Foundation key', () => {
    expect(verifyCGRAttestation(GOLDEN_V2.attestation, PINNED, { expectedKey: SUBJECT_V2 }))
      .toMatchObject({ valid: true });
  });

  it('canonCGRBody reproduces the committed v2 bytes exactly (subject_key inside the signed body)', () => {
    expect(new TextDecoder().decode(canonCGRBody(GOLDEN_V2.attestation))).toBe(GOLDEN_V2.canonical_body_utf8);
    expect(GOLDEN_V2.canonical_body_utf8).toContain(`"subject_key":"${SUBJECT_V2}"`);
  });

  it('one-byte tamper of subject_key breaks the signature (proves it is signed)', () => {
    const tampered = { ...GOLDEN_V2.attestation, subject_key: '00'.repeat(32) };
    expect(verifyCGRAttestation(tampered, PINNED, { expectedKey: '00'.repeat(32) }).valid).toBe(false);
  });

  it('cgrBand binds on manifest.identity.publicKey — band when key matches (handle irrelevant)', () => {
    const m = manifest({ pubkey: SUBJECT_V2, handle: 'totally@different-role', cgr: GOLDEN_V2.attestation });
    expect(cgrBand(m, PINNED)).toBe(GOLDEN_V2.attestation.tier);   // 'silver'
  });

  it('wrong manifest key (subject_key ≠ identity.publicKey) → cgrBand unproven', () => {
    const m = manifest({ pubkey: 'ff'.repeat(32), cgr: GOLDEN_V2.attestation });
    expect(cgrBand(m, PINNED)).toBe('unproven');
  });

  it('v1 legacy attestation cannot be key-bound → cgrBand unproven (fail-safe)', () => {
    const m = manifest({ pubkey: AGENT_KEY, cgr: GOLDEN.attestation });   // v1, no subject_key
    expect(cgrBand(m, PINNED)).toBe('unproven');
    // ...but v1 still verifies at the signature level when NOT identity-binding:
    expect(verifyCGRAttestation(GOLDEN.attestation, PINNED).valid).toBe(true);
  });

  it('subject_key == issuer_key_id → invalid (neutrality invariant, mirrored on the consumer)', () => {
    const evil = mint({ agent_handle: 'x', subject_key: kp.publicKeyHex });  // subject == Foundation issuer
    expect(verifyCGRAttestation(evil, PINNED, { expectedKey: kp.publicKeyHex }).valid).toBe(false);
  });
});

// --- #7 identity continuity across key rotation (subject_did) ----------------
// The golden v2 fixture is now a ROTATED identity: subject_key = current op key
// (0x44), subject_did = did:key of the anchor (0x33). The consumer stays
// transparent: canonCGRBody excludes only envelope keys, so subject_did rides the
// signed body with no canonicalizer change.

describe('#7 identity continuity (subject_did)', () => {
  it('fixture is a rotated identity: subject_did present + well-formed, distinct from current key', () => {
    expect(SUBJECT_DID_V2).toMatch(/^did:key:z/);
    expect(GOLDEN_V2.attestation.subject_did).toBe(SUBJECT_DID_V2);
    expect(SUBJECT_DID_V2).not.toBe(SUBJECT_V2);
  });

  it('canonCGRBody reproduces the bytes WITH subject_did inside the signed body', () => {
    expect(new TextDecoder().decode(canonCGRBody(GOLDEN_V2.attestation))).toBe(GOLDEN_V2.canonical_body_utf8);
    expect(GOLDEN_V2.canonical_body_utf8).toContain(`"subject_did":"${SUBJECT_DID_V2}"`);
  });

  it('verify succeeds and EXPOSES current key + anchor did:key', () => {
    const res = verifyCGRAttestation(GOLDEN_V2.attestation, PINNED, { expectedKey: SUBJECT_V2 });
    expect(res.valid).toBe(true);
    expect(res.subjectKey).toBe(SUBJECT_V2);      // current operational key (the binding)
    expect(res.subjectDid).toBe(SUBJECT_DID_V2);  // stable anchor did:key
  });

  it('one-byte tamper of subject_did breaks the signature (it is in the signed body)', () => {
    const tampered = { ...GOLDEN_V2.attestation, subject_did: 'did:key:z6MkTampered000000000000000000000000000000000000' };
    expect(verifyCGRAttestation(tampered, PINNED, { expectedKey: SUBJECT_V2 }).valid).toBe(false);
  });

  it('binding UNCHANGED — cgrBand still binds on subject_key (current key), not the anchor', () => {
    const m = manifest({ pubkey: SUBJECT_V2, cgr: GOLDEN_V2.attestation });
    expect(cgrBand(m, PINNED)).toBe(GOLDEN_V2.attestation.tier);
  });

  it('cgrIdentity surfaces the anchor did:key for display (band unchanged)', () => {
    const m = manifest({ pubkey: SUBJECT_V2, cgr: GOLDEN_V2.attestation });
    expect(cgrIdentity(m, PINNED)).toEqual({
      band: GOLDEN_V2.attestation.tier, subjectKey: SUBJECT_V2, anchorDid: SUBJECT_DID_V2,
    });
  });

  it('cgrIdentity on a key mismatch → unproven, no anchor leaked', () => {
    const m = manifest({ pubkey: 'ff'.repeat(32), cgr: GOLDEN_V2.attestation });
    expect(cgrIdentity(m, PINNED)).toEqual({ band: 'unproven' });
  });
});


// --- #7 registry identity anchor mapping (pure row<->manifest) ---------------

describe('#7 registry identity anchor mapping', () => {
  it('manifestToRow defaults identity_anchor to the current key when no rotation', () => {
    const row = manifestToRow(manifest({ pubkey: AGENT_KEY }));
    expect(row.identity_anchor).toBe(AGENT_KEY);        // genesis == current
    expect(row.public_key).toBe(AGENT_KEY);
  });

  it('manifestToRow preserves an explicit anchor across a rotated key', () => {
    const m = manifest({ pubkey: 'bb'.repeat(32) });
    m.identity.anchor = AGENT_KEY;                      // rotated: current=bb…, anchor=AGENT_KEY
    const row = manifestToRow(m);
    expect(row.identity_anchor).toBe(AGENT_KEY);        // stable across rotation
    expect(row.public_key).toBe('bb'.repeat(32));       // operational key moved
  });

  it('rowToManifest maps identity_anchor → identity.anchor; legacy null ⇒ undefined', () => {
    expect(rowToManifest({ public_key: 'aa'.repeat(32), identity_anchor: 'cc'.repeat(32) }).identity.anchor)
      .toBe('cc'.repeat(32));
    expect(rowToManifest({ public_key: 'aa'.repeat(32) }).identity.anchor).toBeUndefined();
  });
});

// ── v3 acceptance (Track C D2 companion: accept v3 BEFORE grafomem emits it) ──
// grafomem Ticket 2 bumps the attestation to cgr.attestation.v3 (adds last_resolved_at
// freshness + scoring_scope/requested_domain/domain_n_resolved, all SIGNED). The
// verifier is field-shape-agnostic (canonicalizes the whole non-envelope body), so BOTH
// v3 shapes must verify: the null/issuance shape and the populated read shape.
describe('verifyCGRAttestation — v3 (expand half of expand-contract)', () => {
  const V3_NULL = loadFixture('cgr_attestation_v3_jcs.golden.json');       // issuance shape (requested_domain: null)
  const V3_READ = loadFixture('cgr_attestation_v3_read_jcs.golden.json');  // populated read shape
  const PIN3: string = V3_NULL.issuer_key_id;                              // same Foundation key (d04ab2…)

  it('exports the v3 schema constant', () => {
    expect(CGR_ATTESTATION_SCHEMA_V3).toBe('cgr.attestation.v3');
  });

  it('JCS parity: canonCGRBody == committed canonical bytes (both shapes)', () => {
    expect(new TextDecoder().decode(canonCGRBody(V3_NULL.attestation))).toBe(V3_NULL.canonical_body_utf8);
    expect(new TextDecoder().decode(canonCGRBody(V3_READ.attestation))).toBe(V3_READ.canonical_body_utf8);
  });

  it('accepts + verifies the null/issuance shape (requested_domain: null)', () => {
    expect(V3_NULL.attestation.schema).toBe('cgr.attestation.v3');
    expect(V3_NULL.attestation.requested_domain).toBeNull();
    expect(V3_NULL.attestation.domain_n_resolved).toBeNull();
    expect(V3_NULL.attestation.scoring_scope).toBe('pooled');
    expect(verifyCGRAttestation(V3_NULL.attestation, PIN3)).toMatchObject({ valid: true });
  });

  it('accepts + verifies the populated read shape', () => {
    expect(V3_READ.attestation.requested_domain).toBe('deploy-verification');
    expect(V3_READ.attestation.domain_n_resolved).toBe(2);
    expect(verifyCGRAttestation(V3_READ.attestation, PIN3)).toMatchObject({ valid: true });
  });

  it('binds subject_key on both v3 shapes', () => {
    const key = V3_READ.subject_key;
    expect(verifyCGRAttestation(V3_READ.attestation, PIN3, { expectedKey: key })).toMatchObject({ valid: true });
    expect(verifyCGRAttestation(V3_READ.attestation, PIN3, { expectedKey: 'bb'.repeat(32) }).valid).toBe(false);
  });

  it('tamper of any SIGNED scope/freshness field fails (read shape)', () => {
    const tampers: Record<string, unknown> = {
      requested_domain: 'security-scan', domain_n_resolved: 999,
      scoring_scope: 'domain-specific', last_resolved_at: '2020-01-01T00:00:00Z', cgr_score: 0.99,
    };
    for (const [k, v] of Object.entries(tampers)) {
      expect(verifyCGRAttestation({ ...V3_READ.attestation, [k]: v }, PIN3).valid).toBe(false);
    }
  });

  it('still rejects a bad schema (contract half stays intact)', () => {
    expect(verifyCGRAttestation({ ...V3_NULL.attestation, schema: 'cgr.attestation.v99' }, PIN3).valid).toBe(false);
  });
});
