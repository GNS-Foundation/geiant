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

export type DatasetFamily =
  | 'jurisdictional_routing'
  | 'geometry_mutation'
  | 'delegation_chain';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'adversarial';

export type ExpectedOutcome =
  | 'route_success'          // task dispatched to correct ant
  | 'reject_no_jurisdiction' // cell resolves to unknown territory
  | 'reject_no_ant'          // no eligible ant for this facet/territory
  | 'reject_tier'            // best ant below required tier
  | 'reject_delegation'      // invalid delegation cert
  | 'reject_geometry'        // invalid geometry caught by guardrail
  | 'flag_boundary_crossing' // geometry crossed territory boundary
  | 'flag_chain_broken'      // memory chain integrity failed
  | 'rollback_triggered';    // invalid state detected, memory rolled back

// ---------------------------------------------------------------------------
// Dataset record — one benchmark scenario
// ---------------------------------------------------------------------------

export interface DatasetRecord<T = unknown> {
  /** Unique record ID */
  id: string;

  /** Which benchmark family this belongs to */
  family: DatasetFamily;

  /** Human-readable description of what this scenario tests */
  description: string;

  /** The input submitted to GEIANT */
  input: T;

  /** What GEIANT should do with this input */
  expected_outcome: ExpectedOutcome;

  /** The authoritative ground truth answer */
  ground_truth: GroundTruth;

  /** How hard is this scenario to get right */
  difficulty: Difficulty;

  /** Tags for filtering — e.g. ["gdpr", "cross-border", "self-intersection"] */
  tags: string[];

  /** Generated timestamp */
  generated_at: string;

  /** GEIANT version that generated this record */
  geiant_version: string;
}

export interface GroundTruth {
  /** For routing: which ant should be selected */
  expected_ant_handle?: string;

  /** For jurisdiction: expected country code */
  expected_country?: string;

  /** For jurisdiction: expected regulatory frameworks */
  expected_frameworks?: string[];

  /** For geometry: is the geometry valid? */
  geometry_valid?: boolean;

  /** For geometry: what error type if invalid */
  geometry_error_type?: string;

  /** For delegation: is the cert valid? */
  delegation_valid?: boolean;

  /** For delegation: rejection reason if invalid */
  delegation_rejection?: string;

  /** For memory: expected chain length after operations */
  expected_chain_length?: number;

  /** For boundary: expected boundary crossing detection */
  boundary_crossed?: boolean;

  /** Explanation of why this is the correct answer */
  explanation: string;
}

// ---------------------------------------------------------------------------
// Jurisdictional Routing input
// ---------------------------------------------------------------------------

export interface JurisdictionalRoutingInput {
  /** H3 cell where the task originates */
  origin_cell: string;

  /** H3 cell's lat/lng centroid (for human readability) */
  origin_latLng: [number, number];

  /** Approximate location name */
  origin_label: string;

  /** Required agent facet */
  facet: string;

  /** Required minimum tier */
  min_tier: string;

  /** Available agents in the simulated registry */
  available_agents: SimulatedAgent[];
}

export interface SimulatedAgent {
  handle: string;
  facet: string;
  tier: string;
  territory_cells: string[];
  compliance_score: number;
}

// ---------------------------------------------------------------------------
// Geometry Mutation input
// ---------------------------------------------------------------------------

export interface GeometryMutationInput {
  /** Feature ID being mutated */
  feature_id: string;

  /** Sequence of mutation steps */
  steps: MutationStep[];

  /** Which step (0-indexed) contains the injected error, if any */
  error_injected_at_step?: number;
}

export interface MutationStep {
  step: number;
  operation: string;
  geometry: object;   // GeoJSON geometry
  description: string;
  is_valid: boolean;
  error_type?: string;
}

// ---------------------------------------------------------------------------
// Delegation Chain input
// ---------------------------------------------------------------------------

export interface DelegationChainInput {
  /** The task being submitted */
  task_origin_cell: string;
  task_facet: string;
  task_min_tier: string;

  /** The delegation cert */
  cert: {
    human_handle: string;
    agent_handle: string;
    scope_cells: string[];
    scope_facets: string[];
    valid_from: string;
    valid_until: string;
    max_subdelegation_depth: number;
    /** What's wrong with this cert, if anything */
    injected_flaw?: DelegationFlaw;
  };
}

export type DelegationFlaw =
  | 'expired'
  | 'not_yet_valid'
  | 'wrong_territory'
  | 'wrong_facet'
  | 'depth_exceeded'
  | 'invalid_signature'
  | 'none';

// ---------------------------------------------------------------------------
// Full dataset manifest
// ---------------------------------------------------------------------------

export interface DatasetManifest {
  name: string;
  version: string;
  description: string;
  families: DatasetFamily[];
  total_records: number;
  records_by_family: Record<DatasetFamily, number>;
  records_by_difficulty: Record<Difficulty, number>;
  records_by_outcome: Partial<Record<ExpectedOutcome, number>>;
  generated_at: string;
  geiant_version: string;
  huggingface_repo: string;
  license: string;
  citation: string;
}
