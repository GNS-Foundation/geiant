"use strict";
// =============================================================================
// GEIANT — SYNTHETIC DATASET TEST SUITE
// Validates structure, completeness, and correctness of generated records.
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const exporter_1 = require("../synthetic/export/exporter");
let records;
let manifest;
(0, vitest_1.beforeAll)(() => {
    records = (0, exporter_1.generateFullDataset)();
    manifest = (0, exporter_1.buildManifest)(records);
});
// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('DatasetManifest', () => {
    (0, vitest_1.it)('has correct total record count', () => {
        (0, vitest_1.expect)(manifest.total_records).toBe(records.length);
    });
    (0, vitest_1.it)('family counts match actual records', () => {
        for (const family of manifest.families) {
            const actual = records.filter(r => r.family === family).length;
            (0, vitest_1.expect)(manifest.records_by_family[family]).toBe(actual);
        }
    });
    (0, vitest_1.it)('all three families are present', () => {
        (0, vitest_1.expect)(manifest.families).toContain('jurisdictional_routing');
        (0, vitest_1.expect)(manifest.families).toContain('geometry_mutation');
        (0, vitest_1.expect)(manifest.families).toContain('delegation_chain');
    });
    (0, vitest_1.it)('has at least 10 records per family', () => {
        for (const family of manifest.families) {
            (0, vitest_1.expect)(manifest.records_by_family[family]).toBeGreaterThanOrEqual(10);
        }
    });
    (0, vitest_1.it)('includes all four difficulty levels', () => {
        (0, vitest_1.expect)(manifest.records_by_difficulty.easy).toBeGreaterThan(0);
        (0, vitest_1.expect)(manifest.records_by_difficulty.medium).toBeGreaterThan(0);
        (0, vitest_1.expect)(manifest.records_by_difficulty.hard).toBeGreaterThan(0);
        (0, vitest_1.expect)(manifest.records_by_difficulty.adversarial).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('has citation and HuggingFace repo', () => {
        (0, vitest_1.expect)(manifest.huggingface_repo).toContain('GNS-Foundation');
        (0, vitest_1.expect)(manifest.citation).toContain('Ayerbe');
    });
});
// ---------------------------------------------------------------------------
// Record structure
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('Record structure', () => {
    (0, vitest_1.it)('every record has required top-level fields', () => {
        for (const r of records) {
            (0, vitest_1.expect)(r.id).toBeTruthy();
            (0, vitest_1.expect)(r.family).toBeTruthy();
            (0, vitest_1.expect)(r.description).toBeTruthy();
            (0, vitest_1.expect)(r.input).toBeDefined();
            (0, vitest_1.expect)(r.expected_outcome).toBeTruthy();
            (0, vitest_1.expect)(r.ground_truth).toBeDefined();
            (0, vitest_1.expect)(r.difficulty).toBeTruthy();
            (0, vitest_1.expect)(r.tags).toBeDefined();
            (0, vitest_1.expect)(Array.isArray(r.tags)).toBe(true);
            (0, vitest_1.expect)(r.generated_at).toBeTruthy();
            (0, vitest_1.expect)(r.geiant_version).toBe('0.1.0');
        }
    });
    (0, vitest_1.it)('all UUIDs are unique', () => {
        const ids = records.map(r => r.id);
        const unique = new Set(ids);
        (0, vitest_1.expect)(unique.size).toBe(ids.length);
    });
    (0, vitest_1.it)('all records have a non-empty explanation in ground_truth', () => {
        for (const r of records) {
            (0, vitest_1.expect)(r.ground_truth.explanation).toBeTruthy();
            (0, vitest_1.expect)(r.ground_truth.explanation.length).toBeGreaterThan(20);
        }
    });
    (0, vitest_1.it)('all records have at least 1 tag', () => {
        for (const r of records) {
            (0, vitest_1.expect)(r.tags.length).toBeGreaterThan(0);
        }
    });
    (0, vitest_1.it)('valid difficulty values only', () => {
        const valid = new Set(['easy', 'medium', 'hard', 'adversarial']);
        for (const r of records) {
            (0, vitest_1.expect)(valid.has(r.difficulty)).toBe(true);
        }
    });
    (0, vitest_1.it)('all records are JSON-serializable', () => {
        for (const r of records) {
            (0, vitest_1.expect)(() => JSON.stringify(r)).not.toThrow();
        }
    });
});
// ---------------------------------------------------------------------------
// Jurisdictional routing records
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('JurisdictionalRouting records', () => {
    let routing;
    (0, vitest_1.beforeAll)(() => { routing = records.filter(r => r.family === 'jurisdictional_routing'); });
    (0, vitest_1.it)('has at least 10 routing scenarios', () => {
        (0, vitest_1.expect)(routing.length).toBeGreaterThanOrEqual(10);
    });
    (0, vitest_1.it)('every routing record has origin_cell, facet, min_tier, available_agents', () => {
        for (const r of routing) {
            const input = r.input;
            (0, vitest_1.expect)(input.origin_cell).toBeTruthy();
            (0, vitest_1.expect)(input.facet).toBeTruthy();
            (0, vitest_1.expect)(input.min_tier).toBeTruthy();
            (0, vitest_1.expect)(Array.isArray(input.available_agents)).toBe(true);
        }
    });
    (0, vitest_1.it)('origin_cell looks like a valid H3 cell', () => {
        for (const r of routing) {
            const input = r.input;
            (0, vitest_1.expect)(input.origin_cell).toMatch(/^[0-9a-f]+$/);
            (0, vitest_1.expect)(input.origin_cell.length).toBeGreaterThanOrEqual(10);
        }
    });
    (0, vitest_1.it)('route_success records have expected_ant_handle in ground_truth', () => {
        const successes = routing.filter(r => r.expected_outcome === 'route_success');
        (0, vitest_1.expect)(successes.length).toBeGreaterThan(0);
        for (const r of successes) {
            (0, vitest_1.expect)(r.ground_truth.expected_ant_handle).toBeTruthy();
        }
    });
    (0, vitest_1.it)('has reject_no_ant, reject_no_jurisdiction, and adversarial scenarios', () => {
        (0, vitest_1.expect)(routing.filter(r => r.expected_outcome === 'reject_no_ant').length).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(routing.filter(r => r.expected_outcome === 'reject_no_jurisdiction').length).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(routing.filter(r => r.difficulty === 'adversarial').length).toBeGreaterThanOrEqual(1);
    });
    (0, vitest_1.it)('all expected_countries are valid ISO codes', () => {
        const known = new Set(['IT', 'CH', 'DE', 'FR', 'GB', 'US', 'BR', 'SG', 'XX']);
        for (const r of routing) {
            if (r.ground_truth.expected_country) {
                (0, vitest_1.expect)(known.has(r.ground_truth.expected_country)).toBe(true);
            }
        }
    });
});
// ---------------------------------------------------------------------------
// Geometry mutation records
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('GeometryMutation records', () => {
    let geometry;
    (0, vitest_1.beforeAll)(() => { geometry = records.filter(r => r.family === 'geometry_mutation'); });
    (0, vitest_1.it)('has at least 10 geometry scenarios', () => {
        (0, vitest_1.expect)(geometry.length).toBeGreaterThanOrEqual(10);
    });
    (0, vitest_1.it)('every geometry record has steps array in input', () => {
        for (const r of geometry) {
            const input = r.input;
            (0, vitest_1.expect)(Array.isArray(input.steps)).toBe(true);
            (0, vitest_1.expect)(input.steps.length).toBeGreaterThan(0);
        }
    });
    (0, vitest_1.it)('reject_geometry records have error_injected_at_step', () => {
        const rejections = geometry.filter(r => r.expected_outcome === 'reject_geometry');
        (0, vitest_1.expect)(rejections.length).toBeGreaterThan(0);
        for (const r of rejections) {
            const input = r.input;
            (0, vitest_1.expect)(input.error_injected_at_step).toBeDefined();
            (0, vitest_1.expect)(typeof input.error_injected_at_step).toBe('number');
        }
    });
    (0, vitest_1.it)('clean workflow records have undefined error_injected_at_step', () => {
        for (const r of geometry.filter(r => r.expected_outcome === 'route_success')) {
            (0, vitest_1.expect)(r.input.error_injected_at_step).toBeUndefined();
        }
    });
    (0, vitest_1.it)('error_injected_at_step points to an invalid step', () => {
        for (const r of geometry) {
            const input = r.input;
            if (input.error_injected_at_step !== undefined) {
                const errorStep = input.steps[input.error_injected_at_step];
                (0, vitest_1.expect)(errorStep).toBeDefined();
                (0, vitest_1.expect)(errorStep.is_valid).toBe(false);
            }
        }
    });
    (0, vitest_1.it)('has boundary_crossing, self-intersection, unclosed-ring, and hallucination scenarios', () => {
        (0, vitest_1.expect)(geometry.filter(r => r.expected_outcome === 'flag_boundary_crossing').length).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(geometry.filter(r => r.tags.includes('self-intersection')).length).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(geometry.filter(r => r.tags.includes('unclosed-ring')).length).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(geometry.filter(r => r.tags.includes('hallucination')).length).toBeGreaterThanOrEqual(1);
    });
});
// ---------------------------------------------------------------------------
// Delegation chain records
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('DelegationChain records', () => {
    let delegation;
    (0, vitest_1.beforeAll)(() => { delegation = records.filter(r => r.family === 'delegation_chain'); });
    (0, vitest_1.it)('has at least 10 delegation scenarios', () => {
        (0, vitest_1.expect)(delegation.length).toBeGreaterThanOrEqual(10);
    });
    (0, vitest_1.it)('every delegation record has a well-formed cert', () => {
        for (const r of delegation) {
            const cert = r.input.cert;
            (0, vitest_1.expect)(cert).toBeDefined();
            (0, vitest_1.expect)(cert.human_handle).toBeTruthy();
            (0, vitest_1.expect)(cert.agent_handle).toBeTruthy();
            (0, vitest_1.expect)(Array.isArray(cert.scope_cells)).toBe(true);
            (0, vitest_1.expect)(cert.scope_cells.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(Array.isArray(cert.scope_facets)).toBe(true);
            (0, vitest_1.expect)(cert.valid_from).toBeTruthy();
            (0, vitest_1.expect)(cert.valid_until).toBeTruthy();
        }
    });
    (0, vitest_1.it)('reject_delegation records have rejection reason in ground_truth', () => {
        const rejections = delegation.filter(r => r.expected_outcome === 'reject_delegation');
        (0, vitest_1.expect)(rejections.length).toBeGreaterThan(0);
        for (const r of rejections) {
            (0, vitest_1.expect)(r.ground_truth.delegation_rejection).toBeTruthy();
        }
    });
    (0, vitest_1.it)('covers all major flaw types', () => {
        const flaws = new Set(delegation.map(r => r.input.cert.injected_flaw));
        (0, vitest_1.expect)(flaws.has('expired')).toBe(true);
        (0, vitest_1.expect)(flaws.has('not_yet_valid')).toBe(true);
        (0, vitest_1.expect)(flaws.has('wrong_territory')).toBe(true);
        (0, vitest_1.expect)(flaws.has('wrong_facet')).toBe(true);
        (0, vitest_1.expect)(flaws.has('depth_exceeded')).toBe(true);
        (0, vitest_1.expect)(flaws.has('none')).toBe(true);
    });
    (0, vitest_1.it)('has at least one adversarial delegation scenario', () => {
        (0, vitest_1.expect)(delegation.filter(r => r.difficulty === 'adversarial').length).toBeGreaterThanOrEqual(1);
    });
});
// ---------------------------------------------------------------------------
// Cross-family
// ---------------------------------------------------------------------------
(0, vitest_1.describe)('Cross-family stats', () => {
    (0, vitest_1.it)('adversarial scenarios exist across all families', () => {
        for (const family of ['jurisdictional_routing', 'geometry_mutation', 'delegation_chain']) {
            (0, vitest_1.expect)(records.filter(r => r.family === family && r.difficulty === 'adversarial').length).toBeGreaterThan(0);
        }
    });
    (0, vitest_1.it)('total dataset is HuggingFace-ready (>= 30 records)', () => {
        (0, vitest_1.expect)(records.length).toBeGreaterThanOrEqual(30);
    });
});
//# sourceMappingURL=synthetic_dataset.test.js.map