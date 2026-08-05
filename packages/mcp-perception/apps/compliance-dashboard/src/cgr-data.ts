// CGR data + verification layer for the Reputation panel (#8b).
//
// Shareable surface (always fetched / always shown): scores + attestations +
// continuity + AGGREGATE reviewer calibration. Private substrate (decision→outcome→
// review history, reviewer identities) is tenant-gated: fetched from the tenant's own
// /substrate/export and shown only when that authenticated read succeeds.
//
// Verification is REAL and client-side (dogfooding @geiant/core): every attestation
// is checked with verifyCGRAttestation (bound on subject_key), and continuity is
// walked with verifyContinuity + an injected fetchProofs hitting /v1/cgr/rotations.
// When live endpoints aren't reachable, we fall back to a self-signed SAMPLE (an
// ephemeral Foundation key signs illustrative attestations) so the same real verifier
// still runs — badges are genuine passes, and the tamper toggle makes them fail.
import './node-shims';
import { verifyCGRAttestation } from '@geiant/core/dist/agent/cgr.js';
import { verifyContinuity, httpFetchProofs } from '@geiant/core/dist/agent/identity.js';
import { generateKeypair, signRawMessage } from '@geiant/core/dist/crypto/ed25519.js';
import { didKey, canonLinkBody } from '@geiant/core/dist/agent/rotation.js';
import { canonCGRBody } from '@geiant/core/dist/agent/cgr.js';

export type Band = 'gold' | 'silver' | 'bronze' | 'unproven';
export type CapSource = 'profile' | 'tier_proxy' | null;
export type ContinuityStatus = 'verified' | 'asserted' | 'unverified';
export type FetchProofs = (currentKey: string) => Promise<RotationProof[]>;

export interface RotationProof {
  prev_key: string; new_key: string; seq: number; not_before: string; sig: string;
}

export interface Attestation {
  agent_handle: string; dimension: string; tier: Band; cgr_score: number; confidence: number;
  n_resolved: number; capability_tier: number | null; as_of: string; rationale: string;
  subject_key?: string | null; subject_did?: string | null;
  schema: string; issuer: string; issuer_key_id: string; signature: string; evidence_ref?: unknown;
}

export interface ScoreRow {
  agent_handle: string; cgr_score: number; confidence: number; n_resolved: number; n_pending: number;
  capability_tier: number | null; as_of: string; dimension: string;
  subject_key: string | null; subject_did: string | null;
  post_alpha: number | null; post_beta: number | null;
  cap_d: number | null; cap_source: CapSource; cap_confidence: number | null;
}

export type HistRow = [string, string, string, string, number | null, number]; // ref, decision, type, outcome, days, reviews
export interface ReviewerRow { nm: string; w: number; brier: number; n: number; adv?: boolean }

export interface Verification {
  sigValid: boolean; sigReason?: string;
  continuity: ContinuityStatus; continuityReason?: string;
  anchor?: string; current?: string; keyHistory?: string[];
}

export interface AgentView {
  handle: string; band: Band;
  score: number; mean: number; a: number; b: number; confidence: number;
  n_resolved: number; n_pending: number;
  cap_d: number | null; cap_source: CapSource; cap_confidence: number | null; capability_tier: number | null;
  as_of: string; rationale: string;
  subject_key: string | null; subject_did: string | null;
  attestation: Attestation;
  rule?: number; judgment?: number; hist?: HistRow[]; // private substrate (optional)
  verification: Verification;
}

export interface LoadedData {
  agents: AgentView[];
  foundationKey: string;
  keyPinned: boolean;
  fetchProofs: FetchProofs;
  source: 'live' | 'sample';
  reviewers?: ReviewerRow[];
  privateSubstrate: boolean; // true when tenant substrate (history/reviewers) is loaded
  asOf: string;
  note?: string;
}

// ── config (env) ──────────────────────────────────────────────────────────
const ENV = ((import.meta as unknown as { env?: Record<string, string> }).env) ?? {};
export const GRAFOMEM_BASE = (ENV.VITE_GRAFOMEM_BASE ?? '').replace(/\/$/, '');
const GRAFOMEM_TOKEN = ENV.VITE_GRAFOMEM_TOKEN ?? '';
const PINNED_FOUNDATION_KEY = (ENV.VITE_CGR_FOUNDATION_PUBKEY ?? '').trim();

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (GRAFOMEM_TOKEN) h.Authorization = `Bearer ${GRAFOMEM_TOKEN}`;
  return h;
}
const reqInit: RequestInit = { headers: authHeaders(), credentials: 'include' };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${GRAFOMEM_BASE}${path}`, reqInit);
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ── verification (REAL — @geiant/core) ─────────────────────────────────────
export async function verifyAttestation(
  att: Attestation, foundationKey: string, fetchProofs: FetchProofs,
): Promise<Verification> {
  const sig = verifyCGRAttestation(att as never, foundationKey, {
    expectedKey: att.subject_key ?? undefined,
  });
  // verifyContinuity consumes a manifest-shaped object: identity.publicKey + cgr.
  const manifest = { identity: { publicKey: att.subject_key ?? '' }, cgr: att } as never;
  let cont;
  try {
    cont = await verifyContinuity(manifest, fetchProofs, foundationKey);
  } catch (e) {
    cont = { status: 'unverified' as ContinuityStatus, reason: (e as Error).message };
  }
  return {
    sigValid: sig.valid, sigReason: sig.reason,
    continuity: cont.status, continuityReason: cont.reason,
    anchor: cont.anchor, current: cont.current, keyHistory: cont.keyHistory,
  };
}

// ── live load ──────────────────────────────────────────────────────────────
async function loadLive(): Promise<LoadedData> {
  const [scoresResp, attResp] = await Promise.all([
    getJson<{ scores: ScoreRow[]; as_of?: string }>('/v1/cgr/scores'),
    getJson<{ attestations: Attestation[] }>('/v1/cgr/attestations'),
  ]);
  const scores = scoresResp.scores ?? [];
  const atts = attResp.attestations ?? [];
  if (scores.length === 0) throw new Error('no scores');

  // Foundation key: pinned via env (correct), else the issuer route as a dev fallback.
  let foundationKey = PINNED_FOUNDATION_KEY;
  let keyPinned = true;
  if (!foundationKey) {
    keyPinned = false;
    const issuer = await getJson<{ public_key: string }>('/v1/cgr/issuer');
    foundationKey = issuer.public_key;
  }

  const fetchProofs = httpFetchProofs(GRAFOMEM_BASE, reqInit) as FetchProofs;

  // Private substrate (tenant-gated) — best-effort; hidden if the read isn't allowed.
  let substrate: SubstrateParsed | undefined;
  try {
    const raw = await getJson<SubstrateExport>('/v1/cgr/substrate/export');
    substrate = parseSubstrate(raw);
  } catch { substrate = undefined; }

  const attByHandle = new Map(atts.map((a) => [a.agent_handle, a]));
  const agents: AgentView[] = [];
  for (const s of scores) {
    const att = attByHandle.get(s.agent_handle);
    if (!att) continue; // shareable panel needs the signed attestation
    const view = toView(s, att, substrate);
    view.verification = await verifyAttestation(att, foundationKey, fetchProofs);
    agents.push(view);
  }
  agents.sort((x, y) => y.mean - x.mean);
  return {
    agents, foundationKey, keyPinned, fetchProofs, source: 'live',
    reviewers: substrate?.reviewers, privateSubstrate: !!substrate,
    asOf: scoresResp.as_of ?? agents[0]?.as_of ?? new Date().toISOString(),
    note: keyPinned ? undefined : 'Foundation key from /issuer (unpinned) — set VITE_CGR_FOUNDATION_PUBKEY to pin.',
  };
}

function toView(s: ScoreRow, att: Attestation, sub?: SubstrateParsed): AgentView {
  const a = s.post_alpha ?? att.confidence * att.cgr_score;   // fallback if a null: reconstruct α=mean·n
  const b = s.post_beta ?? att.confidence * (1 - att.cgr_score);
  const priv = sub?.byHandle.get(s.agent_handle);
  return {
    handle: s.agent_handle, band: att.tier,
    score: s.cgr_score, mean: a / (a + b || 1), a, b, confidence: s.confidence,
    n_resolved: s.n_resolved, n_pending: s.n_pending,
    cap_d: s.cap_d ?? s.capability_tier, cap_source: s.cap_source, cap_confidence: s.cap_confidence,
    capability_tier: s.capability_tier,
    as_of: s.as_of, rationale: att.rationale,
    subject_key: s.subject_key, subject_did: s.subject_did,
    attestation: att,
    rule: priv?.rule, judgment: priv?.judgment, hist: priv?.hist,
    verification: { sigValid: false, continuity: 'unverified' },
  };
}

// ── private substrate parsing (tenant-gated) ───────────────────────────────
interface SubstrateExport {
  decisions?: Array<{ invoice_ref: string; agent_handle: string; decision: string; verifiability_tag: string; outcome: string | null; outcome_date: string | null; created_at?: string }>;
  reviews?: Array<{ invoice_ref: string; reviewer_handle: string; agent_handle?: string; rating: number }>;
}
interface SubstrateParsed {
  byHandle: Map<string, { rule: number; judgment: number; hist: HistRow[] }>;
  reviewers: ReviewerRow[];
}
function daysBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const d = (Date.parse(b) - Date.parse(a)) / 86_400_000;
  return Number.isFinite(d) ? Math.max(0, Math.round(d)) : null;
}
function parseSubstrate(raw: SubstrateExport): SubstrateParsed {
  const byHandle = new Map<string, { rule: number; judgment: number; hist: HistRow[] }>();
  const reviewsByRef = new Map<string, number>();
  for (const r of raw.reviews ?? []) reviewsByRef.set(r.invoice_ref, (reviewsByRef.get(r.invoice_ref) ?? 0) + 1);
  for (const d of raw.decisions ?? []) {
    const e = byHandle.get(d.agent_handle) ?? { rule: 0, judgment: 0, hist: [] as HistRow[] };
    if (d.verifiability_tag === 'rule') e.rule++; else if (d.verifiability_tag === 'judgment') e.judgment++;
    e.hist.push([d.invoice_ref, d.decision, d.verifiability_tag,
      d.outcome ?? 'pending', daysBetween(d.created_at, d.outcome_date), reviewsByRef.get(d.invoice_ref) ?? 0]);
    byHandle.set(d.agent_handle, e);
  }
  // aggregate reviewer calibration (Brier on RESOLVED reviews) — shareable aggregate.
  const outcomeByRef = new Map<string, number>();
  for (const d of raw.decisions ?? []) if (d.outcome === 'paid' || d.outcome === 'default') outcomeByRef.set(d.invoice_ref, d.outcome === 'paid' ? 1 : 0);
  const errByReviewer = new Map<string, number[]>();
  for (const r of raw.reviews ?? []) {
    const g = outcomeByRef.get(r.invoice_ref);
    if (g === undefined) continue;
    (errByReviewer.get(r.reviewer_handle) ?? errByReviewer.set(r.reviewer_handle, []).get(r.reviewer_handle)!).push((r.rating - g) ** 2);
  }
  const reviewers: ReviewerRow[] = [];
  for (const [nm, errs] of errByReviewer) {
    const brier = errs.reduce((s, v) => s + v, 0) / (errs.length || 1);
    const w = errs.length >= 5 ? Math.max(0, Math.min(1, 1 - brier / 0.25)) : 0.05;
    reviewers.push({ nm, w, brier: +brier.toFixed(3), n: errs.length, adv: w === 0 });
  }
  reviewers.sort((a, b) => b.w - a.w);
  return { byHandle, reviewers };
}

// ── self-signed SAMPLE fallback (real crypto, illustrative data) ────────────
interface SampleSeed {
  handle: string; band: Band; score: number; a: number; b: number;
  n_resolved: number; n_pending: number; capability_tier: number;
  cap_source: CapSource; cap_confidence: number | null; rationale: string;
  rule: number; judgment: number; hist: HistRow[]; rotate?: boolean; assert?: boolean;
}

const SAMPLE_SEEDS: SampleSeed[] = [
  { handle: 'strong-gbm-certifier@kapwork-receivables', band: 'gold', score: 0.857, a: 30, b: 5, n_resolved: 34, n_pending: 4, capability_tier: 0.80, cap_source: 'profile', cap_confidence: 0.82, rotate: true,
    rationale: 'score 0.857 ≥ 0.80 and n_resolved 34 ≥ 20 → gold. Gradient-boosting certifier; low realized default on approved invoices.',
    rule: 9, judgment: 41, hist: [['INV-40021', 'certify', 'judgment', 'paid', 41, 5], ['INV-40088', 'certify', 'rule', 'paid', 22, 4], ['INV-40103', 'reject', 'rule', 'default', 30, 3], ['INV-40155', 'certify', 'judgment', 'paid', 55, 5], ['INV-40199', 'certify', 'judgment', 'pending', null, 4]] },
  { handle: 'invoice-certifier@kapwork-receivables', band: 'silver', score: 0.667, a: 10.7, b: 5.3, n_resolved: 12, n_pending: 2, capability_tier: 0.75, cap_source: 'tier_proxy', cap_confidence: null,
    rationale: 'score 0.667 ≥ 0.65 and n_resolved 12 ≥ 10 → silver. Solid on judgment calls; evidence still accumulating.',
    rule: 4, judgment: 20, hist: [['INV-51002', 'certify', 'judgment', 'paid', 38, 4], ['INV-51014', 'certify', 'rule', 'paid', 21, 3], ['INV-51033', 'certify', 'judgment', 'default', 47, 2], ['INV-51050', 'reject', 'rule', 'default', 12, 3], ['INV-51071', 'certify', 'judgment', 'pending', null, 2]] },
  { handle: 'heuristic-tree@kapwork-receivables', band: 'bronze', score: 0.612, a: 5, b: 3, n_resolved: 6, n_pending: 1, capability_tier: 0.55, cap_source: 'tier_proxy', cap_confidence: null,
    rationale: 'n_resolved 6 ≥ 3 but score 0.612 < 0.65 silver floor → bronze. Shallow model; thin evidence caps the band.',
    rule: 3, judgment: 11, hist: [['INV-62010', 'certify', 'rule', 'paid', 25, 2], ['INV-62044', 'certify', 'judgment', 'default', 39, 1], ['INV-62077', 'certify', 'judgment', 'paid', 44, 2], ['INV-62090', 'reject', 'rule', 'paid', 18, 1]] },
  { handle: 'new-analyst@kapwork-receivables', band: 'unproven', score: 0.550, a: 2.2, b: 1.8, n_resolved: 1, n_pending: 2, capability_tier: 0.50, cap_source: 'profile', cap_confidence: 0.35, assert: true,
    rationale: 'n_resolved 1 < proven floor 3 → unproven. Honest cold-start: the prior, not a confident guess. Posterior is wide.',
    rule: 0, judgment: 3, hist: [['INV-70004', 'certify', 'judgment', 'pending', null, 1], ['INV-70009', 'certify', 'judgment', 'paid', 33, 1], ['INV-70012', 'certify', 'judgment', 'pending', null, 0]] },
  { handle: 'inverted-policy@kapwork-receivables', band: 'bronze', score: 0.318, a: 7, b: 15, n_resolved: 22, n_pending: 1, capability_tier: 0.45, cap_source: 'tier_proxy', cap_confidence: null,
    rationale: 'score 0.318 with n_resolved 22 → sits at the bottom. Approves invoices that default; the record sinks it on its own outcomes, no pedigree needed.',
    rule: 5, judgment: 31, hist: [['INV-80001', 'certify', 'judgment', 'default', 29, 1], ['INV-80019', 'certify', 'judgment', 'default', 34, 2], ['INV-80042', 'certify', 'rule', 'default', 26, 1], ['INV-80063', 'certify', 'judgment', 'paid', 51, 1], ['INV-80077', 'certify', 'judgment', 'default', 30, 2]] },
];

const SAMPLE_REVIEWERS: ReviewerRow[] = [
  { nm: 'senior-funder@kapwork', w: 0.99, brier: 0.004, n: 41 },
  { nm: 'credit-analyst@kapwork', w: 0.62, brier: 0.095, n: 25 },
  { nm: 'junior-analyst@kapwork', w: 0.34, brier: 0.150, n: 15 },
  { nm: 'review-farm-bot@spam', w: 0.00, brier: 0.251, n: 30, adv: true },
];

const SAMPLE_AS_OF = '2026-08-04T09:12:00Z';

function signAttestation(body: Omit<Attestation, 'signature'>, foundationPriv: string): Attestation {
  const sig = signRawMessage(canonCGRBody(body as unknown as Record<string, unknown>), foundationPriv);
  return { ...body, signature: sig };
}

async function loadSample(): Promise<LoadedData> {
  const foundation = generateKeypair();
  const rotationProofs: RotationProof[] = [];
  const proofsByCurrent = new Map<string, RotationProof[]>();

  const agents: AgentView[] = SAMPLE_SEEDS.map((s) => {
    const cur = generateKeypair();
    let subjectDid = didKey(cur.publicKeyHex);           // never rotated ⇒ anchor == current ⇒ verified
    if (s.rotate) {
      const anchor = generateKeypair();                  // rotated: anchor → current, real signed link ⇒ verified via chain
      const linkBody = { prev_key: anchor.publicKeyHex, new_key: cur.publicKeyHex, seq: 1, not_before: '2026-01-02T00:00:00Z', sig: '' } as RotationProof;
      const proof: RotationProof = { ...linkBody, sig: signRawMessage(canonLinkBody(linkBody as never), anchor.privateKeyHex) };
      rotationProofs.push(proof);
      proofsByCurrent.set(cur.publicKeyHex, [proof]);
      subjectDid = didKey(anchor.publicKeyHex);
    } else if (s.assert) {
      subjectDid = didKey(generateKeypair().publicKeyHex); // rotated-looking, but NO proofs ⇒ asserted (cautionary)
    }
    const att = signAttestation({
      agent_handle: s.handle, dimension: 'receivables', tier: s.band, cgr_score: s.score,
      confidence: s.a + s.b, n_resolved: s.n_resolved, capability_tier: s.capability_tier,
      as_of: SAMPLE_AS_OF, rationale: s.rationale,
      subject_key: cur.publicKeyHex, subject_did: subjectDid,
      schema: 'cgr.attestation.v2', issuer: 'gns-foundation', issuer_key_id: foundation.publicKeyHex,
    }, foundation.privateKeyHex);
    return {
      handle: s.handle, band: s.band, score: s.score, mean: s.a / (s.a + s.b), a: s.a, b: s.b,
      confidence: s.a + s.b, n_resolved: s.n_resolved, n_pending: s.n_pending,
      cap_d: s.capability_tier, cap_source: s.cap_source, cap_confidence: s.cap_confidence, capability_tier: s.capability_tier,
      as_of: SAMPLE_AS_OF, rationale: s.rationale, subject_key: cur.publicKeyHex, subject_did: subjectDid,
      attestation: att, rule: s.rule, judgment: s.judgment, hist: s.hist,
      verification: { sigValid: false, continuity: 'unverified' as ContinuityStatus },
    };
  });

  const fetchProofs: FetchProofs = async (current) => proofsByCurrent.get(current) ?? [];
  for (const ag of agents) ag.verification = await verifyAttestation(ag.attestation, foundation.publicKeyHex, fetchProofs);
  agents.sort((x, y) => y.mean - x.mean);
  return {
    agents, foundationKey: foundation.publicKeyHex, keyPinned: true, fetchProofs, source: 'sample',
    reviewers: SAMPLE_REVIEWERS, privateSubstrate: true, asOf: SAMPLE_AS_OF,
    note: 'Live grafomem endpoints not reachable — showing a self-signed SAMPLE. Verification is still real (an ephemeral Foundation key signs these; tamper to see it fail).',
  };
}

// ── public entry ────────────────────────────────────────────────────────────
export async function loadReputation(): Promise<LoadedData> {
  if (!GRAFOMEM_BASE && !(ENV.VITE_FORCE_LIVE)) return loadSample();
  try {
    return await loadLive();
  } catch (e) {
    const sample = await loadSample();
    sample.note = `Live load failed (${(e as Error).message}) — showing a self-signed SAMPLE. Verification is still real.`;
    return sample;
  }
}
