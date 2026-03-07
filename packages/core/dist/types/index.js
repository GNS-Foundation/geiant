// =============================================================================
// GEIANT — CORE TYPE DEFINITIONS
// Geo-Identity Agent Navigation & Tasking
// =============================================================================
//
// Type hierarchy:
//   AntIdentity        — an agent's GNS-derived cryptographic identity
//   AntManifest        — public registration record for the agent registry
//   DelegationCert     — human → agent authorization chain
//   GeiantTask         — a unit of work submitted to the router
//   RoutingDecision    — router output: selected ant + justification
//   SpatialMemoryNode  — a versioned geometry node in the spatial graph
//   ValidationResult   — geometry guardrail output
//   JurisdictionResult — resolved regulatory context for an H3 cell
// =============================================================================
export const ANT_TIER_MIN_OPS = {
    provisioned: 0,
    observed: 50,
    trusted: 500,
    certified: 5_000,
    sovereign: 50_000,
};
//# sourceMappingURL=index.js.map