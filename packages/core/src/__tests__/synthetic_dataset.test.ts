// =============================================================================
// GEIANT — SYNTHETIC DATASET TEST SUITE
// Validates structure, completeness, and correctness of generated records.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { generateFullDataset, buildManifest } from '../synthetic/export/exporter';
import { DatasetRecord, DatasetManifest } from '../synthetic/types';

let records: DatasetRecord[];
let manifest: DatasetManifest;

beforeAll(() => {
  records = generateFullDataset();
  manifest = buildManifest(records);
});

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

describe('DatasetManifest', () => {
  it('has correct total record count', () => {
    expect(manifest.total_records).toBe(records.length);
  });

  it('family counts match actual records', () => {
    for (const family of manifest.families) {
      const actual = records.filter(r => r.family === family).length;
      expect(manifest.records_by_family[family]).toBe(actual);
    }
  });

  it('all three families are present', () => {
    expect(manifest.families).toContain('jurisdictional_routing');
    expect(manifest.families).toContain('geometry_mutation');
    expect(manifest.families).toContain('delegation_chain');
  });

  it('has at least 10 records per family', () => {
    for (const family of manifest.families) {
      expect(manifest.records_by_family[family]).toBeGreaterThanOrEqual(10);
    }
  });

  it('includes all four difficulty levels', () => {
    expect(manifest.records_by_difficulty.easy).toBeGreaterThan(0);
    expect(manifest.records_by_difficulty.medium).toBeGreaterThan(0);
    expect(manifest.records_by_difficulty.hard).toBeGreaterThan(0);
    expect(manifest.records_by_difficulty.adversarial).toBeGreaterThan(0);
  });

  it('has citation and HuggingFace repo', () => {
    expect(manifest.huggingface_repo).toContain('GNS-Foundation');
    expect(manifest.citation).toContain('Ayerbe');
  });
});

// ---------------------------------------------------------------------------
// Record structure
// ---------------------------------------------------------------------------

describe('Record structure', () => {
  it('every record has required top-level fields', () => {
    for (const r of records) {
      expect(r.id).toBeTruthy();
      expect(r.family).toBeTruthy();
      expect(r.description).toBeTruthy();
      expect(r.input).toBeDefined();
      expect(r.expected_outcome).toBeTruthy();
      expect(r.ground_truth).toBeDefined();
      expect(r.difficulty).toBeTruthy();
      expect(r.tags).toBeDefined();
      expect(Array.isArray(r.tags)).toBe(true);
      expect(r.generated_at).toBeTruthy();
      expect(r.geiant_version).toBe('0.1.0');
    }
  });

  it('all UUIDs are unique', () => {
    const ids = records.map(r => r.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('all records have a non-empty explanation in ground_truth', () => {
    for (const r of records) {
      expect(r.ground_truth.explanation).toBeTruthy();
      expect(r.ground_truth.explanation.length).toBeGreaterThan(20);
    }
  });

  it('all records have at least 1 tag', () => {
    for (const r of records) {
      expect(r.tags.length).toBeGreaterThan(0);
    }
  });

  it('valid difficulty values only', () => {
    const valid = new Set(['easy', 'medium', 'hard', 'adversarial']);
    for (const r of records) {
      expect(valid.has(r.difficulty)).toBe(true);
    }
  });

  it('all records are JSON-serializable', () => {
    for (const r of records) {
      expect(() => JSON.stringify(r)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Jurisdictional routing records
// ---------------------------------------------------------------------------

describe('JurisdictionalRouting records', () => {
  let routing: DatasetRecord[];
  beforeAll(() => { routing = records.filter(r => r.family === 'jurisdictional_routing'); });

  it('has at least 10 routing scenarios', () => {
    expect(routing.length).toBeGreaterThanOrEqual(10);
  });

  it('every routing record has origin_cell, facet, min_tier, available_agents', () => {
    for (const r of routing) {
      const input = r.input as any;
      expect(input.origin_cell).toBeTruthy();
      expect(input.facet).toBeTruthy();
      expect(input.min_tier).toBeTruthy();
      expect(Array.isArray(input.available_agents)).toBe(true);
    }
  });

  it('origin_cell looks like a valid H3 cell', () => {
    for (const r of routing) {
      const input = r.input as any;
      expect(input.origin_cell).toMatch(/^[0-9a-f]+$/);
      expect(input.origin_cell.length).toBeGreaterThanOrEqual(10);
    }
  });

  it('route_success records have expected_ant_handle in ground_truth', () => {
    const successes = routing.filter(r => r.expected_outcome === 'route_success');
    expect(successes.length).toBeGreaterThan(0);
    for (const r of successes) {
      expect(r.ground_truth.expected_ant_handle).toBeTruthy();
    }
  });

  it('has reject_no_ant, reject_no_jurisdiction, and adversarial scenarios', () => {
    expect(routing.filter(r => r.expected_outcome === 'reject_no_ant').length).toBeGreaterThanOrEqual(1);
    expect(routing.filter(r => r.expected_outcome === 'reject_no_jurisdiction').length).toBeGreaterThanOrEqual(1);
    expect(routing.filter(r => r.difficulty === 'adversarial').length).toBeGreaterThanOrEqual(1);
  });

  it('all expected_countries are valid ISO codes', () => {
    const known = new Set(['IT', 'CH', 'DE', 'FR', 'GB', 'US', 'BR', 'SG', 'XX']);
    for (const r of routing) {
      if (r.ground_truth.expected_country) {
        expect(known.has(r.ground_truth.expected_country)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Geometry mutation records
// ---------------------------------------------------------------------------

describe('GeometryMutation records', () => {
  let geometry: DatasetRecord[];
  beforeAll(() => { geometry = records.filter(r => r.family === 'geometry_mutation'); });

  it('has at least 10 geometry scenarios', () => {
    expect(geometry.length).toBeGreaterThanOrEqual(10);
  });

  it('every geometry record has steps array in input', () => {
    for (const r of geometry) {
      const input = r.input as any;
      expect(Array.isArray(input.steps)).toBe(true);
      expect(input.steps.length).toBeGreaterThan(0);
    }
  });

  it('reject_geometry records have error_injected_at_step', () => {
    const rejections = geometry.filter(r => r.expected_outcome === 'reject_geometry');
    expect(rejections.length).toBeGreaterThan(0);
    for (const r of rejections) {
      const input = r.input as any;
      expect(input.error_injected_at_step).toBeDefined();
      expect(typeof input.error_injected_at_step).toBe('number');
    }
  });

  it('clean workflow records have undefined error_injected_at_step', () => {
    for (const r of geometry.filter(r => r.expected_outcome === 'route_success')) {
      expect((r.input as any).error_injected_at_step).toBeUndefined();
    }
  });

  it('error_injected_at_step points to an invalid step', () => {
    for (const r of geometry) {
      const input = r.input as any;
      if (input.error_injected_at_step !== undefined) {
        const errorStep = input.steps[input.error_injected_at_step];
        expect(errorStep).toBeDefined();
        expect(errorStep.is_valid).toBe(false);
      }
    }
  });

  it('has boundary_crossing, self-intersection, unclosed-ring, and hallucination scenarios', () => {
    expect(geometry.filter(r => r.expected_outcome === 'flag_boundary_crossing').length).toBeGreaterThanOrEqual(1);
    expect(geometry.filter(r => r.tags.includes('self-intersection')).length).toBeGreaterThanOrEqual(1);
    expect(geometry.filter(r => r.tags.includes('unclosed-ring')).length).toBeGreaterThanOrEqual(1);
    expect(geometry.filter(r => r.tags.includes('hallucination')).length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Delegation chain records
// ---------------------------------------------------------------------------

describe('DelegationChain records', () => {
  let delegation: DatasetRecord[];
  beforeAll(() => { delegation = records.filter(r => r.family === 'delegation_chain'); });

  it('has at least 10 delegation scenarios', () => {
    expect(delegation.length).toBeGreaterThanOrEqual(10);
  });

  it('every delegation record has a well-formed cert', () => {
    for (const r of delegation) {
      const cert = (r.input as any).cert;
      expect(cert).toBeDefined();
      expect(cert.human_handle).toBeTruthy();
      expect(cert.agent_handle).toBeTruthy();
      expect(Array.isArray(cert.scope_cells)).toBe(true);
      expect(cert.scope_cells.length).toBeGreaterThan(0);
      expect(Array.isArray(cert.scope_facets)).toBe(true);
      expect(cert.valid_from).toBeTruthy();
      expect(cert.valid_until).toBeTruthy();
    }
  });

  it('reject_delegation records have rejection reason in ground_truth', () => {
    const rejections = delegation.filter(r => r.expected_outcome === 'reject_delegation');
    expect(rejections.length).toBeGreaterThan(0);
    for (const r of rejections) {
      expect(r.ground_truth.delegation_rejection).toBeTruthy();
    }
  });

  it('covers all major flaw types', () => {
    const flaws = new Set(delegation.map(r => (r.input as any).cert.injected_flaw));
    expect(flaws.has('expired')).toBe(true);
    expect(flaws.has('not_yet_valid')).toBe(true);
    expect(flaws.has('wrong_territory')).toBe(true);
    expect(flaws.has('wrong_facet')).toBe(true);
    expect(flaws.has('depth_exceeded')).toBe(true);
    expect(flaws.has('none')).toBe(true);
  });

  it('has at least one adversarial delegation scenario', () => {
    expect(delegation.filter(r => r.difficulty === 'adversarial').length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Cross-family
// ---------------------------------------------------------------------------

describe('Cross-family stats', () => {
  it('adversarial scenarios exist across all families', () => {
    for (const family of ['jurisdictional_routing', 'geometry_mutation', 'delegation_chain'] as const) {
      expect(records.filter(r => r.family === family && r.difficulty === 'adversarial').length).toBeGreaterThan(0);
    }
  });

  it('total dataset is HuggingFace-ready (>= 30 records)', () => {
    expect(records.length).toBeGreaterThanOrEqual(30);
  });
});
