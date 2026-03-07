// =============================================================================
// GEIANT — DATASET EXPORTER
// Exports benchmark scenarios to JSON, JSONL, and HuggingFace-ready formats.
// =============================================================================

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  DatasetRecord,
  DatasetManifest,
  DatasetFamily,
  Difficulty,
  ExpectedOutcome,
} from '../types.js';
import { generateJurisdictionalRoutingScenarios } from '../generators/jurisdictional_routing.js';
import { generateGeometryMutationScenarios } from '../generators/geometry_mutation.js';
import { generateDelegationChainScenarios } from '../generators/delegation_chain.js';

// ---------------------------------------------------------------------------
// Collect all records
// ---------------------------------------------------------------------------

export function generateFullDataset(): DatasetRecord[] {
  return [
    ...generateJurisdictionalRoutingScenarios(),
    ...generateGeometryMutationScenarios(),
    ...generateDelegationChainScenarios(),
  ];
}

// ---------------------------------------------------------------------------
// Build manifest
// ---------------------------------------------------------------------------

export function buildManifest(records: DatasetRecord[]): DatasetManifest {
  const byFamily = {} as Record<DatasetFamily, number>;
  const byDifficulty = {} as Record<Difficulty, number>;
  const byOutcome = {} as Partial<Record<ExpectedOutcome, number>>;

  for (const r of records) {
    byFamily[r.family]       = (byFamily[r.family] || 0) + 1;
    byDifficulty[r.difficulty] = (byDifficulty[r.difficulty] || 0) + 1;
    byOutcome[r.expected_outcome] = (byOutcome[r.expected_outcome] || 0) + 1;
  }

  return {
    name: 'geiant-geospatial-agent-benchmark',
    version: '0.1.0',
    description:
      'The first benchmark dataset for geospatial AI agent orchestration. ' +
      'Tests jurisdictional routing, geometry mutation integrity, and ' +
      'human→agent delegation chain validation under real-world regulatory ' +
      'frameworks (GDPR, EU AI Act, FINMA, LGPD, PDPA-SG).',
    families: ['jurisdictional_routing', 'geometry_mutation', 'delegation_chain'],
    total_records: records.length,
    records_by_family: byFamily,
    records_by_difficulty: byDifficulty,
    records_by_outcome: byOutcome,
    generated_at: new Date().toISOString(),
    geiant_version: '0.1.0',
    huggingface_repo: 'GNS-Foundation/geiant-geospatial-agent-benchmark',
    license: 'Apache-2.0',
    citation:
      'Ayerbe, C. (2026). GEIANT Geospatial Agent Benchmark v0.1.0. ' +
      'GNS Foundation / ULISSY s.r.l. https://github.com/GNS-Foundation/geiant',
  };
}

// ---------------------------------------------------------------------------
// Export functions
// ---------------------------------------------------------------------------

export function exportToJsonl(records: DatasetRecord[], path: string): void {
  const lines = records.map(r => JSON.stringify(r)).join('\n');
  writeFileSync(path, lines, 'utf8');
}

export function exportToJson(records: DatasetRecord[], path: string): void {
  writeFileSync(path, JSON.stringify(records, null, 2), 'utf8');
}

export function exportManifest(manifest: DatasetManifest, path: string): void {
  writeFileSync(path, JSON.stringify(manifest, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// HuggingFace datacard (README.md)
// ---------------------------------------------------------------------------

export function generateDatacard(manifest: DatasetManifest, records: DatasetRecord[]): string {
  const f = manifest.records_by_family;
  const d = manifest.records_by_difficulty;
  const o = manifest.records_by_outcome;

  const outcomeTable = Object.entries(o)
    .sort(([,a],[,b]) => b - a)
    .map(([k, v]) => `| \`${k}\` | ${v} |`)
    .join('\n');

  return `---
language:
- en
license: apache-2.0
tags:
- geospatial
- agent-benchmark
- jurisdictional-routing
- geometry-validation
- delegation-chain
- gdpr
- eu-ai-act
- h3
- gns-protocol
pretty_name: GEIANT Geospatial Agent Benchmark
size_categories:
- n<1K
task_categories:
- text-classification
- question-answering
---

# GEIANT Geospatial Agent Benchmark

**The first benchmark dataset for geospatial AI agent orchestration.**

Built on the [GNS Protocol](https://gcrumbs.com) — the decentralized identity system that proves humanity through Proof-of-Trajectory.

## Overview

Every AI orchestrator (LangChain, CrewAI, AutoGPT) routes tasks based on capability and availability. None of them understand *where* the task originates, *what regulatory framework* governs that location, or *whether the geometry the agent produced is actually valid*.

GEIANT fixes this. This benchmark tests three capabilities no other orchestrator has:

| Capability | What it tests |
|---|---|
| **Jurisdictional Routing** | H3 cell → country → regulatory framework → agent selection |
| **Geometry Mutation Integrity** | Multi-step geometry workflows with injected corruption |
| **Delegation Chain Validation** | Human→agent authorization cert validity |

## Dataset Statistics

**Total records:** ${manifest.total_records}

### By Family
| Family | Count |
|---|---|
| \`jurisdictional_routing\` | ${f.jurisdictional_routing || 0} |
| \`geometry_mutation\` | ${f.geometry_mutation || 0} |
| \`delegation_chain\` | ${f.delegation_chain || 0} |

### By Difficulty
| Difficulty | Count |
|---|---|
| \`easy\` | ${d.easy || 0} |
| \`medium\` | ${d.medium || 0} |
| \`hard\` | ${d.hard || 0} |
| \`adversarial\` | ${d.adversarial || 0} |

### By Expected Outcome
| Outcome | Count |
|---|---|
${outcomeTable}

## Schema

Each record is a \`DatasetRecord\` with the following fields:

\`\`\`typescript
{
  id: string;                    // UUID
  family: DatasetFamily;         // which benchmark
  description: string;           // human-readable scenario description
  input: object;                 // the task/cert/geometry submitted
  expected_outcome: string;      // what GEIANT should do
  ground_truth: {
    expected_ant_handle?: string;
    expected_country?: string;
    expected_frameworks?: string[];
    geometry_valid?: boolean;
    delegation_valid?: boolean;
    explanation: string;         // WHY this is the correct answer
  };
  difficulty: string;            // easy | medium | hard | adversarial
  tags: string[];
}
\`\`\`

## Regulatory Frameworks Covered

| Framework | Jurisdiction | Max Autonomy Tier |
|---|---|---|
| GDPR | EU | trusted |
| EU AI Act | EU | trusted |
| eIDAS2 | EU | certified |
| FINMA | Switzerland | certified |
| Swiss DPA | Switzerland | certified |
| UK GDPR | United Kingdom | trusted |
| US EO 14110 | United States | sovereign |
| CCPA | California, USA | sovereign |
| LGPD | Brazil | trusted |
| PDPA-SG | Singapore | trusted |
| Italian Civil Code | Italy | trusted |

## Usage

\`\`\`python
from datasets import load_dataset

ds = load_dataset("GNS-Foundation/geiant-geospatial-agent-benchmark")

# Filter by family
routing = ds.filter(lambda x: x["family"] == "jurisdictional_routing")

# Filter by difficulty
adversarial = ds.filter(lambda x: x["difficulty"] == "adversarial")

# Get all rejection scenarios
rejections = ds.filter(lambda x: x["expected_outcome"].startswith("reject_"))
\`\`\`

## Geospatial Moat

This dataset uses **H3 hexagonal hierarchical spatial indexing** (Uber H3) at resolution 5–9. Each agent is assigned a territory as a set of H3 cells. Routing validates that the task origin cell is contained within the agent's territory — not just lat/lng bounding boxes.

The H3 cells in this dataset are generated from real coordinates:

\`\`\`python
import h3
rome_cell = h3.latlng_to_cell(41.902, 12.496, 7)
# → '871e805003fffff'
\`\`\`

## Citation

\`\`\`bibtex
@dataset{geiant_benchmark_2026,
  author    = {Ayerbe, Camilo},
  title     = {GEIANT Geospatial Agent Benchmark},
  year      = {2026},
  version   = {0.1.0},
  publisher = {GNS Foundation / ULISSY s.r.l.},
  url       = {https://huggingface.co/datasets/GNS-Foundation/geiant-geospatial-agent-benchmark}
}
\`\`\`

## License

Apache 2.0 — free for research and commercial use.

---

*Built with [GEIANT](https://github.com/GNS-Foundation/geiant) — Geo-Identity Agent Navigation & Tasking.*
*Part of the [GNS Protocol](https://gcrumbs.com) ecosystem.*
`;
}

// ---------------------------------------------------------------------------
// Main export pipeline
// ---------------------------------------------------------------------------

export function runExportPipeline(outputDir: string): DatasetManifest {
  mkdirSync(outputDir, { recursive: true });

  const records = generateFullDataset();
  const manifest = buildManifest(records);

  // Per-family JSONL (HuggingFace convention)
  const families: DatasetFamily[] = ['jurisdictional_routing', 'geometry_mutation', 'delegation_chain'];
  for (const family of families) {
    const subset = records.filter(r => r.family === family);
    exportToJsonl(subset, join(outputDir, `${family}.jsonl`));
    exportToJson(subset,  join(outputDir, `${family}.json`));
  }

  // Full dataset
  exportToJsonl(records,  join(outputDir, 'geiant_benchmark.jsonl'));
  exportToJson(records,   join(outputDir, 'geiant_benchmark.json'));

  // Manifest
  exportManifest(manifest, join(outputDir, 'manifest.json'));

  // HuggingFace datacard
  const datacard = generateDatacard(manifest, records);
  writeFileSync(join(outputDir, 'README.md'), datacard, 'utf8');

  return manifest;
}
