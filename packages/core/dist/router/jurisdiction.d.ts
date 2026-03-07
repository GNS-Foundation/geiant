import { H3Cell, JurisdictionResult, RegulatoryFramework, AntTier } from '../types/index.js';
/**
 * Resolve the JurisdictionResult for an H3 cell.
 *
 * Returns null if the cell cannot be resolved (open ocean, invalid cell, etc.)
 * The router rejects tasks with null jurisdiction.
 */
export declare function resolveJurisdiction(cell: H3Cell): Promise<JurisdictionResult | null>;
/**
 * Check if an agent operation at a given tier is permitted
 * under the most restrictive framework in the jurisdiction.
 */
export declare function isOperationPermitted(jurisdiction: JurisdictionResult, agentTier: AntTier): {
    permitted: boolean;
    restrictingFramework?: RegulatoryFramework;
};
//# sourceMappingURL=jurisdiction.d.ts.map