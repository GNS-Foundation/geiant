#!/usr/bin/env node
// Re-vendor the cgr.attestation.v4 conformance corpus from a local grafomem checkout.
// Deliberate, reviewable bump: run this, then `npm test` (the wellformed self-check re-validates
// the corpus's internal invariants), then commit the diff. See fixtures/.../PROVENANCE.md.
//
//   GRAFOMEM=~/grafomem node scripts/sync-corpus.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const grafomem = process.env.GRAFOMEM || join(process.env.HOME || '', 'grafomem');
const srcRel = 'conformance/cgr-attestation-v4/vectors.json';
const src = join(grafomem, srcRel);
const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, '..', 'src', '__tests__', 'fixtures', 'conformance', 'cgr-attestation-v4', 'vectors.json');

const sha = execSync('git rev-parse HEAD', { cwd: grafomem }).toString().trim();
const d = JSON.parse(readFileSync(src, 'utf8'));
const prov = {
  _comment: 'VENDORED COPY — do not edit by hand. Sync from source; see PROVENANCE.md.',
  source_repo: 'GNS-Foundation/grafomem',
  source_path: srcRel,
  source_sha: sha,
  vendored_at: new Date().toISOString().slice(0, 10),
  upstream_vector_count: d.vector_count,
};
writeFileSync(dest, JSON.stringify({ _provenance: prov, ...d }, null, 1) + '\n');
console.log(`synced ${d.vector_count} vectors from grafomem@${sha.slice(0, 12)} -> ${dest}`);
