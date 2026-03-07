import { DelegationCert, DelegationValidationResult, GeiantTask, H3Cell, AntFacet } from '../types/index.js';
/**
 * Validate a delegation cert against a specific task.
 *
 * Returns a DelegationValidationResult with a human-readable reason
 * if validation fails — this becomes part of the audit breadcrumb.
 */
export declare function validateDelegation(cert: DelegationCert, task: GeiantTask, chainDepth?: number): DelegationValidationResult;
/**
 * Create a sub-delegation cert for an orchestrator to delegate to a sub-agent.
 * Enforces depth limits from the parent cert.
 *
 * @param parentCert - the cert the orchestrator operates under
 * @param subAgentPublicKey - the sub-agent being delegated to
 * @param scopeReduction - optionally narrow scope further
 */
export declare function createSubDelegation(parentCert: DelegationCert, subAgentPublicKey: string, scopeReduction?: {
    cells?: H3Cell[];
    facets?: AntFacet[];
    validUntil?: string;
}): Omit<DelegationCert, 'humanSignature'>;
/**
 * Compute a deterministic hash of a cert for chaining.
 * Full impl: SHA-256 of canonical JSON.
 */
export declare function hashCert(cert: DelegationCert): string;
//# sourceMappingURL=delegation.d.ts.map