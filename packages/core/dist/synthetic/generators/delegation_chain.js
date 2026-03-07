"use strict";
// =============================================================================
// GEIANT — DELEGATION CHAIN GENERATOR
// Scenarios for human→agent authorization cert validation.
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDelegationChainScenarios = generateDelegationChainScenarios;
const h3_js_1 = require("h3-js");
const uuid_1 = require("uuid");
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ROME_CELL = (0, h3_js_1.latLngToCell)(41.902, 12.496, 7);
const MILAN_CELL = (0, h3_js_1.latLngToCell)(45.464, 9.190, 7);
const ZURICH_CELL = (0, h3_js_1.latLngToCell)(47.376, 8.541, 7);
const BERLIN_CELL = (0, h3_js_1.latLngToCell)(52.520, 13.405, 7);
const ROME_SCOPE = (0, h3_js_1.gridDisk)((0, h3_js_1.latLngToCell)(41.902, 12.496, 5), 2);
const MILAN_SCOPE = (0, h3_js_1.gridDisk)((0, h3_js_1.latLngToCell)(45.464, 9.190, 5), 2);
const ZURICH_SCOPE = (0, h3_js_1.gridDisk)((0, h3_js_1.latLngToCell)(47.376, 8.541, 5), 2);
const NOW = new Date();
const PAST = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
const FUTURE = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
const WAY_PAST = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
function iso(d) { return d.toISOString(); }
function cert(humanHandle, agentHandle, scopeCells, scopeFacets, validFrom, validUntil, maxDepth, flaw = 'none') {
    return {
        human_handle: humanHandle,
        agent_handle: agentHandle,
        scope_cells: scopeCells,
        scope_facets: scopeFacets,
        valid_from: iso(validFrom),
        valid_until: iso(validUntil),
        max_subdelegation_depth: maxDepth,
        injected_flaw: flaw,
    };
}
function delegScenario(description, originCell, facet, minTier, certObj, expectedOutcome, explanation, delegationValid, rejectionReason, difficulty, tags) {
    return {
        id: (0, uuid_1.v4)(),
        family: 'delegation_chain',
        description,
        input: {
            task_origin_cell: originCell,
            task_facet: facet,
            task_min_tier: minTier,
            cert: certObj,
        },
        expected_outcome: expectedOutcome,
        ground_truth: {
            delegation_valid: delegationValid,
            delegation_rejection: rejectionReason,
            explanation,
        },
        difficulty,
        tags,
        generated_at: new Date().toISOString(),
        geiant_version: '0.1.0',
    };
}
// ---------------------------------------------------------------------------
// Generate all delegation chain scenarios
// ---------------------------------------------------------------------------
function generateDelegationChainScenarios() {
    const records = [];
    // ── Valid certs ────────────────────────────────────────────────────────────
    records.push(delegScenario('Valid delegation — grid task in Rome, cert covers Rome territory', ROME_CELL, 'grid', 'trusted', cert('@cayerbe', 'grid@rome-zone-1', ROME_SCOPE, ['grid'], PAST, FUTURE, 1), 'route_success', 'Human @cayerbe delegates to grid@rome-zone-1. Time window active, Rome cell in scope, facet matches, depth 0 <= max 1.', true, undefined, 'easy', ['valid', 'rome', 'grid', 'depth-0']));
    records.push(delegScenario('Valid delegation — finance task in Zurich, FINMA jurisdiction', ZURICH_CELL, 'finance', 'certified', cert('@cayerbe', 'finance@swiss', ZURICH_SCOPE, ['finance'], PAST, FUTURE, 2), 'route_success', 'FINMA jurisdiction. Cert depth 2 allows sub-delegation. All checks pass.', true, undefined, 'easy', ['valid', 'zurich', 'finance', 'finma', 'certified']));
    records.push(delegScenario('Valid multi-facet delegation — grid + compliance in Rome', ROME_CELL, 'compliance', 'trusted', cert('@cayerbe', 'compliance@rome', ROME_SCOPE, ['grid', 'compliance', 'environment'], PAST, FUTURE, 1), 'route_success', 'Cert grants multiple facets. Task facet=compliance is included.', true, undefined, 'easy', ['valid', 'multi-facet', 'rome', 'compliance']));
    // ── Expired / not-yet-valid ────────────────────────────────────────────────
    records.push(delegScenario('Expired cert — valid_until 7 days ago', ROME_CELL, 'grid', 'trusted', cert('@cayerbe', 'grid@rome-zone-1', ROME_SCOPE, ['grid'], WAY_PAST, PAST, 1, 'expired'), 'reject_delegation', 'Cert valid_until is 7 days ago. Router rejects at Gate 3 with cert_expired.', false, 'cert_expired', 'easy', ['expired', 'time-window', 'reject']));
    records.push(delegScenario('Not-yet-valid cert — valid_from 7 days in the future', ROME_CELL, 'grid', 'trusted', cert('@cayerbe', 'grid@rome-zone-1', ROME_SCOPE, ['grid'], FUTURE, new Date(FUTURE.getTime() + 14 * 24 * 60 * 60 * 1000), 1, 'not_yet_valid'), 'reject_delegation', 'Cert valid_from is 7 days in the future. Not yet active. Prevents pre-signed cert abuse.', false, 'cert_not_yet_valid', 'medium', ['not-yet-valid', 'time-window', 'reject', 'pre-signed']));
    // ── Wrong territory ────────────────────────────────────────────────────────
    records.push(delegScenario('Task in Rome but cert only covers Milan territory', ROME_CELL, 'grid', 'trusted', cert('@cayerbe', 'grid@rome-zone-1', MILAN_SCOPE, ['grid'], PAST, FUTURE, 1, 'wrong_territory'), 'reject_delegation', 'Cert scope_cells covers Milan. Task originates in Rome. Rome H3 cell not in scope_cells.', false, 'scope_cell_violation', 'easy', ['wrong-territory', 'scope-violation', 'rome-vs-milan', 'reject']));
    records.push(delegScenario('Cross-border scope violation — cert covers IT only, task in CH', ZURICH_CELL, 'finance', 'trusted', cert('@cayerbe', 'finance@swiss', MILAN_SCOPE, ['finance'], PAST, FUTURE, 1, 'wrong_territory'), 'reject_delegation', 'Human authorized agent for Milan (IT) but task originates in Zurich (CH). FINMA requires explicit Swiss authorization.', false, 'scope_cell_violation', 'medium', ['cross-border', 'italy-to-switzerland', 'finma', 'reject']));
    // ── Wrong facet ────────────────────────────────────────────────────────────
    records.push(delegScenario('Task facet=health but cert only grants grid + finance', ROME_CELL, 'health', 'trusted', cert('@cayerbe', 'health@rome', ROME_SCOPE, ['grid', 'finance'], PAST, FUTURE, 1, 'wrong_facet'), 'reject_delegation', 'Health facet not in scope_facets. Health is sensitive data — must be explicitly authorized.', false, 'scope_facet_violation', 'easy', ['wrong-facet', 'health', 'scope-violation', 'reject']));
    records.push(delegScenario('Legal task without explicit legal facet authorization', ROME_CELL, 'legal', 'trusted', cert('@cayerbe', 'legal@rome', ROME_SCOPE, ['grid', 'compliance', 'environment', 'finance'], PAST, FUTURE, 1, 'wrong_facet'), 'reject_delegation', 'All facets granted EXCEPT legal. Legal tasks carry high liability — must be explicitly granted.', false, 'scope_facet_violation', 'medium', ['wrong-facet', 'legal', 'explicit-authorization', 'reject']));
    // ── Depth exceeded ─────────────────────────────────────────────────────────
    records.push(delegScenario('Sub-delegation depth exceeded — cert allows depth=0', ROME_CELL, 'grid', 'trusted', cert('@cayerbe', 'grid@rome-zone-1', ROME_SCOPE, ['grid'], PAST, FUTURE, 0, 'depth_exceeded'), 'reject_delegation', 'max_subdelegation_depth=0 — agent cannot further delegate. Sub-delegation rejected.', false, 'max_depth_exceeded', 'medium', ['depth-exceeded', 'sub-delegation', 'reject']));
    records.push(delegScenario('Deep sub-delegation chain — depth=3 allowed, task arrives at depth=4', BERLIN_CELL, 'compliance', 'certified', cert('@cayerbe', 'compliance@berlin', ROME_SCOPE, ['compliance'], PAST, FUTURE, 3, 'depth_exceeded'), 'reject_delegation', 'Chain: human→A→B→C→D = depth 4. Max is 3. Prevents unbounded delegation chains.', false, 'max_depth_exceeded', 'hard', ['depth-exceeded', 'deep-chain', 'reject', 'accountability']));
    // ── Adversarial ────────────────────────────────────────────────────────────
    records.push(delegScenario('ADVERSARIAL: Cert covers superset scope — task in exact boundary cell', ROME_CELL, 'grid', 'trusted', cert('@cayerbe', 'grid@rome-zone-1', [...ROME_SCOPE, MILAN_CELL], ['grid'], PAST, FUTURE, 1), 'route_success', 'Cert includes Rome + one Milan cell. Task in Rome. Rome cell IS in scope. Valid superset.', true, undefined, 'hard', ['superset-scope', 'boundary-cell', 'valid', 'adversarial']));
    records.push(delegScenario('ADVERSARIAL: Cert expired by exactly 1 millisecond', ROME_CELL, 'grid', 'trusted', cert('@cayerbe', 'grid@rome-zone-1', ROME_SCOPE, ['grid', 'finance', 'health', 'legal', 'compliance'], PAST, new Date(NOW.getTime() - 1), 5, 'expired'), 'reject_delegation', 'Cert expired 1ms ago. No grace periods. Expiry enforced to the millisecond.', false, 'cert_expired', 'adversarial', ['expired', '1ms', 'no-grace-period', 'adversarial']));
    records.push(delegScenario('ADVERSARIAL: Agent handle in cert does not match selected agent', ROME_CELL, 'grid', 'trusted', cert('@cayerbe', 'grid@milan-impersonator', ROME_SCOPE, ['grid'], PAST, FUTURE, 1), 'reject_delegation', 'Cert authorizes grid@milan-impersonator but task dispatched to grid@rome-zone-1. Handle mismatch — cert is for a different agent.', false, 'agent_handle_mismatch', 'adversarial', ['impersonation', 'handle-mismatch', 'adversarial', 'identity-validation']));
    records.push(delegScenario('ADVERSARIAL: Recycled cert — issued 14 days ago, still technically valid', ROME_CELL, 'finance', 'trusted', cert('@cayerbe', 'finance@milan', ROME_SCOPE, ['finance'], new Date(NOW.getTime() - 14 * 24 * 60 * 60 * 1000), FUTURE, 1), 'route_success', 'Cert valid_until is still future. Technically valid. Phase 0 has no revocation. Future: epoch-based invalidation.', true, undefined, 'adversarial', ['recycled-cert', 'valid-technically', 'future-improvement', 'revocation']));
    return records;
}
//# sourceMappingURL=delegation_chain.js.map