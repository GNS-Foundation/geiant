// =============================================================================
// GEIANT — DELEGATION CHAIN VALIDATOR
// Verifies the human → agent authorization chain before any task dispatches.
// =============================================================================
//
// No task executes without a valid delegation chain.
// This is the mechanism that answers: "Which human authorized this AI action?"
//
// Validation steps:
//   1. Cert format integrity
//   2. Time window — not expired, not yet valid
//   3. Scope check — task cell within cert's scopeCells
//   4. Facet check — task facet within cert's scopeFacets
//   5. Sub-delegation depth — does not exceed maxSubdelegationDepth
//   6. Signature verification — human's Ed25519 sig over canonical cert JSON
// =============================================================================

import {
  DelegationCert,
  DelegationValidationResult,
  GeiantTask,
  H3Cell,
  AntFacet,
} from '../types/index.js';
import { isInTerritory } from '../agent/identity.js';

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

/**
 * Validate a delegation cert against a specific task.
 *
 * Returns a DelegationValidationResult with a human-readable reason
 * if validation fails — this becomes part of the audit breadcrumb.
 */
export function validateDelegation(
  cert: DelegationCert,
  task: GeiantTask,
  chainDepth = 0
): DelegationValidationResult {
  // 1. Format integrity
  const formatCheck = checkCertFormat(cert);
  if (!formatCheck.valid) {
    return {
      valid: false,
      errorReason: formatCheck.reason,
      chainDepth,
      humanVerified: false,
    };
  }

  // 2. Time window
  const now = new Date();
  const validFrom = new Date(cert.validFrom);
  const validUntil = new Date(cert.validUntil);

  if (now < validFrom) {
    return {
      valid: false,
      errorReason: `Cert not yet valid. Valid from: ${cert.validFrom}`,
      chainDepth,
      humanVerified: false,
    };
  }

  if (now > validUntil) {
    return {
      valid: false,
      errorReason: `Cert expired at ${cert.validUntil}`,
      chainDepth,
      humanVerified: false,
    };
  }

  // 3. Agent match
  if (cert.agentPublicKey !== task.callerPublicKey) {
    // Only enforce if caller is the agent (not an orchestrator delegating)
    // In sub-delegation scenarios, the parent cert covers the orchestrator
  }

  // 4. Territory scope
  if (!isCellInScope(task.originCell, cert.scopeCells)) {
    return {
      valid: false,
      errorReason: `Task origin cell ${task.originCell} is outside cert's scope cells`,
      chainDepth,
      humanVerified: false,
    };
  }

  // 5. Facet scope
  if (!cert.scopeFacets.includes(task.requiredFacet)) {
    return {
      valid: false,
      errorReason: `Task facet '${task.requiredFacet}' not in cert's scopeFacets: [${cert.scopeFacets.join(', ')}]`,
      chainDepth,
      humanVerified: false,
    };
  }

  // 6. Sub-delegation depth
  if (chainDepth > cert.maxSubdelegationDepth) {
    return {
      valid: false,
      errorReason: `Sub-delegation depth ${chainDepth} exceeds cert maximum ${cert.maxSubdelegationDepth}`,
      chainDepth,
      humanVerified: false,
    };
  }

  // 7. Signature verification (stub — full impl requires Ed25519 verify)
  const sigValid = verifyCertSignature(cert);
  if (!sigValid) {
    return {
      valid: false,
      errorReason: 'Human signature verification failed',
      chainDepth,
      humanVerified: false,
    };
  }

  return {
    valid: true,
    chainDepth,
    humanVerified: true, // Stub: full impl checks PoT score of humanPublicKey
  };
}

// ---------------------------------------------------------------------------
// Sub-delegation
// ---------------------------------------------------------------------------

/**
 * Create a sub-delegation cert for an orchestrator to delegate to a sub-agent.
 * Enforces depth limits from the parent cert.
 *
 * @param parentCert - the cert the orchestrator operates under
 * @param subAgentPublicKey - the sub-agent being delegated to
 * @param scopeReduction - optionally narrow scope further
 */
export function createSubDelegation(
  parentCert: DelegationCert,
  subAgentPublicKey: string,
  scopeReduction?: {
    cells?: H3Cell[];
    facets?: AntFacet[];
    validUntil?: string;
  }
): Omit<DelegationCert, 'humanSignature'> {
  if (parentCert.maxSubdelegationDepth <= 0) {
    throw new Error('Parent cert does not permit sub-delegation');
  }

  const effectiveCells = scopeReduction?.cells
    ? parentCert.scopeCells.filter(c => scopeReduction.cells!.includes(c))
    : parentCert.scopeCells;

  const effectiveFacets = scopeReduction?.facets
    ? parentCert.scopeFacets.filter(f => scopeReduction.facets!.includes(f))
    : parentCert.scopeFacets;

  const effectiveUntil = scopeReduction?.validUntil
    ? new Date(Math.min(
        new Date(parentCert.validUntil).getTime(),
        new Date(scopeReduction.validUntil).getTime()
      )).toISOString()
    : parentCert.validUntil;

  return {
    id: crypto.randomUUID(),
    humanPublicKey: parentCert.humanPublicKey,
    humanHandle: parentCert.humanHandle,
    agentPublicKey: subAgentPublicKey,
    scopeCells: effectiveCells,
    scopeFacets: effectiveFacets,
    validFrom: new Date().toISOString(),
    validUntil: effectiveUntil,
    maxSubdelegationDepth: parentCert.maxSubdelegationDepth - 1,
    parentCertHash: hashCert(parentCert),
    // humanSignature must be added by caller using the human's private key
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkCertFormat(cert: DelegationCert): { valid: boolean; reason?: string } {
  if (!cert.id) return { valid: false, reason: 'Missing cert ID' };
  if (!cert.humanPublicKey || cert.humanPublicKey.length !== 64)
    return { valid: false, reason: 'Invalid humanPublicKey (must be 64 hex chars)' };
  if (!cert.agentPublicKey || cert.agentPublicKey.length !== 64)
    return { valid: false, reason: 'Invalid agentPublicKey (must be 64 hex chars)' };
  if (!cert.scopeCells || cert.scopeCells.length === 0)
    return { valid: false, reason: 'Cert must declare at least one scope cell' };
  if (!cert.scopeFacets || cert.scopeFacets.length === 0)
    return { valid: false, reason: 'Cert must declare at least one scope facet' };
  if (!cert.humanSignature)
    return { valid: false, reason: 'Missing human signature' };
  return { valid: true };
}

function isCellInScope(taskCell: H3Cell, scopeCells: H3Cell[]): boolean {
  // Allow border buffer of k=1 — task at territory edge should resolve
  return isInTerritory(taskCell, scopeCells, true);
}

/**
 * Stub — full implementation uses Ed25519 verify from @noble/ed25519
 * against canonical JSON (sorted keys, no whitespace).
 */
function verifyCertSignature(cert: DelegationCert): boolean {
  // TODO: implement Ed25519 signature verification
  // import * as ed from '@noble/ed25519';
  // const canonical = canonicalJson(cert without humanSignature field);
  // const msgBytes = new TextEncoder().encode(canonical);
  // const sigBytes = hexToBytes(cert.humanSignature);
  // const pubBytes = hexToBytes(cert.humanPublicKey);
  // return await ed.verify(sigBytes, msgBytes, pubBytes);
  return cert.humanSignature.length === 128; // Stub: valid-length sig
}

/**
 * Compute a deterministic hash of a cert for chaining.
 * Full impl: SHA-256 of canonical JSON.
 */
export function hashCert(cert: DelegationCert): string {
  // Stub — full impl: crypto.createHash('sha256').update(canonicalJson(cert)).digest('hex')
  return `hash_${cert.id.replace(/-/g, '').substring(0, 16)}`;
}
