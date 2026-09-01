// =============================================================================
// cgr.attestation.v4 — conformance corpus runner (vendored, in-process).
//
// Runs the repo-level conformance corpus (vendored from grafomem; see
// fixtures/conformance/cgr-attestation-v4/PROVENANCE.md) against @geiant/core's v4 verifier.
// Two layers, mirroring grafomem's tests/test_v4_conformance.py:
//   1. wellformed self-check — guards the vendored corpus against rot/drift (always runs).
//   2. the 38 vectors — driven in-process with an in-memory `seek` (mirrors bin/verify-v4.mjs).
// Plus unit tests for the mode/seek contract and the absent-entirely stance (decision 0007).
// =============================================================================

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  verifyCGRAttestationV4,
  attestationFingerprintV4,
  type CGRAttestationV4,
  type V4Ledger,
  type SeekFn,
} from '../agent/cgr_v4.js';
import { canonCGRBody } from '../agent/cgr.js';
import { verifyRawMessage } from '../crypto/ed25519.js';

const CORPUS = JSON.parse(
  readFileSync(new URL('./fixtures/conformance/cgr-attestation-v4/vectors.json', import.meta.url), 'utf8'),
);
const VECTORS: any[] = CORPUS.vectors;

function sigOk(att: Record<string, unknown>, pubHex: string): boolean {
  const sig = (att as { signature?: unknown }).signature;
  if (typeof sig !== 'string' || sig.length !== 128) return false;
  try {
    return verifyRawMessage(canonCGRBody(att), sig, pubHex);
  } catch {
    return false;
  }
}

// The seek capability, in-memory over the vector's ledger — the SAME shape a real consumer
// implements against its store/index (@geiant/core deliberately ships none: decision 0007).
function makeSeek(ledger: V4Ledger, seekFails: boolean): SeekFn {
  return async (subjFp: string) => {
    if (seekFails) throw new Error('simulated seek failure');
    const atts = ledger?.attestations ?? {};
    const hits: CGRAttestationV4[] = [];
    for (const rec of Object.values(atts)) {
      for (const e of Array.isArray(rec.relates_to) ? rec.relates_to : []) {
        if (
          e.target &&
          e.target.kind === 'attestation' &&
          e.target.hash === subjFp &&
          (e.type === 'revokes' || e.type === 'supersedes')
        ) {
          hits.push(rec);
          break;
        }
      }
    }
    return hits;
  };
}

// ── Layer 1: vendored-corpus self-check (ported from test_corpus_wellformed) ──
describe('cgr.attestation.v4 corpus — wellformed (vendored self-check)', () => {
  it('has the expected structure, provenance, and mode coverage', () => {
    expect(VECTORS.length).toBeGreaterThan(0);
    const byId = new Map(VECTORS.map((v) => [v.id, v]));
    expect(byId.size).toBe(VECTORS.length); // no duplicate ids

    for (const v of VECTORS) {
      for (const k of ['id', 'clause', 'spec_lines', 'title', 'mode', 'subject', 'ledger', 'held_edges', 'pinned_issuer', 'expect']) {
        expect(v[k], `${v.id}: missing ${k}`).toBeDefined();
      }
      expect(Array.isArray(v.held_edges), `${v.id}: held_edges must be a list`).toBe(true);
      expect(['enforcing', 'non-enforcing'], `${v.id}: bad mode`).toContain(v.mode);
      expect(v.expect && 'valid' in v.expect, `${v.id}: verdict required`).toBe(true);
    }

    // both enforcement modes are exercised (0006 enforce-or-label)
    const modes = new Set(VECTORS.map((v) => v.mode));
    expect(modes.has('enforcing') && modes.has('non-enforcing')).toBe(true);

    // count agreement + drift guard against the vendor provenance header
    expect(CORPUS.vector_count).toBe(VECTORS.length);
    expect(CORPUS._provenance.upstream_vector_count).toBe(VECTORS.length);
  });

  it('signatures verify against the pinned issuer (T9 agent-signed, B1 unsigned-edge excepted)', () => {
    const issuer = CORPUS.issuer_pubkey_hex;
    const agent = CORPUS.agent_pubkey_hex;
    for (const v of VECTORS) {
      const s = v.subject;
      if (v.id.startsWith('T9')) {
        expect(!sigOk(s, issuer) && sigOk(s, agent), 'T9 must be agent-signed, not issuer-signed').toBe(true);
      } else if (v.id.startsWith('B1')) {
        expect(sigOk(s, issuer), 'B1 (unsigned relates_to) must fail issuer verification').toBe(false);
      } else {
        expect(sigOk(s, issuer), `${v.id}: subject must verify against the pinned issuer`).toBe(true);
      }
      for (const he of v.held_edges) {
        expect(sigOk(he, issuer), `${v.id}: held edge must verify against the pinned issuer`).toBe(true);
      }
    }
  });

  it('T2 (cycle) and T8 (unreachable) assert DISTINCT lineage_status (#85 guard)', () => {
    const byId = new Map(VECTORS.map((v) => [v.id, v]));
    const t2 = byId.get('T2-continues-cycle').expect.lineage_status;
    const t8 = byId.get('T8-continues-unreachable').expect.lineage_status;
    expect(t2).toBe('anomaly_cycle');
    expect(t8).toBe('truncated_unavailable');
    expect(t2).not.toBe(t8);
  });
});

// ── Layer 2: run all 38 vectors in their declared modes ──────────────────────
describe('cgr.attestation.v4 corpus — 38 vectors, both modes', () => {
  it.each(VECTORS.map((v) => [v.id, v] as const))('%s', async (_id, vec) => {
    const seek = makeSeek(vec.ledger, vec.seek_fails ?? false);
    const res = await verifyCGRAttestationV4(vec.subject, vec.ledger, vec.pinned_issuer, {
      mode: vec.mode,
      heldEdges: vec.held_edges,
      seek,
    });
    const exp = vec.expect;
    expect(res.valid, `${vec.id}: valid mismatch — ${JSON.stringify(res)}`).toBe(exp.valid);
    if ('lineage_status' in exp) {
      expect(res.lineage_status, `${vec.id}: lineage_status mismatch — ${JSON.stringify(res)}`).toBe(exp.lineage_status);
    }
    if ('superseded' in exp) {
      expect(res.superseded, `${vec.id}: superseded mismatch — ${JSON.stringify(res)}`).toBe(exp.superseded);
    }
    if ('reason_contains' in exp && !exp.valid) {
      expect(res.reason ?? '', `${vec.id}: reason should contain '${exp.reason_contains}' — ${JSON.stringify(res)}`).toContain(
        exp.reason_contains,
      );
    }
  });
});

// ── mode/seek contract + absent-entirely (decision 0007) ─────────────────────
describe('cgr.attestation.v4 — mode/seek contract', () => {
  const pin = CORPUS.issuer_pubkey_hex;
  const goodSubject = VECTORS.find((v) => v.id.startsWith('S2')).subject; // a valid v4 attestation

  it('rejects a missing/invalid mode with a TypeError (no silent default)', async () => {
    // @ts-expect-error — intentionally omitting mode
    await expect(verifyCGRAttestationV4(goodSubject, {}, pin, {})).rejects.toBeInstanceOf(TypeError);
    await expect(
      verifyCGRAttestationV4(goodSubject, {}, pin, { mode: 'nonsense' as any }),
    ).rejects.toThrow(/mode must be/);
  });

  it('enforcing without a seek throws a TypeError', async () => {
    await expect(
      verifyCGRAttestationV4(goodSubject, {}, pin, { mode: 'enforcing' }),
    ).rejects.toThrow(/enforcing mode requires opts.seek/);
  });

  it('non-enforcing needs no seek and verifies', async () => {
    const res = await verifyCGRAttestationV4(goodSubject, {}, pin, { mode: 'non-enforcing' });
    expect(res.valid).toBe(true);
  });

  it('enforcing with a THROWING seek fails closed (Validity-Fails-Closed)', async () => {
    const seek: SeekFn = async () => {
      throw new Error('store unavailable');
    };
    const res = await verifyCGRAttestationV4(goodSubject, {}, pin, { mode: 'enforcing', seek });
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('revocation status undeterminable');
  });

  it('a store-backed seek is not exported (absent-entirely, 0007)', async () => {
    const mod: Record<string, unknown> = await import('../index.js');
    for (const name of Object.keys(mod)) {
      expect(/store.*seek|seek.*store|supabaseSeek|seekFromStore/i.test(name)).toBe(false);
    }
  });
});
