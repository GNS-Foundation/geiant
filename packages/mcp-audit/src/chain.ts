// ===========================================
// GEIANT Phase 5.1.0 — Virtual Breadcrumb Chain
// TypeScript port of BreadcrumbBlock + ChainStorage
// Uses tweetnacl (same as gns-node/crypto.ts)
// Location: packages/mcp-audit/src/chain.ts
// ===========================================

import nacl from 'tweetnacl';
import {
  VirtualBreadcrumbBlock,
  BlockDataToSign,
  AgentMetaFlags,
  AgentTier,
  TIER_THRESHOLDS,
  DelegationCertificate,
  ChainVerificationResult,
  JurisdictionCheck,
} from './types';

// ===========================================
// Hex / Hash Utilities
// ===========================================

export function hexToBytes(hex: string): Uint8Array {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    b[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return b;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const encoder = new TextEncoder();

/**
 * SHA-256 via SubtleCrypto (available in Node 18+ and all modern runtimes).
 * Falls back to tweetnacl SHA-512 truncated if SubtleCrypto unavailable.
 */
export async function sha256Hex(data: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    const buf = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(data));
    return bytesToHex(new Uint8Array(buf));
  }
  // Fallback: tweetnacl SHA-512, take first 32 bytes
  const full = nacl.hash(encoder.encode(data));
  return bytesToHex(full.slice(0, 32));
}

/**
 * Synchronous SHA-256 for hot paths (uses tweetnacl fallback).
 * Prefer async sha256Hex when possible.
 */
export function sha256HexSync(data: string): string {
  const full = nacl.hash(encoder.encode(data));
  return bytesToHex(full.slice(0, 32));
}

// ===========================================
// Canonical JSON (matches gns-node/crypto.ts)
// ===========================================

export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(k => `"${k}":${canonicalJson((obj as Record<string, unknown>)[k])}`);
  return '{' + pairs.join(',') + '}';
}

// ===========================================
// Delegation Certificate Hashing
// ===========================================

export async function hashDelegationCert(cert: DelegationCertificate): Promise<string> {
  const data = canonicalJson({
    version: cert.version,
    agent_pk: cert.agent_pk,
    principal_pk: cert.principal_pk,
    h3_cells: cert.h3_cells,
    facets: cert.facets,
    not_before: cert.not_before,
    not_after: cert.not_after,
    max_depth: cert.max_depth,
    constraints: cert.constraints ?? null,
  });
  return sha256Hex(data);
}

// ===========================================
// Delegation Certificate Verification
// ===========================================

export function verifyDelegationCert(cert: DelegationCertificate): boolean {
  const data = canonicalJson({
    version: cert.version,
    agent_pk: cert.agent_pk,
    principal_pk: cert.principal_pk,
    h3_cells: cert.h3_cells,
    facets: cert.facets,
    not_before: cert.not_before,
    not_after: cert.not_after,
    max_depth: cert.max_depth,
    constraints: cert.constraints ?? null,
  });
  try {
    const pk = hexToBytes(cert.principal_pk);
    const sig = hexToBytes(cert.principal_signature);
    const msg = encoder.encode(data);
    return nacl.sign.detached.verify(msg, sig, pk);
  } catch {
    return false;
  }
}

export function isDelegationCertActive(cert: DelegationCertificate, now?: Date): boolean {
  const t = (now ?? new Date()).toISOString();
  return t >= cert.not_before && t <= cert.not_after;
}

// ===========================================
// Jurisdiction Gate
// ===========================================

export function checkJurisdiction(
  targetCell: string,
  cert: DelegationCertificate,
): JurisdictionCheck {
  const allowed = cert.h3_cells.includes(targetCell);
  return {
    allowed,
    target_cell: targetCell,
    allowed_cells: cert.h3_cells,
    reason: allowed ? undefined : `Cell ${targetCell} not in delegation scope`,
  };
}

export function checkFacet(
  facet: string,
  cert: DelegationCertificate,
): { allowed: boolean; reason?: string } {
  const allowed = cert.facets.includes(facet) || cert.facets.includes('*');
  return {
    allowed,
    reason: allowed ? undefined : `Facet "${facet}" not in delegation scope`,
  };
}

export function checkToolAllowed(
  toolName: string,
  cert: DelegationCertificate,
): { allowed: boolean; reason?: string } {
  if (!cert.constraints) return { allowed: true };
  if (cert.constraints.denied_tools?.includes(toolName)) {
    return { allowed: false, reason: `Tool "${toolName}" is denied by delegation` };
  }
  if (cert.constraints.allowed_tools && !cert.constraints.allowed_tools.includes(toolName)) {
    return { allowed: false, reason: `Tool "${toolName}" not in allowed tools whitelist` };
  }
  return { allowed: true };
}

// ===========================================
// Block Builder
// ===========================================

export function buildDataToSign(params: BlockDataToSign): string {
  return canonicalJson({
    context: params.context,
    delegation_cert_hash: params.delegation_cert_hash,
    facet: params.facet,
    identity: params.identity,
    index: params.index,
    loc_cell: params.loc_cell,
    loc_res: params.loc_res,
    meta: params.meta,
    prev_hash: params.prev_hash,
    timestamp: params.timestamp,
    tool_name: params.tool_name,
  });
}

export async function buildBlock(params: {
  index: number;
  agentPk: string;
  agentSk: Uint8Array;
  timestamp: Date;
  locationCell: string;
  locationResolution: number;
  contextDigest: string;
  previousHash: string | null;
  metaFlags: AgentMetaFlags;
  delegationCertHash: string;
  toolName: string;
  facet: string;
}): Promise<VirtualBreadcrumbBlock> {
  const dataToSign = buildDataToSign({
    index: params.index,
    identity: params.agentPk,
    timestamp: params.timestamp.toISOString(),
    loc_cell: params.locationCell,
    loc_res: params.locationResolution,
    context: params.contextDigest,
    prev_hash: params.previousHash ?? 'genesis',
    meta: params.metaFlags,
    delegation_cert_hash: params.delegationCertHash,
    tool_name: params.toolName,
    facet: params.facet,
  });

  const sigBytes = nacl.sign.detached(encoder.encode(dataToSign), params.agentSk);
  const signature = bytesToHex(sigBytes);
  const blockHash = await sha256Hex(`${dataToSign}:${signature}`);

  return {
    index: params.index,
    identity_public_key: params.agentPk,
    timestamp: params.timestamp.toISOString(),
    location_cell: params.locationCell,
    location_resolution: params.locationResolution,
    context_digest: params.contextDigest,
    previous_hash: params.previousHash,
    meta_flags: params.metaFlags,
    signature,
    block_hash: blockHash,
    delegation_cert_hash: params.delegationCertHash,
    tool_name: params.toolName,
    facet: params.facet,
  };
}

// ===========================================
// Block Verification
// ===========================================

export function verifyBlockSignature(block: VirtualBreadcrumbBlock): boolean {
  const dataToSign = buildDataToSign({
    index: block.index,
    identity: block.identity_public_key,
    timestamp: block.timestamp,
    loc_cell: block.location_cell,
    loc_res: block.location_resolution,
    context: block.context_digest,
    prev_hash: block.previous_hash ?? 'genesis',
    meta: block.meta_flags,
    delegation_cert_hash: block.delegation_cert_hash,
    tool_name: block.tool_name,
    facet: block.facet,
  });
  try {
    const pk = hexToBytes(block.identity_public_key);
    const sig = hexToBytes(block.signature);
    return nacl.sign.detached.verify(encoder.encode(dataToSign), sig, pk);
  } catch {
    return false;
  }
}

export async function verifyBlockHash(block: VirtualBreadcrumbBlock): Promise<boolean> {
  const dataToSign = buildDataToSign({
    index: block.index,
    identity: block.identity_public_key,
    timestamp: block.timestamp,
    loc_cell: block.location_cell,
    loc_res: block.location_resolution,
    context: block.context_digest,
    prev_hash: block.previous_hash ?? 'genesis',
    meta: block.meta_flags,
    delegation_cert_hash: block.delegation_cert_hash,
    tool_name: block.tool_name,
    facet: block.facet,
  });
  const expected = await sha256Hex(`${dataToSign}:${block.signature}`);
  return expected === block.block_hash;
}

export function verifyChainLink(
  block: VirtualBreadcrumbBlock,
  previousBlock: VirtualBreadcrumbBlock | null,
): boolean {
  if (block.index === 0) return block.previous_hash === null;
  if (!previousBlock) return false;
  return block.previous_hash === previousBlock.block_hash;
}

// ===========================================
// Full Chain Verification
// ===========================================

export async function verifyChain(
  blocks: VirtualBreadcrumbBlock[],
): Promise<ChainVerificationResult> {
  if (blocks.length === 0) {
    return { is_valid: true, block_count: 0, issues: [] };
  }

  const sorted = [...blocks].sort((a, b) => a.index - b.index);
  const issues: string[] = [];
  let prev: VirtualBreadcrumbBlock | null = null;

  for (const block of sorted) {
    if (prev && block.index !== prev.index + 1) {
      issues.push(`Block ${block.index}: index gap (expected ${prev.index + 1})`);
    }
    if (!verifyChainLink(block, prev)) {
      issues.push(`Block ${block.index}: invalid chain link`);
    }
    const hashValid = await verifyBlockHash(block);
    if (!hashValid) {
      issues.push(`Block ${block.index}: hash mismatch`);
    }
    if (!verifyBlockSignature(block)) {
      issues.push(`Block ${block.index}: invalid signature`);
    }
    if (prev && block.timestamp < prev.timestamp) {
      issues.push(`Block ${block.index}: timestamp before previous`);
    }
    prev = block;
  }

  return {
    is_valid: issues.length === 0,
    block_count: sorted.length,
    issues,
    first_block_at: sorted[0].timestamp,
    last_block_at: sorted[sorted.length - 1].timestamp,
    delegation_cert_hash: sorted[0].delegation_cert_hash,
  };
}

// ===========================================
// Trust Score Computation
// ===========================================

export function computeTier(opCount: number): AgentTier {
  if (opCount >= TIER_THRESHOLDS[AgentTier.SOVEREIGN].min_ops) return AgentTier.SOVEREIGN;
  if (opCount >= TIER_THRESHOLDS[AgentTier.CERTIFIED].min_ops) return AgentTier.CERTIFIED;
  if (opCount >= TIER_THRESHOLDS[AgentTier.TRUSTED].min_ops) return AgentTier.TRUSTED;
  if (opCount >= TIER_THRESHOLDS[AgentTier.OBSERVED].min_ops) return AgentTier.OBSERVED;
  return AgentTier.PROVISIONED;
}

export function computeTrustScore(params: {
  opCount: number;
  uniqueCells: number;
  daysSinceFirst: number;
  chainValid: boolean;
}): number {
  let score = Math.min(params.opCount / 5000, 0.4) * 100;
  score += Math.min(params.uniqueCells / 20, 0.3) * 100;
  score += Math.min(params.daysSinceFirst / 365, 0.2) * 100;
  if (params.chainValid) score += 10;
  return Math.min(Math.max(score, 0), 100);
}

// ===========================================
// Context Digest Builder
// ===========================================

export async function buildContextDigest(
  toolInput: unknown,
  toolOutput: unknown,
): Promise<{ contextDigest: string; inputHash: string; outputHash: string }> {
  const inputHash = await sha256Hex(canonicalJson(toolInput));
  const outputHash = await sha256Hex(canonicalJson(toolOutput));
  const contextDigest = await sha256Hex(`${inputHash}:${outputHash}`);
  return { contextDigest, inputHash, outputHash };
}
