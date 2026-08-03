// =============================================================================
// GEIANT — AGENT IDENTITY
// Provisioning, verification, and tier management for ants
// =============================================================================
//
// An ant's identity is derived from the GNS Ed25519 keypair model.
// No API keys. No OAuth. The public key IS the identity.
//
// Key operations:
//   provisionAnt()      — create a new ant identity from a keypair
//   verifyAntSignature()— verify a message signed by an ant
//   computeTier()       — derive tier from operation count
//   isInTerritory()     — check if an H3 cell falls within declared territory
// =============================================================================

import { latLngToCell, gridDisk, isPentagon, cellToLatLng } from 'h3-js';
import {
  AntIdentity,
  AntFacet,
  AntTier,
  AntManifest,
  CGRBand,
  H3Cell,
  ANT_TIER_MIN_OPS,
} from '../types/index.js';
import { verifyCGRAttestation, getFoundationPubKey, CGR_BAND_RANK } from './cgr.js';

// ---------------------------------------------------------------------------
// Tier computation
// ---------------------------------------------------------------------------

/**
 * Derive the correct AntTier from an operation count.
 * This is deterministic — no discretion, no admin override.
 */
export function computeTier(operationCount: number): AntTier {
  if (operationCount >= ANT_TIER_MIN_OPS.sovereign)   return 'sovereign';
  if (operationCount >= ANT_TIER_MIN_OPS.certified)   return 'certified';
  if (operationCount >= ANT_TIER_MIN_OPS.trusted)     return 'trusted';
  if (operationCount >= ANT_TIER_MIN_OPS.observed)    return 'observed';
  return 'provisioned';
}

/**
 * Compare two tiers — returns true if `actual` satisfies `required`.
 */
export function tierSatisfies(actual: AntTier, required: AntTier): boolean {
  const order: AntTier[] = ['provisioned', 'observed', 'trusted', 'certified', 'sovereign'];
  return order.indexOf(actual) >= order.indexOf(required);
}

// ---------------------------------------------------------------------------
// CGR — earned judgment-quality axis (orthogonal to the volume-based tier)
// ---------------------------------------------------------------------------
//
// The AntTier ladder stays the VERIFIABLE eligibility axis; the Foundation-issued
// CGR band is the EARNED axis. effectiveTrust exposes both — never collapsed.
// Trust decisions always RE-VERIFY the attestation against the pinned Foundation
// key; a stored band is display metadata, never authority.

/** Facets whose quality can't be checked from ops volume — CGR should dominate. */
const UNVERIFIABLE_FACETS: ReadonlySet<AntFacet> = new Set<AntFacet>(['finance', 'legal']);

// scoreAntFitness CGR-term tuning. Illustrative — satisfies the ordering invariant
// (finance gold+high-conf outranks high-ops unproven); tune with real data.
const CGR_CONF_FULL = 20;            // n_resolved at which confidence weight saturates
const CGR_WEIGHT_UNVERIFIABLE = 40;  // gold(3)×full-conf ⇒ +120, dwarfs volume's max +20
const CGR_WEIGHT_DEFAULT = 8;        // modest nudge where ops volume still carries signal

/**
 * The verified CGR band for a manifest, or 'unproven' if there is no attestation
 * or it fails verification against the pinned Foundation key. NEVER returns a band
 * from an unverified/tampered attestation.
 */
export function cgrBand(
  manifest: AntManifest,
  foundationPubKeyHex = getFoundationPubKey()
): CGRBand {
  if (!manifest.cgr) return 'unproven';
  // Bind on the GEIANT IDENTITY KEY (#5), not the handle. verifyCGRAttestation
  // requires att.subject_key === this key; a v1 attestation (no subject_key) or a
  // key mismatch fails → 'unproven' (fail-safe). The handle is only a label now.
  const res = verifyCGRAttestation(manifest.cgr, foundationPubKeyHex, {
    expectedKey: manifest.identity.publicKey,
  });
  return res.valid ? manifest.cgr.tier : 'unproven';
}

/**
 * Expose BOTH trust axes for a manifest: the volume-based eligibility `tier` and
 * the earned `cgrBand`. This is the surface the dashboard/website consume later.
 */
export function effectiveTrust(
  manifest: AntManifest,
  foundationPubKeyHex = getFoundationPubKey()
): { tier: AntTier; cgrBand: CGRBand } {
  return {
    tier: manifest.identity.tier,
    cgrBand: cgrBand(manifest, foundationPubKeyHex),
  };
}

/**
 * #7 identity continuity — the verified identity view for display: the CURRENT
 * operational key, the stable identity ANCHOR did:key, and the band. `subjectKey`
 * and `anchorDid` are populated ONLY when the attestation verifies against the
 * pinned Foundation key (never from an unverified/tampered attestation). Binding is
 * UNCHANGED — this reads the same verified result cgrBand() binds on.
 */
export function cgrIdentity(
  manifest: AntManifest,
  foundationPubKeyHex = getFoundationPubKey()
): { band: CGRBand; subjectKey?: string; anchorDid?: string } {
  if (!manifest.cgr) return { band: 'unproven' };
  const res = verifyCGRAttestation(manifest.cgr, foundationPubKeyHex, {
    expectedKey: manifest.identity.publicKey,
  });
  if (!res.valid) return { band: 'unproven' };
  return { band: manifest.cgr.tier, subjectKey: res.subjectKey, anchorDid: res.subjectDid };
}

// Task F — advisory CGR capability ceiling for financial-autonomy tiers.
// Financial autonomy shouldn't be reachable on ops volume alone. Advisory only
// (surfaces a warning); NOT a hard gate, so legacy/unproven agents keep the tiers
// they already hold until we decide to enforce.
const MIN_BAND_FOR_TIER: Partial<Record<AntTier, CGRBand>> = {
  certified: 'bronze',
  sovereign: 'silver',
};

export function cgrCapabilityAdvisory(
  manifest: AntManifest,
  foundationPubKeyHex = getFoundationPubKey()
): { ok: boolean; warning?: string } {
  const required = MIN_BAND_FOR_TIER[manifest.identity.tier];
  if (!required) return { ok: true };
  const band = cgrBand(manifest, foundationPubKeyHex);
  if (CGR_BAND_RANK[band] >= CGR_BAND_RANK[required]) return { ok: true };
  return {
    ok: false,
    warning:
      `tier '${manifest.identity.tier}' has CGR band '${band}' < advised '${required}' — ` +
      `financial-autonomy trust should not rest on operation volume alone`,
  };
}

// ---------------------------------------------------------------------------
// Territory checks
// ---------------------------------------------------------------------------

/**
 * Check whether a given H3 cell falls within an ant's declared territory.
 *
 * Uses H3 containment: the task cell must be one of the ant's territory cells
 * OR contained within a k=1 ring of them (one-cell buffer for border tasks).
 */
export function isInTerritory(
  taskCell: H3Cell,
  territoryCells: H3Cell[],
  allowBorderBuffer = false
): boolean {
  if (territoryCells.includes(taskCell)) return true;

  if (allowBorderBuffer) {
    for (const cell of territoryCells) {
      const ring = gridDisk(cell, 1);
      if (ring.includes(taskCell)) return true;
    }
  }

  return false;
}

/**
 * Compute the H3 cells (res 5) for a lat/lng centroid + radius in km.
 * Useful for provisioning territory from a geographic description.
 */
export function cellsFromRadius(
  lat: number,
  lng: number,
  radiusKm: number,
  resolution = 5
): H3Cell[] {
  const centerCell = latLngToCell(lat, lng, resolution);
  // Approximate: 1 H3 res-5 cell ≈ ~252 km edge length, use gridDisk
  // k rings: each ring ~= cell edge length apart
  const kRings = Math.ceil(radiusKm / 50); // rough approximation for res 5
  return gridDisk(centerCell, Math.max(0, kRings));
}

// ---------------------------------------------------------------------------
// Identity construction helpers
// ---------------------------------------------------------------------------

/**
 * Construct a GNS-style handle from facet + territory name.
 * e.g. ("health", "eu-north") → "health@eu-north"
 */
export function buildHandle(facet: AntFacet, territoryName: string): string {
  const clean = territoryName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return `${facet}@${clean}`;
}

/**
 * Parse a handle into facet + territory components.
 */
export function parseHandle(handle: string): { facet: string; territory: string } | null {
  const parts = handle.split('@');
  if (parts.length !== 2) return null;
  return { facet: parts[0], territory: parts[1] };
}

/**
 * Derive a Stellar-compatible account ID representation from an Ed25519 public key.
 *
 * Note: In the full implementation this calls the GNS stellar_service
 * conversion (Ed25519 hex → Stellar G... format). Stubbed here for Phase 0.
 */
export function derivestellarAccountId(publicKeyHex: string): string {
  // Stub — full impl uses stellar SDK KeyPair.fromPublicKey(hexToBytes(publicKeyHex)).accountId
  return `G_STUB_${publicKeyHex.substring(0, 16).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Manifest helpers
// ---------------------------------------------------------------------------

/**
 * Verify the internal consistency of an AntManifest.
 * Does NOT verify the Ed25519 signature (that requires the crypto module).
 */
export function validateManifestStructure(manifest: AntManifest): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!manifest.identity.publicKey || manifest.identity.publicKey.length !== 64) {
    errors.push('publicKey must be 64 hex characters');
  }

  if (!manifest.identity.handle.includes('@')) {
    errors.push('handle must be in format facet@territory');
  }

  if (manifest.identity.territoryCells.length === 0) {
    errors.push('agent must declare at least one H3 territory cell');
  }

  if (manifest.operationCount < 0) {
    errors.push('operationCount cannot be negative');
  }

  if (manifest.complianceScore < 0 || manifest.complianceScore > 100) {
    errors.push('complianceScore must be 0–100');
  }

  // Verify tier matches operation count
  const expectedTier = computeTier(manifest.operationCount);
  if (manifest.identity.tier !== expectedTier) {
    errors.push(
      `tier '${manifest.identity.tier}' does not match operationCount ${manifest.operationCount} (expected '${expectedTier}')`
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Score an ant's fitness for a given task cell.
 * Higher is better. Used by the router to rank candidates.
 *
 * Factors:
 *   - Territory overlap (0 or 1 — hard requirement)
 *   - Compliance score (0–100)
 *   - Tier relative to required tier
 *   - Operation count (experience proxy) — for verifiable facets
 *   - CGR band × confidence (earned quality) — dominates volume for finance/legal
 *
 * Backward-compatible: an agent with no verified CGR attestation scores EXACTLY
 * as before (tier + compliance + experience) — legacy ranking is unchanged.
 */
export function scoreAntFitness(
  manifest: AntManifest,
  taskCell: H3Cell,
  requiredTier: AntTier,
  foundationPubKeyHex = getFoundationPubKey()
): number {
  if (!isInTerritory(taskCell, manifest.identity.territoryCells, true)) {
    return -1; // ineligible
  }

  const tierBonus = tierSatisfies(manifest.identity.tier, requiredTier) ? 20 : -100;
  const complianceBonus = manifest.complianceScore; // 0–100
  const experienceBonus = Math.min(20, Math.log10(manifest.operationCount + 1) * 5);
  const base = tierBonus + complianceBonus;

  const band = cgrBand(manifest, foundationPubKeyHex);
  if (band === 'unproven') {
    // No verified attestation ⇒ EXACTLY today's volume-based behaviour.
    return base + experienceBonus;
  }

  const rank = CGR_BAND_RANK[band];                                   // 1..3 (bronze..gold)
  const conf = Math.min(1, manifest.cgr!.n_resolved / CGR_CONF_FULL); // evidence weight in [0,1]

  if (UNVERIFIABLE_FACETS.has(manifest.identity.facet)) {
    // finance/legal: the CGR band×confidence term DOMINATES; drop the volume
    // reward, which is exactly the gameable signal CGR corrects.
    return base + rank * CGR_WEIGHT_UNVERIFIABLE * conf;
  }
  // verifiable / ops-heavy facets: keep the volume signal, add a modest CGR nudge.
  return base + experienceBonus + rank * CGR_WEIGHT_DEFAULT * conf;
}
