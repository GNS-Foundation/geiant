#!/usr/bin/env node
/**
 * GEIANT Phase 4.2 — Clay v1.5 Embedding E2E Test
 */

import { createClient } from '@supabase/supabase-js';

const ENDPOINT_URL   = process.env.PRITHVI_ENDPOINT_URL;
const RUNPOD_API_KEY = process.env.HF_TOKEN;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ROME_H3      = '851e8053fffffff';
const ROME_LAT     = 41.9028;
const ROME_LON     = 12.4964;
const EXPECTED_DIM = 1024;
const POLL_INTERVAL = 3000;
const POLL_TIMEOUT  = 300000;

let passed = 0, failed = 0;
function check(name, condition, detail = '') {
  if (condition) { console.log(`  ✓  ${name}${detail ? '\n       ' + JSON.stringify(detail) : ''}`); passed++; }
  else           { console.log(`  ✗  ${name}${detail ? '\n       ' + JSON.stringify(detail) : ''}`); failed++; }
}

async function fetchTile() {
  const { cellToBoundary } = await import('h3-js');
  const boundary = cellToBoundary(ROME_H3);
  const lats = boundary.map(c => c[0]);
  const lons = boundary.map(c => c[1]);
  const bbox = { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lons), east: Math.max(...lons) };
  const body = {
    collections: ['sentinel-2-l2a'],
    bbox: [12.4, 41.8, 12.6, 42.0],
    datetime: '2024-01-01T00:00:00Z/2026-03-19T00:00:00Z',
    query: { 'eo:cloud_cover': { lt: 30 } },
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
    limit: 1,
  };
  const res  = await fetch('https://earth-search.aws.element84.com/v1/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!data.features?.length) throw new Error('No tile found');
  const item = data.features[0];
  const bandMap = { B02: 'blue', B03: 'green', B04: 'red', B8A: 'nir08', B11: 'swir16', B12: 'swir22' };
  const bands = {};
  for (const [b, key] of Object.entries(bandMap)) {
    const href = item.assets[key]?.href || item.assets[b]?.href;
    if (!href) throw new Error(`Missing band ${b}`);
    bands[b] = href;
  }
  return { bands, bbox, tileId: item.id, cloud: item.properties['eo:cloud_cover'], timestamp: item.properties.datetime };
}

async function pollRunPod(jobId) {
  const statusUrl = ENDPOINT_URL.replace('/run', `/status/${jobId}`);
  const deadline  = Date.now() + POLL_TIMEOUT;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    const res  = await fetch(statusUrl, { headers: { Authorization: `Bearer ${RUNPOD_API_KEY}` } });
    const data = await res.json();
    process.stdout.write('.');
    if (data.status === 'COMPLETED') return data.output;
    if (data.status === 'FAILED')    throw new Error(`RunPod failed: ${JSON.stringify(data.error)}`);
  }
  throw new Error('Polling timeout');
}

async function main() {
  for (const [k,v] of Object.entries({ PRITHVI_ENDPOINT_URL: ENDPOINT_URL, HF_TOKEN: RUNPOD_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SUPABASE_KEY })) {
    if (!v) { console.error(`Missing env: ${k}`); process.exit(1); }
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log(`\nGEIANT Phase 4.2 — Clay v1.5 Embedding E2E Test`);
  console.log(`   Rome H3: ${ROME_H3}\n`);

  console.log('── Step 1: Fetch Rome tile ───────────────────────────────────────────────');
  const tile = await fetchTile();
  check('Rome tile found', true, { tile_id: tile.tileId, cloud: tile.cloud });
  check('6 bands present', Object.keys(tile.bands).length === 6);
  check('timestamp present', !!tile.timestamp, { timestamp: tile.timestamp });

  console.log('\n── Step 2: Clay v1.5 embed via RunPod ───────────────────────────────────');
  console.log('   (cold start ~3 min...)');
  const submitRes  = await fetch(ENDPOINT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RUNPOD_API_KEY}` },
    body: JSON.stringify({ input: { task: 'embed', bands: tile.bands, bbox: tile.bbox, chip_size: 256,
      metadata: { lat: ROME_LAT, lon: ROME_LON, timestamp: tile.timestamp, gsd: 10.0 } } }),
  });
  const submitData = await submitRes.json();
  check('Job submitted', !!submitData.id, { id: submitData.id });
  const emb = await pollRunPod(submitData.id);
  console.log('');
  check('No error',              !emb.error,                              emb.error || 'ok');
  check('embedding present',     Array.isArray(emb.embedding),           { type: typeof emb.embedding });
  check(`dim = ${EXPECTED_DIM}`, emb.embedding_dim === EXPECTED_DIM,     { got: emb.embedding_dim });
  check('length matches',        emb.embedding?.length === EXPECTED_DIM, { len: emb.embedding?.length });
  check('norm > 0',              emb.embedding_norm > 0,                 { norm: emb.embedding_norm });
  check('model is Clay',         emb.model_id?.includes('Clay'),         { model_id: emb.model_id });
  check('version 1.5.0',         emb.model_version === '1.5.0',          { got: emb.model_version });
  check('all values finite',     emb.embedding?.every(v => isFinite(v)));

  console.log('\n── Step 3: Write to Spatial Memory ──────────────────────────────────────');
  const geoId = `embedding-${ROME_H3}-${tile.tileId}`;
  const chain = { tile_id: tile.tileId, acquired: tile.timestamp, model_id: emb.model_id,
    model_version: emb.model_version, task: 'embed', embedding_dim: emb.embedding_dim,
    embedding_norm: emb.embedding_norm, embedding_preview: emb.embedding?.slice(0, 8),
    clay_embedding: emb.embedding, h3_cell: ROME_H3, lat: ROME_LAT, lon: ROME_LON };
  const { data: stored, error: storeErr } = await supabase.rpc('geiant_store_geometry', {
    p_geometry_id: geoId,
    p_geojson:     JSON.stringify({ type: 'Point', coordinates: [ROME_LON, ROME_LAT] }),
    p_h3_cells:    [ROME_H3],
    p_source:      'phase4-2-e2e-test',
    p_checksum:    'perception-' + geoId.slice(0, 8),
    p_metadata:    { perception_chain: chain },
  });
  check('geometry_store succeeded', !storeErr, storeErr?.message || 'ok');
  check('row stored',               !!stored);

  console.log('\n── Step 4: Verify retrieval ──────────────────────────────────────────────');
  const { data: rows, error: fetchErr } = await supabase
    .from('geiant_geometry_state').select('geometry_id, metadata, valid_from')
    .eq('geometry_id', geoId).order('valid_from', { ascending: false }).limit(1);
  check('retrieval succeeded',      !fetchErr, fetchErr?.message || 'ok');
  check('row returned',             rows?.length === 1, { count: rows?.length });
  const pc = rows?.[0]?.metadata?.perception_chain;
  check('perception_chain present', !!pc);
  check('tile_id matches',          pc?.tile_id === tile.tileId, { got: pc?.tile_id });
  check('model is Clay',            pc?.model_id?.includes('Clay'), { model_id: pc?.model_id });
  check('h3_cell matches',          pc?.h3_cell === ROME_H3);
  check('embedding_dim in chain',   pc?.embedding_dim === EXPECTED_DIM, { got: pc?.embedding_dim });
  check('clay_embedding stored',    Array.isArray(pc?.clay_embedding), { len: pc?.clay_embedding?.length });

  console.log(`\n── Results ───────────────────────────────────────────────────────────────`);
  console.log(`   ✓ ${passed} passed   ✗ ${failed} failed`);
  if (failed === 0) {
    console.log('\n🟢 Sub-phase 4.2 COMPLETE — Clay v1.5 embeddings verified');
    console.log('   Next: Sub-phase 4.3 — Prithvi-WxC weather context');
  } else {
    process.exit(1);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
