// =============================================================================
// GEIANT — CGR ATTESTATION VERIFICATION
// Consume the Foundation-signed CGRAttestation issued by grafomem (#4a/#4a.1).
//
// GEIANT NEVER computes CGR. It verifies + displays a score issued elsewhere,
// under a Foundation key that is DISTINCT from any agent's own signing key
// (that separation is the neutrality guarantee — "not your own credit bureau").
//
// Trust root: the Foundation public key is PINNED via config (CGR_FOUNDATION_PUBKEY),
// never blindly trusted from whatever GET /v1/cgr/issuer returns.
//
// Canonicalization: RFC 8785 (JCS) via the stock `canonicalize` lib — byte-identical
// to grafomem's rfc8785 output (proven against the committed golden fixture). The
// signature is Ed25519 over the RAW canonical bytes (NO SHA-256 prehash), so we use
// verifyRawMessage, not verifyMessage.
// =============================================================================

import canonicalize from 'canonicalize';
import { verifyRawMessage } from '../crypto/ed25519.js';
import { CGRAttestation, CGRBand } from '../types/index.js';

export const CGR_ATTESTATION_SCHEMA = 'cgr.attestation.v1';
export const CGR_ISSUER = 'gns-foundation';

/** Envelope keys excluded from the signed body (mirrors grafomem's attestation.py). */
const ENVELOPE_KEYS = new Set(['signature', 'evidence_ref']);

/** Monotonic rank for band comparisons; `unproven` is the floor. */
export const CGR_BAND_RANK: Record<CGRBand, number> = {
  unproven: 0,
  bronze: 1,
  silver: 2,
  gold: 3,
};

/**
 * The pinned Foundation public key (hex) from config. This is the trust anchor.
 * Returns undefined if unset — verification then fails closed (never trusts an
 * unpinned issuer).
 */
export function getFoundationPubKey(): string | undefined {
  const k = process.env.CGR_FOUNDATION_PUBKEY?.trim();
  return k && k.length > 0 ? k : undefined;
}

/**
 * Canonical signed-body bytes (RFC 8785 / JCS), excluding the envelope keys.
 * Byte-identical to grafomem's `canonical_body`. Shared by verify + any
 * fingerprinting a caller may want.
 */
export function canonCGRBody(att: Record<string, unknown>): Uint8Array {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(att)) {
    if (!ENVELOPE_KEYS.has(k)) body[k] = v;
  }
  const json = canonicalize(body);
  if (json === undefined) {
    // canonicalize returns undefined only for non-JSON inputs (functions/undefined).
    throw new Error('canonCGRBody: body is not canonicalizable JSON');
  }
  return new TextEncoder().encode(json);
}

export interface VerifyOptions {
  /** Max age of `as_of` in ms; if set, older attestations are rejected as stale. */
  maxAgeMs?: number;
  /** Current time in ms (injectable for tests); defaults to Date.now(). */
  nowMs?: number;
  /** If provided, require `att.agent_handle === expectedHandle` (manifest binding). */
  expectedHandle?: string;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verify a CGRAttestation against the PINNED Foundation public key.
 *
 * Checks, in order: structural fields, schema, issuer, issuer_key_id === pinned key
 * (an attestation that names a different issuer key is rejected before crypto),
 * optional handle binding, optional freshness, then the Ed25519 signature over the
 * JCS canonical body. Pure + dependency-light so it can lift into an SDK later.
 */
export function verifyCGRAttestation(
  att: CGRAttestation | undefined | null,
  foundationPubKeyHex: string | undefined,
  opts: VerifyOptions = {}
): VerifyResult {
  if (!att || typeof att !== 'object') return { valid: false, reason: 'no attestation' };
  if (!foundationPubKeyHex) return { valid: false, reason: 'no pinned CGR_FOUNDATION_PUBKEY' };

  if (att.schema !== CGR_ATTESTATION_SCHEMA) return { valid: false, reason: `bad schema: ${att.schema}` };
  if (att.issuer !== CGR_ISSUER) return { valid: false, reason: `bad issuer: ${att.issuer}` };
  if (att.issuer_key_id !== foundationPubKeyHex) {
    return { valid: false, reason: 'issuer_key_id does not match pinned Foundation key' };
  }
  if (typeof att.signature !== 'string' || att.signature.length !== 128) {
    return { valid: false, reason: 'malformed signature' };
  }
  if (!(att.tier in CGR_BAND_RANK)) return { valid: false, reason: `unknown band: ${att.tier}` };

  if (opts.expectedHandle !== undefined && att.agent_handle !== opts.expectedHandle) {
    return { valid: false, reason: 'agent_handle does not match manifest handle' };
  }

  if (opts.maxAgeMs !== undefined) {
    const asOf = Date.parse(att.as_of);
    if (Number.isNaN(asOf)) return { valid: false, reason: 'unparseable as_of' };
    const now = opts.nowMs ?? Date.now();
    if (now - asOf > opts.maxAgeMs) return { valid: false, reason: 'attestation is stale' };
  }

  let msg: Uint8Array;
  try {
    msg = canonCGRBody(att as unknown as Record<string, unknown>);
  } catch (e) {
    return { valid: false, reason: `canonicalization failed: ${(e as Error).message}` };
  }

  const ok = verifyRawMessage(msg, att.signature, foundationPubKeyHex);
  return ok ? { valid: true } : { valid: false, reason: 'signature verification failed' };
}
