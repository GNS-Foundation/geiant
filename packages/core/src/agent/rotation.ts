// =============================================================================
// GEIANT — CGR ROTATION CHAIN (consumer-side, #10b)
//
// Pure mirror of grafomem src/aml/cgr/identity.py — so GEIANT can INDEPENDENTLY
// verify an identity's key-rotation chain (anchor → current) instead of trusting
// grafomem's re-issue. Every link is self-certifying: prev_key signs
// {prev_key,new_key,seq,not_before}. The reader re-checks each signature — the
// server that served the proofs is untrusted transport.
//
// Byte-parity discipline (as #4a.1 / #5): link canonicalization is JCS via the SAME
// `canonicalize` lib grafomem's rfc8785 matches, and the Ed25519 check is the raw-
// byte `verifyRawMessage` (NO SHA-256 prehash). A link grafomem's verify_link
// accepts is one verifyLink accepts, bit-for-bit — pinned by the 10a golden fixture.
//
// Pure + dependency-light: only `canonicalize` + `verifyRawMessage`. No manifest,
// no network, no cgr.ts — testable offline.
// =============================================================================

import canonicalize from 'canonicalize';
import { verifyRawMessage } from '../crypto/ed25519.js';

export interface RotationProof {
  prev_key: string;   // 64-hex — key being rotated out (signs this link)
  new_key: string;    // 64-hex — successor key
  seq: number;        // position in the chain
  not_before: string; // ISO-8601
  sig: string;        // 128-hex Ed25519 signature by prev_key
}

/** Injected Ed25519 verify: (pubkeyHex, message, sigHex) -> boolean. */
export type RotationVerify = (pubkeyHex: string, message: Uint8Array, sigHex: string) => boolean;

/** Default verify — raw-byte Ed25519 (no prehash), byte-parity with grafomem. */
export const edVerify: RotationVerify = (pubkeyHex, message, sigHex) =>
  verifyRawMessage(message, sigHex, pubkeyHex);

function linkBody(p: RotationProof): Record<string, unknown> {
  return { prev_key: p.prev_key, new_key: p.new_key, seq: p.seq, not_before: p.not_before };
}

/** JCS-canonical bytes of the signed link body — byte-identical to grafomem's
 *  `attestation._canon` over {prev_key,new_key,seq,not_before}. */
export function canonLinkBody(p: RotationProof): Uint8Array {
  const json = canonicalize(linkBody(p));
  if (json === undefined) throw new Error('canonLinkBody: link body not canonicalizable');
  return new TextEncoder().encode(json);
}

/** A link is valid ONLY if `sig` verifies as prev_key's signature over the
 *  canonical link body — the no-stolen-reputation guard, checked locally. */
export function verifyLink(p: RotationProof, verify: RotationVerify = edVerify): boolean {
  try {
    return verify(p.prev_key, canonLinkBody(p), p.sig);
  } catch {
    return false;
  }
}

export interface ChainResolution {
  anchorOf: Map<string, string>;    // key -> identity anchor
  currentOf: Map<string, string>;   // anchor -> current operational key
  historyOf: Map<string, string[]>; // anchor -> ordered [anchor, …, current]
  frozen: Set<string>;              // anchors halted at a fork/cycle (no silent winner)
}

/** Fold verified rotation links into per-anchor chains — mirror of grafomem
 *  `resolve_identities`: drop unverifiable links, fold per anchor, FREEZE on
 *  fork (≥2 successors) or cycle. Post-fork keys are NOT folded in. */
export function resolveChain(proofs: RotationProof[], verify: RotationVerify = edVerify): ChainResolution {
  const valid = proofs.filter((p) => verifyLink(p, verify));

  const succ = new Map<string, Map<string, RotationProof>>(); // prev -> {new -> proof}
  for (const p of valid) {
    if (!succ.has(p.prev_key)) succ.set(p.prev_key, new Map());
    succ.get(p.prev_key)!.set(p.new_key, p);
  }
  const forked = new Set<string>();
  for (const [k, m] of succ) if (m.size > 1) forked.add(k);
  const allNew = new Set(valid.map((p) => p.new_key));
  const anchors = new Set(valid.filter((p) => !allNew.has(p.prev_key)).map((p) => p.prev_key));

  const anchorOf = new Map<string, string>();
  const currentOf = new Map<string, string>();
  const historyOf = new Map<string, string[]>();
  const frozen = new Set<string>();
  for (const a of anchors) {
    const chain: string[] = [a];
    const seen = new Set<string>([a]);
    let cur = a;
    while (succ.has(cur) && !forked.has(cur)) {
      const nxt = succ.get(cur)!.keys().next().value as string; // single successor
      if (seen.has(nxt)) { frozen.add(a); break; }              // cycle guard
      chain.push(nxt);
      seen.add(nxt);
      cur = nxt;
    }
    if (forked.has(cur)) frozen.add(a);                         // halted at a fork → freeze
    for (const k of chain) anchorOf.set(k, a);
    currentOf.set(a, chain[chain.length - 1]);
    historyOf.set(a, chain);
  }
  return { anchorOf, currentOf, historyOf, frozen };
}

// --- did:key (mirror of grafomem did_key) -----------------------------------

const _B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58btc(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) {
    out = _B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return '1'.repeat(zeros) + out;
}

/** Minimal W3C did:key for an Ed25519 public key: multibase-z(base58btc) over the
 *  0xed01 multicodec prefix + the raw 32-byte key. Byte-identical to grafomem. */
export function didKey(pubkeyHex: string): string {
  const raw = Buffer.from(pubkeyHex, 'hex');
  const prefixed = new Uint8Array(raw.length + 2);
  prefixed[0] = 0xed;
  prefixed[1] = 0x01;
  prefixed.set(raw, 2);
  return 'did:key:z' + base58btc(prefixed);
}
