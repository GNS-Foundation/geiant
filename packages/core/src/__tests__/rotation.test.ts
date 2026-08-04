// =============================================================================
// GEIANT — CGR consumer-side rotation-chain verification (#10b)
//
// The chain golden fixture is grafomem's #10a emission (cgr_rotation_chain_jcs) —
// the byte-parity contract. We verify each link, walk the chain, and run the
// end-to-end verifyContinuity flow over the #7 v2 attestation fixture.
// =============================================================================

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  RotationProof, verifyLink, resolveChain, didKey, canonLinkBody, edVerify,
} from '../agent/rotation.js';
import { verifyContinuity } from '../agent/identity.js';
import { canonCGRBody, CGR_ATTESTATION_SCHEMA_V2, CGR_ISSUER } from '../agent/cgr.js';
import { keypairFromSeed, signRawMessage } from '../crypto/ed25519.js';
import { computeTier } from '../agent/identity.js';
import type { AntManifest, CGRAttestation, AntFacet } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const load = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const CHAIN = load('cgr_rotation_chain_jcs.golden.json');
const V2 = load('cgr_attestation_v2_jcs.golden.json');

const PINNED: string = V2.issuer_key_id;                        // d04ab2… (Foundation, seed 0x11)
const fkp = keypairFromSeed('11'.repeat(32));                   // Foundation keypair
const pub = (b: string) => keypairFromSeed(b.repeat(32)).publicKeyHex;

// sign a rotation link with prev_key's key (or a stranger via signSeed → forgery)
function signLink(prevSeed: string, newKey: string, seq = 1,
                  notBefore = '2026-01-01T00:00:00Z', signSeed?: string): RotationProof {
  const body: RotationProof = {
    prev_key: pub(prevSeed), new_key: newKey, seq, not_before: notBefore, sig: '',
  };
  const signer = keypairFromSeed((signSeed ?? prevSeed).repeat(32));
  return { ...body, sig: signRawMessage(canonLinkBody(body), signer.privateKeyHex) };
}

// mint a Foundation-signed v2 attestation (for the trivial/never-rotated case)
function mintAtt(over: Partial<CGRAttestation> & { subject_key: string; subject_did: string }): CGRAttestation {
  const body: Record<string, unknown> = {
    agent_handle: 'invoice-certifier@kapwork-receivables',
    subject_key: over.subject_key, subject_did: over.subject_did,
    dimension: 'receivables', tier: over.tier ?? 'silver',
    cgr_score: 0.9, confidence: 40, n_resolved: 12, capability_tier: 0.8,
    as_of: '2026-06-01T00:00:00Z', rationale: 'test',
    schema: CGR_ATTESTATION_SCHEMA_V2, issuer: CGR_ISSUER, issuer_key_id: fkp.publicKeyHex,
  };
  const signature = signRawMessage(canonCGRBody(body), fkp.privateKeyHex);
  return { ...(body as unknown as CGRAttestation), signature, evidence_ref: null };
}

function manifest(pubkey: string, cgr: CGRAttestation, facet: AntFacet = 'finance'): AntManifest {
  return {
    identity: {
      publicKey: pubkey, handle: `${facet}@zurich`, facet, tier: computeTier(100),
      territoryCells: ['cell1'], provisionedAt: '2026-01-01T00:00:00Z', stellarAccountId: '',
    },
    description: '', capabilities: [], mcpEndpoints: [],
    operationCount: 100, complianceScore: 50, signature: '', cgr, updatedAt: '2026-01-01T00:00:00Z',
  };
}

// --- Task D: pure primitive vs the 10a golden (byte-parity) ------------------

describe('rotation golden fixture — byte-parity with grafomem', () => {
  it('verifyLink true per link; canon bytes == committed canonical_link_bodies_utf8', () => {
    const proofs: RotationProof[] = CHAIN.proofs;
    proofs.forEach((p, i) => {
      expect(verifyLink(p, edVerify)).toBe(true);
      expect(new TextDecoder().decode(canonLinkBody(p))).toBe(CHAIN.canonical_link_bodies_utf8[i]);
    });
  });

  it('resolveChain yields anchor 0x33 → current 0x44; didKey(anchor) === subject_did', () => {
    const { anchorOf, currentOf, frozen } = resolveChain(CHAIN.proofs, edVerify);
    expect(anchorOf.get(CHAIN.current_key)).toBe(CHAIN.anchor_key);
    expect(currentOf.get(CHAIN.anchor_key)).toBe(CHAIN.current_key);
    expect(frozen.size).toBe(0);
    expect(didKey(CHAIN.anchor_key)).toBe(CHAIN.subject_did);
    // cross-repo contract: matches the #7 v2 attestation fixture
    expect(CHAIN.current_key).toBe(V2.subject_key);
    expect(CHAIN.subject_did).toBe(V2.subject_did);
  });
});

// --- Task E: verifyContinuity statuses --------------------------------------

describe('verifyContinuity — independent chain verification', () => {
  const rotated = manifest(V2.subject_key, V2.attestation as CGRAttestation);  // subject_key = 0x44

  it('verified — chain confirmed anchor→current over the real proofs', async () => {
    const fetchProofs = async () => CHAIN.proofs as RotationProof[];
    const r = await verifyContinuity(rotated, fetchProofs, PINNED);
    expect(r.status).toBe('verified');
    expect(r.anchor).toBe(CHAIN.anchor_key);
    expect(r.current).toBe(V2.subject_key);
    expect(r.keyHistory).toEqual([CHAIN.anchor_key, CHAIN.current_key]);
  });

  it('asserted — no-stolen: a link not signed by prev_key never reaches subject_key', async () => {
    const forged = [signLink('33', V2.subject_key, 1, '2026-01-01T00:00:00Z', 'ee')]; // stranger-signed
    const r = await verifyContinuity(rotated, async () => forged, PINNED);
    expect(r.status).toBe('asserted');
    expect(r.reason).toMatch(/no verified chain/);
  });

  it('asserted — fork freezes the identity (loud reason)', async () => {
    const forked = [
      CHAIN.proofs[0] as RotationProof,          // 0x33 → 0x44 (valid)
      signLink('44', pub('55'), 2),              // 0x44 → 0x55
      signLink('44', pub('66'), 2),              // 0x44 → 0x66  (fork at 0x44)
    ];
    const r = await verifyContinuity(rotated, async () => forked, PINNED);
    expect(r.status).toBe('asserted');
    expect(r.reason).toMatch(/frozen/);
  });

  it('verified — trivial (never rotated): subject_did === didKey(subject_key), NO fetch', async () => {
    const k = pub('77');
    const att = mintAtt({ subject_key: k, subject_did: didKey(k) });
    const m = manifest(k, att);
    let fetched = false;
    const r = await verifyContinuity(m, async () => { fetched = true; return []; }, PINNED);
    expect(r.status).toBe('verified');
    expect(fetched).toBe(false);                 // trivial path does not fetch
  });

  it('unverified — proofs unavailable (fetch throws), base band unchanged', async () => {
    const r = await verifyContinuity(rotated, async () => { throw new Error('network down'); }, PINNED);
    expect(r.status).toBe('unverified');
    expect(r.reason).toMatch(/unavailable/);
  });

  it('asserted — chain terminates at a DIFFERENT key than subject_key', async () => {
    // proofs describe 0x33 → 0x99 (not 0x44); subject_key is 0x44 → mismatch
    const other = [signLink('33', pub('99'), 1)];
    const r = await verifyContinuity(rotated, async () => other, PINNED);
    expect(r.status).toBe('asserted');
  });
});
