import { AntFacet, AntTier, AntManifest, H3Cell } from '../types/index.js';
/**
 * Derive the correct AntTier from an operation count.
 * This is deterministic — no discretion, no admin override.
 */
export declare function computeTier(operationCount: number): AntTier;
/**
 * Compare two tiers — returns true if `actual` satisfies `required`.
 */
export declare function tierSatisfies(actual: AntTier, required: AntTier): boolean;
/**
 * Check whether a given H3 cell falls within an ant's declared territory.
 *
 * Uses H3 containment: the task cell must be one of the ant's territory cells
 * OR contained within a k=1 ring of them (one-cell buffer for border tasks).
 */
export declare function isInTerritory(taskCell: H3Cell, territoryCells: H3Cell[], allowBorderBuffer?: boolean): boolean;
/**
 * Compute the H3 cells (res 5) for a lat/lng centroid + radius in km.
 * Useful for provisioning territory from a geographic description.
 */
export declare function cellsFromRadius(lat: number, lng: number, radiusKm: number, resolution?: number): H3Cell[];
/**
 * Construct a GNS-style handle from facet + territory name.
 * e.g. ("health", "eu-north") → "health@eu-north"
 */
export declare function buildHandle(facet: AntFacet, territoryName: string): string;
/**
 * Parse a handle into facet + territory components.
 */
export declare function parseHandle(handle: string): {
    facet: string;
    territory: string;
} | null;
/**
 * Derive a Stellar-compatible account ID representation from an Ed25519 public key.
 *
 * Note: In the full implementation this calls the GNS stellar_service
 * conversion (Ed25519 hex → Stellar G... format). Stubbed here for Phase 0.
 */
export declare function derivestellarAccountId(publicKeyHex: string): string;
/**
 * Verify the internal consistency of an AntManifest.
 * Does NOT verify the Ed25519 signature (that requires the crypto module).
 */
export declare function validateManifestStructure(manifest: AntManifest): {
    valid: boolean;
    errors: string[];
};
/**
 * Score an ant's fitness for a given task cell.
 * Higher is better. Used by the router to rank candidates.
 *
 * Factors:
 *   - Territory overlap (0 or 1 — hard requirement)
 *   - Compliance score (0–100)
 *   - Tier relative to required tier
 *   - Operation count (experience proxy)
 */
export declare function scoreAntFitness(manifest: AntManifest, taskCell: H3Cell, requiredTier: AntTier): number;
//# sourceMappingURL=identity.d.ts.map