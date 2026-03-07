// =============================================================================
// GEIANT — SYNTHETIC DATASET TYPES
// Schema for geospatial agent benchmark datasets published to HuggingFace.
// =============================================================================
//
// Three dataset families:
//
//   1. JurisdictionalRouting   — "Which agent handles a task at this location?"
//      Tests: H3 cell → country → framework resolution, agent selection,
//             cross-border routing, compliance tier enforcement
//
//   2. GeometryMutation        — "Did the agent corrupt the geometry?"
//      Tests: multi-step geometry workflows with intentional invalid geometry
//             injection at random steps, self-intersection, coord transposition
//
//   3. DelegationChain         — "Is this human authorization valid?"
//      Tests: cert expiry, scope violations, depth exceeded, sig verification
//
// Each scenario has:
//   - input: the task/cert/geometry submitted
//   - expected_outcome: what GEIANT should do (route/reject/flag)
//   - ground_truth: the authoritative answer
//   - difficulty: easy/medium/hard/adversarial
//   - tags: for filtering and benchmarking
// =============================================================================
export {};
//# sourceMappingURL=types.js.map