// =============================================================================
// GEIANT — GEOMETRY MUTATION GENERATOR
// Multi-step geometry workflows with intentional error injection.
// =============================================================================
//
// Benchmarks whether an AI orchestrator detects geometry corruption
// in a multi-step workflow — the exact failure mode that silently
// breaks every other orchestrator.
//
// Scenario structure:
//   Each scenario is a sequence of 3-10 mutation steps.
//   One step (random or fixed) contains an injected error.
//   Ground truth: the step number where GEIANT should reject.
//   Hard scenarios: error is subtle (coord transposition, near-degenerate ring)
//   Adversarial: valid-looking geometry that is mathematically self-intersecting
// =============================================================================

import { v4 as uuid } from 'uuid';
import {
  DatasetRecord,
  GeometryMutationInput,
  MutationStep,
  ExpectedOutcome,
  Difficulty,
} from '../types.js';

// ---------------------------------------------------------------------------
// Geometry fixtures — valid base polygons
// ---------------------------------------------------------------------------

const ROME_CENTRO = {
  type: 'Polygon',
  coordinates: [[[12.46,41.89],[12.52,41.89],[12.52,41.92],[12.46,41.92],[12.46,41.89]]],
};

const TERNA_ZONE = {
  type: 'Polygon',
  coordinates: [[[12.45,41.93],[12.55,41.93],[12.55,41.98],[12.45,41.98],[12.45,41.93]]],
};

const MILAN_ZONE = {
  type: 'Polygon',
  coordinates: [[[9.15,45.44],[9.25,45.44],[9.25,45.50],[9.15,45.50],[9.15,45.44]]],
};

const ZURICH_ZONE = {
  type: 'Polygon',
  coordinates: [[[8.52,47.35],[8.58,47.35],[8.58,47.40],[8.52,47.40],[8.52,47.35]]],
};

// ---------------------------------------------------------------------------
// Invalid geometry fixtures
// ---------------------------------------------------------------------------

const SELF_INTERSECTING_BOWTIE = {
  type: 'Polygon',
  coordinates: [[[12.46,41.89],[12.52,41.92],[12.52,41.89],[12.46,41.92],[12.46,41.89]]],
};

const UNCLOSED_RING = {
  type: 'Polygon',
  coordinates: [[[12.46,41.89],[12.52,41.89],[12.52,41.92],[12.46,41.92]]],
};

const TRANSPOSED_COORDS = {
  type: 'Point',
  coordinates: [41.902, 12.496], // lat/lng swapped — 41.9 > 90 is invalid as lng... wait, 41.9 IS valid as lng
  // Use obviously wrong: lng=200 (hallucinated)
};

const HALLUCINATED_COORDS = {
  type: 'Point',
  coordinates: [200.0, 41.902], // longitude 200 — impossible
};

const TRANSPOSED_POLYGON = {
  type: 'Polygon',
  // Swapped to lat,lng order instead of lng,lat
  coordinates: [[[41.89,12.46],[41.89,12.52],[41.92,12.52],[41.92,12.46],[41.89,12.46]]],
  // All coords have first value ~41 (looks like lat) — heuristic should detect
};

const NEAR_DEGENERATE = {
  type: 'Polygon',
  // Extremely thin polygon — nearly degenerate but technically valid
  coordinates: [[[12.46,41.89],[12.4600001,41.89],[12.4600001,41.92],[12.46,41.92],[12.46,41.89]]],
};

const TOO_FEW_POINTS = {
  type: 'Polygon',
  coordinates: [[[12.46,41.89],[12.52,41.89],[12.46,41.89]]], // only 3 points
};

// ---------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------

function validStep(step: number, op: string, geometry: object, desc: string): MutationStep {
  return { step, operation: op, geometry, description: desc, is_valid: true };
}

function invalidStep(step: number, op: string, geometry: object, desc: string, errorType: string): MutationStep {
  return { step, operation: op, geometry, description: desc, is_valid: false, error_type: errorType };
}

// ---------------------------------------------------------------------------
// Scenario builder
// ---------------------------------------------------------------------------

function geomScenario(
  description: string,
  featureId: string,
  steps: MutationStep[],
  errorAt: number | undefined,
  expectedOutcome: ExpectedOutcome,
  explanation: string,
  difficulty: Difficulty,
  tags: string[]
): DatasetRecord<GeometryMutationInput> {
  return {
    id: uuid(),
    family: 'geometry_mutation',
    description,
    input: {
      feature_id: featureId,
      steps,
      error_injected_at_step: errorAt,
    },
    expected_outcome: expectedOutcome,
    ground_truth: {
      geometry_valid: errorAt === undefined,
      geometry_error_type: errorAt !== undefined ? steps[errorAt]?.error_type : undefined,
      expected_chain_length: errorAt !== undefined ? errorAt : steps.length,
      explanation,
    },
    difficulty,
    tags,
    generated_at: new Date().toISOString(),
    geiant_version: '0.1.0',
  };
}

// ---------------------------------------------------------------------------
// Generate all geometry mutation scenarios
// ---------------------------------------------------------------------------

export function generateGeometryMutationScenarios(): DatasetRecord<GeometryMutationInput>[] {
  const records: DatasetRecord<GeometryMutationInput>[] = [];

  // ── Clean workflows (no errors) ───────────────────────────────────────────

  records.push(geomScenario(
    'Clean 3-step buffer workflow — Rome zone expansion',
    'rome-clean-buffer',
    [
      validStep(0, 'create',    ROME_CENTRO,  'Create initial Rome centro zone'),
      validStep(1, 'buffer',    { type: 'Polygon', coordinates: [[[12.44,41.87],[12.54,41.87],[12.54,41.94],[12.44,41.94],[12.44,41.87]]] }, 'Buffer 200m'),
      validStep(2, 'buffer',    { type: 'Polygon', coordinates: [[[12.42,41.85],[12.56,41.85],[12.56,41.96],[12.42,41.96],[12.42,41.85]]] }, 'Buffer 500m'),
    ],
    undefined,
    'route_success',
    'All three steps contain valid closed polygons. Chain should reach length 3 with no rejection.',
    'easy',
    ['clean-workflow', 'buffer', 'rome', 'no-error']
  ));

  records.push(geomScenario(
    'Clean 5-step Terna grid zone analysis workflow',
    'terna-clean-5step',
    [
      validStep(0, 'create',    TERNA_ZONE,   'Create Terna distribution zone boundary'),
      validStep(1, 'buffer',    { type: 'Polygon', coordinates: [[[12.43,41.91],[12.57,41.91],[12.57,42.00],[12.43,42.00],[12.43,41.91]]] }, 'Buffer 300m for safety exclusion'),
      validStep(2, 'clip',      { type: 'Polygon', coordinates: [[[12.44,41.92],[12.56,41.92],[12.56,41.99],[12.44,41.99],[12.44,41.92]]] }, 'Clip to municipality boundary'),
      validStep(3, 'simplify',  { type: 'Polygon', coordinates: [[[12.44,41.92],[12.56,41.92],[12.56,41.99],[12.44,41.99],[12.44,41.92]]] }, 'Simplify for rendering'),
      validStep(4, 'transform', { type: 'Polygon', coordinates: [[[12.45,41.93],[12.55,41.93],[12.55,41.98],[12.45,41.98],[12.45,41.93]]] }, 'Final zone geometry'),
    ],
    undefined,
    'route_success',
    'Five clean steps. All geometries valid. Chain length should be 5.',
    'easy',
    ['clean-workflow', 'terna', 'grid', '5-step', 'no-error']
  ));

  // ── Error at step 0 (genesis invalid) ─────────────────────────────────────

  records.push(geomScenario(
    'Self-intersecting bowtie at genesis — rejected immediately',
    'bowtie-at-genesis',
    [
      invalidStep(0, 'create', SELF_INTERSECTING_BOWTIE, 'Create zone (INVALID: self-intersecting bowtie)', 'self_intersection'),
      validStep(1, 'buffer',   { type: 'Polygon', coordinates: [[[12.44,41.87],[12.54,41.87],[12.54,41.94],[12.44,41.94],[12.44,41.87]]] }, 'Buffer (never reached)'),
    ],
    0,
    'reject_geometry',
    'Genesis geometry is a bowtie — edges cross. GEIANT GeometryGuard rejects at step 0 before any node is created.',
    'easy',
    ['self-intersection', 'bowtie', 'genesis-invalid', 'geometry-guard']
  ));

  records.push(geomScenario(
    'Unclosed ring at genesis — missing closing coordinate',
    'unclosed-at-genesis',
    [
      invalidStep(0, 'create', UNCLOSED_RING, 'Create zone (INVALID: ring not closed)', 'unclosed_ring'),
    ],
    0,
    'reject_geometry',
    'Polygon ring has 4 coordinates but last != first. Classic LLM error — model generates [A,B,C,D] instead of [A,B,C,D,A]. Rejected at genesis.',
    'easy',
    ['unclosed-ring', 'llm-error', 'genesis-invalid', 'geometry-guard']
  ));

  // ── Error injected mid-workflow ────────────────────────────────────────────

  records.push(geomScenario(
    'Valid start, self-intersection injected at step 2 of 4',
    'bowtie-midflow',
    [
      validStep(0, 'create',    ROME_CENTRO,   'Create Rome zone'),
      validStep(1, 'buffer',    { type: 'Polygon', coordinates: [[[12.44,41.87],[12.54,41.87],[12.54,41.94],[12.44,41.94],[12.44,41.87]]] }, 'Buffer 200m'),
      invalidStep(2, 'merge',   SELF_INTERSECTING_BOWTIE, 'Merge with adjacent zone (INVALID: agent produced self-intersecting result)', 'self_intersection'),
      validStep(3, 'simplify',  ROME_CENTRO,   'Simplify (never reached)'),
    ],
    2,
    'reject_geometry',
    'Steps 0-1 succeed and create 2 memory nodes. Step 2 produces invalid geometry — GEIANT rejects mutation, preserving the valid chain at length 2. The corruption is caught before it enters the graph.',
    'medium',
    ['self-intersection', 'mid-workflow', 'chain-preserved', 'geometry-guard', 'llm-corruption']
  ));

  records.push(geomScenario(
    'Valid start, unclosed ring injected at step 3 of 5',
    'unclosed-midflow',
    [
      validStep(0, 'create',    TERNA_ZONE,    'Create Terna zone'),
      validStep(1, 'buffer',    { type: 'Polygon', coordinates: [[[12.43,41.91],[12.57,41.91],[12.57,42.00],[12.43,42.00],[12.43,41.91]]] }, 'Buffer'),
      validStep(2, 'clip',      { type: 'Polygon', coordinates: [[[12.44,41.92],[12.56,41.92],[12.56,41.99],[12.44,41.99],[12.44,41.92]]] }, 'Clip'),
      invalidStep(3, 'merge',   UNCLOSED_RING, 'Merge (INVALID: unclosed ring)', 'unclosed_ring'),
      validStep(4, 'simplify',  TERNA_ZONE,    'Simplify (never reached)'),
    ],
    3,
    'reject_geometry',
    'Three valid nodes created before error. Step 3 mutation rejected. Graph preserves 3-node chain. Agent receives structured error with suggestion to close the ring.',
    'medium',
    ['unclosed-ring', 'mid-workflow', '3-node-preserved', 'terna', 'geometry-guard']
  ));

  // ── Coordinate hallucination ───────────────────────────────────────────────

  records.push(geomScenario(
    'LLM hallucinated coordinate (lng=200) at step 1',
    'hallucinated-coord',
    [
      validStep(0, 'create',   ROME_CENTRO,        'Create Rome zone'),
      invalidStep(1, 'buffer', HALLUCINATED_COORDS, 'Buffer result (INVALID: LLM hallucinated lng=200)', 'invalid_coordinate'),
    ],
    1,
    'reject_geometry',
    'Step 1 geometry has longitude=200 which is outside WGS84 bounds (-180 to 180). Classic LLM coordinate hallucination — model invents coordinates that look plausible but are geographically impossible.',
    'easy',
    ['hallucination', 'invalid-coordinate', 'wgs84', 'llm-error', 'geometry-guard']
  ));

  records.push(geomScenario(
    'Coordinate transposition at step 2 — lat/lng swapped',
    'transposed-coords',
    [
      validStep(0, 'create',   ROME_CENTRO,        'Create Rome zone'),
      validStep(1, 'buffer',   { type: 'Polygon', coordinates: [[[12.44,41.87],[12.54,41.87],[12.54,41.94],[12.44,41.94],[12.44,41.87]]] }, 'Buffer'),
      invalidStep(2, 'reproject', TRANSPOSED_POLYGON, 'Reprojection result (INVALID: coordinates appear transposed)', 'coordinate_transposed'),
    ],
    2,
    'reject_geometry',
    'Agent reprojects polygon but swaps lat/lng order. Coords like [41.89, 12.46] instead of [12.46, 41.89]. GEIANT heuristic detects the swap and returns a suggestion with the corrected coordinate order.',
    'medium',
    ['transposition', 'lat-lng-swap', 'reprojection', 'llm-error', 'geometry-guard']
  ));

  // ── Territory boundary crossing ────────────────────────────────────────────

  records.push(geomScenario(
    'Rome zone drifts to Milan over 3 steps — boundary crossing detected',
    'boundary-drift',
    [
      validStep(0, 'create',    ROME_CENTRO,  'Create Rome zone'),
      validStep(1, 'transform', { type: 'Polygon', coordinates: [[[10.5,44.0],[11.0,44.0],[11.0,44.5],[10.5,44.5],[10.5,44.0]]] }, 'Transform toward Bologna'),
      validStep(2, 'transform', MILAN_ZONE,   'Final position in Milan — boundary crossed'),
    ],
    undefined, // all geometries are technically valid
    'flag_boundary_crossing',
    'All three geometries are individually valid. But the centroid moves from Rome (41.9°N, 12.5°E) to Milan (45.5°N, 9.2°E) — ~480km. H3 cell overlap drops to <5%, triggering territory_boundary_crossed breadcrumb at step 2.',
    'medium',
    ['boundary-crossing', 'drift', 'rome-to-milan', 'breadcrumb', 'valid-geometry']
  ));

  // ── Adversarial ────────────────────────────────────────────────────────────

  records.push(geomScenario(
    'ADVERSARIAL: Near-degenerate polygon — valid but suspicious',
    'near-degenerate',
    [
      validStep(0, 'create',   ROME_CENTRO,   'Create Rome zone'),
      validStep(1, 'simplify', NEAR_DEGENERATE, 'Simplify result — near-degenerate but technically valid'),
    ],
    undefined,
    'route_success',
    'Near-degenerate polygon (width ~0.0000001 degrees = ~1cm) is technically valid GeoJSON — passes all validation checks. This is a known limitation of pure geometry validation without semantic context. Future: area threshold check.',
    'adversarial',
    ['near-degenerate', 'adversarial', 'valid-but-suspicious', 'future-improvement']
  ));

  records.push(geomScenario(
    'ADVERSARIAL: 10-step workflow, error at random middle step',
    'ten-step-random-error',
    [
      validStep(0, 'create',    TERNA_ZONE,   'Step 0: Create'),
      validStep(1, 'buffer',    { type: 'Polygon', coordinates: [[[12.43,41.91],[12.57,41.91],[12.57,42.00],[12.43,42.00],[12.43,41.91]]] }, 'Step 1: Buffer'),
      validStep(2, 'clip',      { type: 'Polygon', coordinates: [[[12.44,41.92],[12.56,41.92],[12.56,41.99],[12.44,41.99],[12.44,41.92]]] }, 'Step 2: Clip'),
      validStep(3, 'simplify',  TERNA_ZONE,   'Step 3: Simplify'),
      validStep(4, 'buffer',    { type: 'Polygon', coordinates: [[[12.42,41.90],[12.58,41.90],[12.58,42.01],[12.42,42.01],[12.42,41.90]]] }, 'Step 4: Re-buffer'),
      invalidStep(5, 'merge', SELF_INTERSECTING_BOWTIE, 'Step 5: INJECTED BOWTIE — mid-workflow corruption', 'self_intersection'),
      validStep(6, 'clip',      TERNA_ZONE,   'Step 6: (never reached)'),
      validStep(7, 'simplify',  TERNA_ZONE,   'Step 7: (never reached)'),
      validStep(8, 'transform', TERNA_ZONE,   'Step 8: (never reached)'),
      validStep(9, 'buffer',    TERNA_ZONE,   'Step 9: (never reached)'),
    ],
    5,
    'reject_geometry',
    '10-step workflow. Error injected at step 5. GEIANT should build a 5-node chain (steps 0-4), then reject step 5. The adversarial test: without GEIANT, the corrupted geometry silently enters the workflow and corrupts all downstream steps.',
    'adversarial',
    ['10-step', 'mid-workflow', 'adversarial', 'self-intersection', 'chain-integrity', 'llm-corruption']
  ));

  return records;
}
