// =============================================================================
// GEIANT — CGR ATTESTATION v4 VERIFICATION (relation edges, traversal, grounding)
//
// Second consumer of cgr.attestation.v4, ported behaviour-for-behaviour from the
// reference verifier (grafomem clients/cgr-verify, src/index.js). Reuses the proven
// JCS + Ed25519 path from ./cgr.ts (canonCGRBody + verifyRawMessage) so the signed-body
// bytes are byte-identical to grafomem and to the v1–v3 path here.
//
// EXPAND-CONTRACT: this accepts v4 and TRAVERSES before issuance emits any v4. The v1–v3
// verifier in ./cgr.ts is unchanged; v4 is a separate async entry point.
//
// ENFORCEMENT BOUNDARY (grafomem decision 0006 / 0007):
//   - Mode is EXPLICIT and REQUIRED — no silent default either way.
//   - `seek` (enforcing mode) is an INJECTED resolver. @geiant/core deliberately ships NO
//     store-backed seek: its store has no reverse index (target_fp -> edge-records), so an
//     enforcing verifier is NOT constructible against geiant's store. See decision 0007.
//     A caller supplies its own `seek` (the conformance harness does, in-memory).
// =============================================================================

import { blake2b } from '@noble/hashes/blake2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { canonCGRBody, CGR_ISSUER } from './cgr.js';
import { verifyRawMessage } from '../crypto/ed25519.js';

export const CGR_ATTESTATION_SCHEMA_V4 = 'cgr.attestation.v4';
/** Grounding-class dimensions (§2.2, pinned/closed). */
export const GROUNDING_DIMENSIONS = new Set<string>(['grounding']);

const REL_TYPES = new Set(['continues', 'supersedes', 'revokes']);
const VALIDITY_TYPES = new Set(['supersedes', 'revokes']);
const HASH_ALG_FOR_KIND: Record<string, string> = {
  attestation: 'blake2b-256',
  delegation_cert: 'sha-256',
};
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_DEPTH = 64; // §1.3 (the pinned floor)

export type RelationType = 'continues' | 'supersedes' | 'revokes';
export type TargetKind = 'attestation' | 'delegation_cert';
export type LineageStatus =
  | 'complete'
  | 'truncated_unavailable'
  | 'truncated_depth'
  | 'anomaly_cycle';
export type V4Mode = 'enforcing' | 'non-enforcing';

export interface RelationTarget {
  kind: TargetKind | string;
  hash_alg: string;
  hash: string;
}
export interface RelationEdge {
  type: RelationType | string;
  target: RelationTarget;
}

/** A v4 attestation. Field-shape-agnostic for signing (whole non-envelope body is canonicalized),
 *  so this is intentionally open — the fields below are the ones the verifier reads. */
export interface CGRAttestationV4 extends Record<string, unknown> {
  schema: string;
  issuer: string;
  issuer_key_id: string;
  signature: string;
  subject_key?: string;
  dimension?: string;
  relates_to?: RelationEdge[];
}

/** Resolution context for the subject's OWN edges (attestation / delegation_cert bodies by hash). */
export interface V4Ledger {
  attestations?: Record<string, CGRAttestationV4>;
  delegation_certs?: Record<string, Record<string, unknown>>;
}

/**
 * ENFORCING-mode query: given the subject's BLAKE2b-256 fingerprint, return the Foundation-signed
 * edge-records (revokes/supersedes attestations) whose `relates_to` targets it. A query against the
 * caller's store/index. It MAY reject (throw) — an enforcing verifier that cannot complete the query
 * fails closed (Validity-Fails-Closed). @geiant/core ships no store-backed implementation (0007).
 */
export type SeekFn = (subjectFingerprintHex: string) => Promise<CGRAttestationV4[]>;

export interface VerifyV4Options {
  /** REQUIRED: 'enforcing' | 'non-enforcing' — no silent default (0006 enforce-or-label). */
  mode: V4Mode;
  /** Edge-records HANDED to the verifier — honoured in BOTH modes. */
  heldEdges?: CGRAttestationV4[];
  /** REQUIRED iff enforcing: the query for edges targeting the subject. */
  seek?: SeekFn;
}

export interface VerifyV4Result {
  valid: boolean;
  reason?: string;
  subjectKey?: string;
  dimension?: string;
  score?: number;
  schema?: string;
  /** snake_case deliberately — matches the conformance `expect` keys. Present only when non-null. */
  lineage_status?: LineageStatus;
  /** Present only when true (signature-valid but not current). Distinct from valid:false. */
  superseded?: boolean;
}

/** BLAKE2b-256 fingerprint of an attestation's canonical signed body (§1.1). */
export function attestationFingerprintV4(att: Record<string, unknown>): string {
  return bytesToHex(blake2b(canonCGRBody(att), { dkLen: 32 }));
}

function sigOk(att: CGRAttestationV4 | Record<string, unknown>, pinnedIssuerHex: string): boolean {
  const sig = (att as { signature?: unknown }).signature;
  if (typeof sig !== 'string' || sig.length !== 128) return false;
  try {
    return verifyRawMessage(canonCGRBody(att), sig, pinnedIssuerHex);
  } catch {
    return false;
  }
}

function resolveTarget(target: RelationTarget, ledger: V4Ledger): CGRAttestationV4 | Record<string, unknown> | null {
  const map =
    target.kind === 'attestation'
      ? ledger.attestations ?? {}
      : ledger.delegation_certs ?? {};
  return Object.prototype.hasOwnProperty.call(map, target.hash) ? (map as Record<string, CGRAttestationV4>)[target.hash] : null;
}

interface TraverseResult {
  reject: string | null;
  lineage_status: LineageStatus | null;
}

// Cross-type DFS over the subject's relates_to edges (§1.3): lineage-only (continues) DEGRADES;
// validity-affecting (supersedes/revokes) FAILS CLOSED when a traversal cannot complete.
function traverse(subject: CGRAttestationV4, ledger: V4Ledger): TraverseResult {
  const res: TraverseResult = { reject: null, lineage_status: null };
  let sawContinues = false;

  function dfs(node: Record<string, unknown>, pathKeys: string[], pathTypes: string[], depth: number): void {
    const edges = Array.isArray((node as CGRAttestationV4).relates_to) ? (node as CGRAttestationV4).relates_to! : [];
    for (const e of edges) {
      if (res.reject) return;
      const typ = e.type;
      const key = e.target.kind + ':' + e.target.hash;
      const idx = pathKeys.indexOf(key);
      if (idx !== -1) {
        // cycle: the most-conservative rule wins — any validity edge in the loop => reject
        const loop = pathTypes.slice(idx).concat([typ]);
        if (loop.some((t) => VALIDITY_TYPES.has(t))) res.reject = 'supersedes/revokes chain contains a cycle';
        else res.lineage_status = 'anomaly_cycle';
        return;
      }
      if (depth + 1 > MAX_DEPTH) {
        const path = pathTypes.concat([typ]);
        if (path.some((t) => VALIDITY_TYPES.has(t))) res.reject = 'chain exceeds the traversal depth bound';
        else res.lineage_status = 'truncated_depth';
        return;
      }
      if (typ === 'continues') sawContinues = true;
      const target = resolveTarget(e.target, ledger);
      if (target === null) {
        // unreachable target: continues degrades; supersedes/revokes unreachable => no effect
        if (typ === 'continues' && !res.lineage_status) res.lineage_status = 'truncated_unavailable';
        continue;
      }
      dfs(target, pathKeys.concat([key]), pathTypes.concat([typ]), depth + 1);
      if (res.reject) return;
    }
  }

  dfs(subject, [], [], 0);
  if (!res.reject && sawContinues && !res.lineage_status) res.lineage_status = 'complete';
  return res;
}

/**
 * Verify a cgr.attestation.v4 attestation offline. ASYNC in BOTH modes (mode-agnostic call sites).
 * Mode is explicit — no silent default (0006). Enforcing mode requires an injected `seek`.
 * @throws TypeError if mode is missing/invalid, or enforcing without a seek function.
 */
export async function verifyCGRAttestationV4(
  subject: CGRAttestationV4 | undefined | null,
  ledger: V4Ledger | undefined | null,
  pinnedIssuer: string | undefined,
  opts: VerifyV4Options,
): Promise<VerifyV4Result> {
  const mode = opts?.mode;
  const heldEdges = opts?.heldEdges ?? [];
  const seek = opts?.seek;
  if (mode !== 'enforcing' && mode !== 'non-enforcing')
    throw new TypeError('verifyCGRAttestationV4: opts.mode must be "enforcing" or "non-enforcing" (no silent default)');
  if (mode === 'enforcing' && typeof seek !== 'function')
    throw new TypeError('verifyCGRAttestationV4: enforcing mode requires opts.seek (a query function)');

  const led: V4Ledger = ledger ?? {};
  const fail = (reason: string): VerifyV4Result => ({ valid: false, reason });

  if (!subject || typeof subject !== 'object') return fail('no attestation');
  if (!pinnedIssuer) return fail('no pinned issuer key (fail closed)');
  if (subject.schema !== CGR_ATTESTATION_SCHEMA_V4) return fail(`unsupported schema: ${subject.schema}`);
  if (subject.issuer !== CGR_ISSUER) return fail(`issuer mismatch: ${subject.issuer}`);
  if (subject.issuer_key_id !== pinnedIssuer) return fail('issuer_key_id does not equal the pinned key');
  if (typeof subject.subject_key === 'string' && subject.subject_key === subject.issuer_key_id)
    return fail('subject_key equals issuer_key_id (neutrality violation)');

  // signature over the JCS-canonical signed body (relates_to IS in the body → catches B1, T9)
  if (!sigOk(subject, pinnedIssuer)) return fail('signature verification failed');

  // grounding gate (§2.2): oracle_id/audit_policy required iff dimension ∈ GROUNDING_DIMENSIONS
  const isGrounding = GROUNDING_DIMENSIONS.has(subject.dimension ?? '');
  if (isGrounding) {
    if (subject.oracle_id === undefined) return fail('grounding attestation missing oracle_id');
    if (subject.audit_policy === undefined) return fail('grounding attestation missing audit_policy');
  } else {
    if (subject.oracle_id !== undefined) return fail('non-grounding attestation must not carry oracle_id');
    if (subject.audit_policy !== undefined) return fail('non-grounding attestation must not carry audit_policy');
    if (subject.n_unresolvable !== undefined) return fail('non-grounding attestation must not carry n_unresolvable');
  }

  // relates_to: per-edge validation (§1.1) — type, kind, per-kind hash_alg, hash format
  const edges = Array.isArray(subject.relates_to) ? subject.relates_to : [];
  for (const e of edges) {
    if (!e || !REL_TYPES.has(e.type)) return fail(`unrecognized relation type: ${e && e.type}`);
    const t = e.target;
    if (!t || !Object.prototype.hasOwnProperty.call(HASH_ALG_FOR_KIND, t.kind))
      return fail(`invalid target kind: ${t && t.kind}`);
    if (t.hash_alg !== HASH_ALG_FOR_KIND[t.kind])
      return fail(`hash_alg ${t.hash_alg} invalid for kind ${t.kind}`);
    if (typeof t.hash !== 'string' || !HEX64.test(t.hash))
      return fail(`malformed target hash for ${t.hash_alg}`);
  }
  // multiplicity (§1.1): exact duplicate → reject; >1 continues → reject
  const seen = new Set<string>();
  for (const e of edges) {
    const k = e.type + '|' + e.target.hash;
    if (seen.has(k)) return fail('duplicate {type,target} edge');
    seen.add(k);
  }
  if (edges.filter((e) => e.type === 'continues').length > 1)
    return fail('more than one continues edge (>1 lineage predecessor)');

  // traversal (§1.3)
  const tr = traverse(subject, led);
  if (tr.reject) return fail(tr.reject);

  // held + sought edges (§1.3/§3): honour edge-records that target the subject.
  //   held = HANDED to the verifier — honoured in BOTH modes.
  //   seek = QUERIED for edges targeting the subject — ENFORCING mode only (0006).
  const subjFp = attestationFingerprintV4(subject);
  const toHonour: CGRAttestationV4[] = [...heldEdges];
  if (mode === 'enforcing') {
    let sought: CGRAttestationV4[];
    try {
      sought = await seek!(subjFp);
    } catch (e) {
      // Validity-Fails-Closed: an enforcing verifier that cannot complete the query cannot determine
      // revocation status → REJECT. Distinct from an ordinary revocation.
      return fail(`revocation status undeterminable (seek failed: ${e && (e as Error).message ? (e as Error).message : e})`);
    }
    if (!Array.isArray(sought)) return fail('revocation status undeterminable (seek returned a non-array)');
    toHonour.push(...sought);
  }

  let superseded = false;
  for (const rec of toHonour) {
    if (!rec || rec.issuer !== CGR_ISSUER) continue;
    if (!sigOk(rec, pinnedIssuer)) continue; // only a Foundation-signed edge-record binds
    for (const e of Array.isArray(rec.relates_to) ? rec.relates_to : []) {
      if (e.target && e.target.kind === 'attestation' && e.target.hash === subjFp) {
        if (e.type === 'revokes') return fail('subject is revoked (an edge targeting it was honoured)');
        if (e.type === 'supersedes') superseded = true;
      }
    }
  }

  const out: VerifyV4Result = {
    valid: true,
    subjectKey: subject.subject_key,
    dimension: subject.dimension,
    score: subject.cgr_score as number | undefined,
    schema: subject.schema,
  };
  if (tr.lineage_status) out.lineage_status = tr.lineage_status;
  if (superseded) out.superseded = true;
  return out;
}
