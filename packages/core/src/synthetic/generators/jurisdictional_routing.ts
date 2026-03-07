// =============================================================================
// GEIANT — JURISDICTIONAL ROUTING GENERATOR
// Generates benchmark scenarios for H3 cell → jurisdiction → agent routing.
// =============================================================================
//
// Scenario categories:
//   1. Straightforward routing     — task in well-covered territory
//   2. Cross-border ambiguity      — cell near country boundary
//   3. No eligible agent           — task in uncovered territory
//   4. Tier enforcement            — agent exists but tier too low
//   5. Multi-framework conflict    — GDPR vs AI Act tier limits
//   6. Ocean/unknown cell          — no jurisdiction resolvable
//   7. High-compliance requirement — certified+ required in strict jurisdiction
// =============================================================================

import { latLngToCell, gridDisk, cellToLatLng } from 'h3-js';
import { v4 as uuid } from 'uuid';
import {
  DatasetRecord,
  JurisdictionalRoutingInput,
  SimulatedAgent,
  ExpectedOutcome,
  GroundTruth,
  Difficulty,
} from '../types.js';

// ---------------------------------------------------------------------------
// Named locations used across scenarios
// ---------------------------------------------------------------------------

const LOCATIONS = {
  // Italy
  rome:          { lat: 41.902, lng: 12.496, label: 'Rome, Italy',              country: 'IT', frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2', 'ITALIAN_CIVIL_CODE'] },
  milan:         { lat: 45.464, lng: 9.190,  label: 'Milan, Italy',             country: 'IT', frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2', 'ITALIAN_CIVIL_CODE'] },
  naples:        { lat: 40.851, lng: 14.268, label: 'Naples, Italy',            country: 'IT', frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2', 'ITALIAN_CIVIL_CODE'] },
  // Switzerland
  zurich:        { lat: 47.376, lng: 8.541,  label: 'Zurich, Switzerland',      country: 'CH', frameworks: ['SWISS_DPA', 'FINMA'] },
  geneva:        { lat: 46.204, lng: 6.143,  label: 'Geneva, Switzerland',      country: 'CH', frameworks: ['SWISS_DPA', 'FINMA'] },
  // Germany
  berlin:        { lat: 52.520, lng: 13.405, label: 'Berlin, Germany',          country: 'DE', frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2'] },
  munich:        { lat: 48.137, lng: 11.576, label: 'Munich, Germany',          country: 'DE', frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2'] },
  // France
  paris:         { lat: 48.856, lng: 2.352,  label: 'Paris, France',            country: 'FR', frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2'] },
  // UK
  london:        { lat: 51.507, lng: -0.128, label: 'London, UK',               country: 'GB', frameworks: ['UK_GDPR'] },
  // US
  new_york:      { lat: 40.712, lng: -74.006,label: 'New York, USA',            country: 'US', frameworks: ['US_EO_14110'] },
  san_francisco: { lat: 37.774, lng: -122.419,label: 'San Francisco, USA',      country: 'US', frameworks: ['US_EO_14110', 'CCPA'] },
  // Brazil
  sao_paulo:     { lat: -23.550, lng: -46.633,label: 'São Paulo, Brazil',       country: 'BR', frameworks: ['LGPD'] },
  // Singapore
  singapore:     { lat: 1.352,  lng: 103.820,label: 'Singapore',                country: 'SG', frameworks: ['PDPA_SG'] },
  // Ocean (no jurisdiction)
  atlantic:      { lat: 30.0,   lng: -40.0,  label: 'Atlantic Ocean',           country: 'XX', frameworks: [] },
};

type LocationKey = keyof typeof LOCATIONS;

// ---------------------------------------------------------------------------
// Agent pool — the simulated registry for benchmark scenarios
// ---------------------------------------------------------------------------

function makeAgent(
  handle: string,
  facet: string,
  tier: string,
  locationKey: LocationKey,
  radiusRings = 2
): SimulatedAgent {
  const loc = LOCATIONS[locationKey];
  const centerCell = latLngToCell(loc.lat, loc.lng, 5);
  return {
    handle,
    facet,
    tier,
    territory_cells: gridDisk(centerCell, radiusRings),
    compliance_score: 85,
  };
}

const AGENT_POOL: SimulatedAgent[] = [
  makeAgent('grid@rome-zone-1',    'grid',        'trusted',    'rome'),
  makeAgent('grid@milan',          'grid',        'observed',   'milan'),
  makeAgent('finance@milan',       'finance',     'trusted',    'milan'),
  makeAgent('finance@swiss',       'finance',     'certified',  'zurich'),
  makeAgent('health@eu-north',     'health',      'certified',  'berlin'),
  makeAgent('compliance@berlin',   'compliance',  'sovereign',  'berlin'),
  makeAgent('environment@eu',      'environment', 'observed',   'paris'),
  makeAgent('legal@london',        'legal',       'trusted',    'london'),
  makeAgent('grid@naples',         'grid',        'provisioned','naples'),
];

// ---------------------------------------------------------------------------
// Scenario generators
// ---------------------------------------------------------------------------

function scenario(
  description: string,
  locationKey: LocationKey,
  facet: string,
  minTier: string,
  agents: SimulatedAgent[],
  expectedOutcome: ExpectedOutcome,
  groundTruth: GroundTruth,
  difficulty: Difficulty,
  tags: string[]
): DatasetRecord<JurisdictionalRoutingInput> {
  const loc = LOCATIONS[locationKey];
  const cell = latLngToCell(loc.lat, loc.lng, 7);

  return {
    id: uuid(),
    family: 'jurisdictional_routing',
    description,
    input: {
      origin_cell: cell,
      origin_latLng: [loc.lat, loc.lng],
      origin_label: loc.label,
      facet,
      min_tier: minTier,
      available_agents: agents,
    },
    expected_outcome: expectedOutcome,
    ground_truth: groundTruth,
    difficulty,
    tags,
    generated_at: new Date().toISOString(),
    geiant_version: '0.1.0',
  };
}

// ---------------------------------------------------------------------------
// Generate all jurisdictional routing scenarios
// ---------------------------------------------------------------------------

export function generateJurisdictionalRoutingScenarios(): DatasetRecord<JurisdictionalRoutingInput>[] {
  const records: DatasetRecord<JurisdictionalRoutingInput>[] = [];

  // ── Category 1: Straightforward routing ──────────────────────────────────

  records.push(scenario(
    'Grid task in Rome — direct match to grid@rome-zone-1',
    'rome', 'grid', 'observed',
    [AGENT_POOL[0], AGENT_POOL[1]], // rome + milan grid
    'route_success',
    {
      expected_ant_handle: 'grid@rome-zone-1',
      expected_country: 'IT',
      expected_frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2', 'ITALIAN_CIVIL_CODE'],
      explanation: 'grid@rome-zone-1 covers Rome at res-5, tier trusted >= observed required. Direct match.',
    },
    'easy',
    ['italy', 'gdpr', 'eu-ai-act', 'grid', 'direct-match']
  ));

  records.push(scenario(
    'Finance task in Zurich — FINMA jurisdiction, certified required',
    'zurich', 'finance', 'certified',
    [AGENT_POOL[2], AGENT_POOL[3]], // milan finance (trusted) + swiss finance (certified)
    'route_success',
    {
      expected_ant_handle: 'finance@swiss',
      expected_country: 'CH',
      expected_frameworks: ['SWISS_DPA', 'FINMA'],
      explanation: 'finance@swiss is certified and covers Zurich. finance@milan is only trusted — below required certified tier.',
    },
    'medium',
    ['switzerland', 'finma', 'finance', 'tier-enforcement', 'swiss-dpa']
  ));

  records.push(scenario(
    'Health task in Berlin — GDPR + EU AI Act, certified agent available',
    'berlin', 'health', 'trusted',
    [AGENT_POOL[4]], // health@eu-north
    'route_success',
    {
      expected_ant_handle: 'health@eu-north',
      expected_country: 'DE',
      expected_frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2'],
      explanation: 'health@eu-north covers Berlin, tier certified > trusted required. GDPR caps autonomous agents at trusted — certified is within limits.',
    },
    'easy',
    ['germany', 'gdpr', 'health', 'eu-ai-act']
  ));

  records.push(scenario(
    'Compliance audit in Berlin — sovereign agent, GDPR jurisdiction',
    'berlin', 'compliance', 'certified',
    [AGENT_POOL[5]], // compliance@berlin (sovereign)
    'route_success',
    {
      expected_ant_handle: 'compliance@berlin',
      expected_country: 'DE',
      expected_frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2'],
      explanation: 'compliance@berlin is sovereign tier — exceeds GDPR maxAutonomyTier of trusted. Router should warn but route — sovereign agent operating within certified task requirement.',
    },
    'hard',
    ['germany', 'gdpr', 'compliance', 'sovereign-in-restricted-jurisdiction']
  ));

  // ── Category 2: Cross-border ambiguity ───────────────────────────────────

  records.push(scenario(
    'Finance task near CH/IT border — Lugano area',
    'geneva', 'finance', 'trusted',
    [AGENT_POOL[2], AGENT_POOL[3]], // milan finance + swiss finance
    'route_success',
    {
      expected_ant_handle: 'finance@swiss',
      expected_country: 'CH',
      expected_frameworks: ['SWISS_DPA', 'FINMA'],
      explanation: 'Geneva resolves to CH (Switzerland), not IT. FINMA governs. finance@swiss covers the territory.',
    },
    'medium',
    ['switzerland', 'cross-border', 'finma', 'border-ambiguity']
  ));

  records.push(scenario(
    'Legal task in London — UK GDPR post-Brexit, no EU AI Act',
    'london', 'legal', 'trusted',
    [AGENT_POOL[7]], // legal@london
    'route_success',
    {
      expected_ant_handle: 'legal@london',
      expected_country: 'GB',
      expected_frameworks: ['UK_GDPR'],
      explanation: 'UK is post-Brexit — UK GDPR applies, NOT EU GDPR or EU AI Act. legal@london covers the territory.',
    },
    'medium',
    ['uk', 'uk-gdpr', 'post-brexit', 'legal', 'not-eu-ai-act']
  ));

  // ── Category 3: No eligible agent ────────────────────────────────────────

  records.push(scenario(
    'Grid task in Naples — only provisioned agent available',
    'naples', 'grid', 'trusted',
    [AGENT_POOL[8]], // grid@naples (provisioned)
    'reject_tier',
    {
      expected_ant_handle: undefined,
      expected_country: 'IT',
      explanation: 'grid@naples exists but is only provisioned tier. Task requires trusted. Router rejects with tier_insufficient.',
    },
    'easy',
    ['italy', 'tier-insufficient', 'provisioned', 'reject']
  ));

  records.push(scenario(
    'Environment task in Singapore — no environment agent covers SG',
    'singapore', 'environment', 'observed',
    [AGENT_POOL[6]], // environment@eu (covers Paris area only)
    'reject_no_ant',
    {
      expected_ant_handle: undefined,
      expected_country: 'SG',
      expected_frameworks: ['PDPA_SG'],
      explanation: 'environment@eu territory is in France/EU. Singapore is outside its H3 territory. No eligible ant.',
    },
    'medium',
    ['singapore', 'pdpa', 'no-coverage', 'reject', 'apac']
  ));

  records.push(scenario(
    'Finance task in New York — no finance agent covers US territory',
    'new_york', 'finance', 'observed',
    [AGENT_POOL[2], AGENT_POOL[3]], // milan + swiss finance
    'reject_no_ant',
    {
      expected_ant_handle: undefined,
      expected_country: 'US',
      expected_frameworks: ['US_EO_14110'],
      explanation: 'Both finance agents cover EU territory only. New York is outside all registered territories.',
    },
    'easy',
    ['usa', 'no-coverage', 'reject', 'us-eo-14110']
  ));

  // ── Category 4: Unknown jurisdiction ─────────────────────────────────────

  records.push(scenario(
    'Task in Atlantic Ocean — no jurisdiction resolvable',
    'atlantic', 'general', 'observed',
    AGENT_POOL,
    'reject_no_jurisdiction',
    {
      expected_country: 'XX',
      expected_frameworks: [],
      explanation: 'Atlantic Ocean H3 cell has no country mapping. Router cannot resolve jurisdiction. Task rejected at Gate 2.',
    },
    'easy',
    ['ocean', 'no-jurisdiction', 'reject', 'gate-2']
  ));

  // ── Category 5: Multi-framework compliance conflict ───────────────────────

  records.push(scenario(
    'Sovereign grid agent in Rome — GDPR caps at trusted',
    'rome', 'grid', 'sovereign',
    [
      { ...AGENT_POOL[0], tier: 'sovereign', handle: 'grid@rome-sovereign' },
    ],
    'reject_tier',
    {
      expected_ant_handle: undefined,
      expected_country: 'IT',
      expected_frameworks: ['GDPR', 'EU_AI_ACT', 'EIDAS2', 'ITALIAN_CIVIL_CODE'],
      explanation: 'Task requires sovereign tier but task is in Rome under GDPR. GDPR maxAutonomyTier=trusted prevents dispatch of sovereign agents for most task types. No eligible ant below sovereign threshold.',
    },
    'hard',
    ['gdpr-compliance-conflict', 'sovereign', 'italy', 'framework-enforcement', 'adversarial']
  ));

  records.push(scenario(
    'Health task in São Paulo — LGPD jurisdiction, no local agent',
    'sao_paulo', 'health', 'observed',
    [AGENT_POOL[4]], // health@eu-north (Germany)
    'reject_no_ant',
    {
      expected_ant_handle: undefined,
      expected_country: 'BR',
      expected_frameworks: ['LGPD'],
      explanation: 'health@eu-north covers Germany, not Brazil. LGPD governs in São Paulo. No agent covers South America.',
    },
    'medium',
    ['brazil', 'lgpd', 'latam', 'no-coverage', 'reject']
  ));

  // ── Category 6: Adversarial ───────────────────────────────────────────────

  records.push(scenario(
    'ADVERSARIAL: Task cell in IT but agent claims CH territory — jurisdiction mismatch',
    'rome', 'finance', 'trusted',
    [
      // Agent claims to cover Zurich but task is in Rome
      { ...AGENT_POOL[3], handle: 'finance@swiss-fake', territory_cells: gridDisk(latLngToCell(47.376, 8.541, 5), 1) },
    ],
    'reject_no_ant',
    {
      expected_country: 'IT',
      explanation: 'Task originates in Rome (IT) but the only finance agent covers Zurich (CH). Territory mismatch — no eligible ant. This tests that H3 territory containment is enforced, not self-reported.',
    },
    'adversarial',
    ['territory-mismatch', 'adversarial', 'cross-jurisdiction', 'italy', 'switzerland']
  ));

  records.push(scenario(
    'ADVERSARIAL: Agent tier self-reported as certified but ops count = 10',
    'milan', 'finance', 'certified',
    [
      // Agent claims certified but operationCount would only give provisioned
      { ...AGENT_POOL[2], tier: 'certified', handle: 'finance@milan-fake' },
    ],
    'route_success', // Router trusts manifest tier — registry validation catches this at registration
    {
      expected_ant_handle: 'finance@milan-fake',
      expected_country: 'IT',
      explanation: 'Router trusts the registered manifest tier. Tier/ops-count consistency is enforced at registration time by validateManifestStructure(), not at routing time. This is by design — the registry is the trust boundary.',
    },
    'adversarial',
    ['tier-spoofing', 'adversarial', 'trust-boundary', 'registry-validation']
  ));

  return records;
}
