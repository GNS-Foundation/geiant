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
export const CGR_ATTESTATION_SCHEMA_V2 = 'cgr.attestation.v2';
/** Both schema versions verify; v2 (#5) additionally carries `subject_key` (the
 *  bound GEIANT identity key) inside the signed body. */
const ACCEPTED_SCHEMAS = new Set<string>([CGR_ATTESTATION_SCHEMA, CGR_ATTESTATION_SCHEMA_V2]);
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
  /**
   * IDENTITY BINDING (#5, authoritative): require `att.subject_key === expectedKey`.
   * When set, a v1/legacy attestation (no `subject_key`) can NOT be bound and is
   * rejected — the key is the identity. This is what `cgrBand()` passes.
   */
  expectedKey?: string;
  /**
   * ADVISORY ONLY: if provided, also require `att.agent_handle === expectedHandle`.
   * The handle is a human label (`facet@territory`), not authority — kept for
   * optional cross-checks; NOT used for the trust binding.
   */
  expectedHandle?: string;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  /**
   * #7 identity continuity — populated only on success. `subjectKey` is the CURRENT
   * operational key the reputation binds to; `subjectDid` is the stable identity
   * ANCHOR did:key (== did:key(subjectKey) when no rotation has occurred).
   */
  subjectKey?: string;
  subjectDid?: string;
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

  if (!ACCEPTED_SCHEMAS.has(att.schema)) return { valid: false, reason: `bad schema: ${att.schema}` };
  if (att.issuer !== CGR_ISSUER) return { valid: false, reason: `bad issuer: ${att.issuer}` };
  if (att.issuer_key_id !== foundationPubKeyHex) {
    return { valid: false, reason: 'issuer_key_id does not match pinned Foundation key' };
  }
  if (typeof att.signature !== 'string' || att.signature.length !== 128) {
    return { valid: false, reason: 'malformed signature' };
  }
  if (!(att.tier in CGR_BAND_RANK)) return { valid: false, reason: `unknown band: ${att.tier}` };

  // Identity binding (#5) — the key is authoritative.
  const subjectKey = (att as { subject_key?: unknown }).subject_key;
  // Defense in depth: the neutrality invariant, mirrored on the consumer. A bound
  // subject that equals the Foundation issuer key means "signed by the issuer about
  // the issuer" — never valid.
  if (typeof subjectKey === 'string' && subjectKey === att.issuer_key_id) {
    return { valid: false, reason: 'subject_key equals issuer_key_id (neutrality violation)' };
  }
  if (opts.expectedKey !== undefined) {
    if (typeof subjectKey !== 'string' || subjectKey.length === 0) {
      // v1 / legacy: no key inside the signature ⇒ cannot bind to this identity.
      return { valid: false, reason: 'attestation has no subject_key to bind (v1/legacy)' };
    }
    if (subjectKey !== opts.expectedKey) {
      return { valid: false, reason: 'subject_key does not match manifest identity key' };
    }
  }

  if (opts.expectedHandle !== undefined && att.agent_handle !== opts.expectedHandle) {
    return { valid: false, reason: 'agent_handle does not match manifest handle (advisory)' };
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
  if (!ok) return { valid: false, reason: 'signature verification failed' };
  // #7: surface the operational key + identity anchor did:key for consumers/display.
  const did = (att as { subject_did?: unknown }).subject_did;
  return {
    valid: true,
    subjectKey: typeof subjectKey === 'string' ? subjectKey : undefined,
    subjectDid: typeof did === 'string' ? did : undefined,
  };
}
