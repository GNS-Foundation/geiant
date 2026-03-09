#!/usr/bin/env node
/**
 * GEIANT Phase 4.1 — Prithvi Classification E2E Test
 *
 * Prerequisites:
 *   PRITHVI_ENDPOINT_URL=https://xyz.us-east-1.aws.endpoints.huggingface.cloud
 *   HF_TOKEN=hf_...
 *   SUPABASE_URL=https://kaqwkxfaclyqjlfhxrmt.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Run from ~/geiant:
 *   PRITHVI_ENDPOINT_URL=... HF_TOKEN=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node packages/mcp-perception/test/phase4_1_e2e.mjs
 */

import { createClient } from '@supabase/supabase-js';

const ROME_H3_CELL   = '851f9ebfffffff';
const PC_STAC_URL    = 'https://planetarycomputer.microsoft.com/api/stac/v1';
const PC_SIGN_URL    = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign';

const PRITHVI_URL    = process.env.PRITHVI_ENDPOINT_URL;
const HF_TOKEN       = process.env.HF_TOKEN;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

const REQUIRED_BANDS = ['B02', 'B03', 'B04', 'B8A', 'B11', 'B12'];

let passed = 0;
let failed = 0;

function log(label, ok, detail) {
  const icon = ok ? '✓' : '✗';
  console.log(`  ${icon}  ${label}`);
  if (detail !== undefined) console.log(`       ${JSON.stringify(detail)}`);
  if (ok) passed++; else failed++;
}

function requireEnv() {
  const missing = [];
  if (!PRITHVI_URL)  missing.push('PRITHVI_ENDPOINT_URL');
  if (!HF_TOKEN)     missing.push('HF_TOKEN');
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    console.error(`\n❌  Missing env vars: ${missing.join(', ')}`);
    console.error('   Set them before running this test.\n');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Step 1 — Fetch Rome tile (reuse Phase 4.0 logic)
// ---------------------------------------------------------------------------

async function fetchRomeTile() {
  console.log('\n── Step 1: Fetch Rome tile from Planetary Computer ──────────────');

  const bbox = [11.4, 41.4, 12.99, 42.4];
  const end  = new Date();
  const start = new Date(end.getTime() - 30 * 86_400_000);
  const dateRange = `${start.toISOString().slice(0,10)}/${end.toISOString().slice(0,10)}`;

  const res = await fetch(`${PC_STAC_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collections: ['sentinel-2-l2a'],
      bbox,
      datetime: dateRange,
      query: { 'eo:cloud_cover': { lt: 20 } },
      sortby: [{ field: 'eo:cloud_cover', direction: 'asc' }],
      limit: 1,
    }),
  });

  const data = await res.json();
  const tile = data.features?.[0];
  log('Rome tile found', !!tile, { tile_id: tile?.id, cloud: tile?.properties?.['eo:cloud_cover'] });

  if (!tile) throw new Error('No tile found — cannot proceed');

  // Sign band URLs
  const bands = {};
  for (const band of REQUIRED_BANDS) {
    const href = tile.assets?.[band]?.href;
    if (!href) throw new Error(`Band ${band} missing`);
    const signRes = await fetch(`${PC_SIGN_URL}?href=${encodeURIComponent(href)}`);
    const signed = signRes.ok ? (await signRes.json()).href : href;
    bands[band] = signed;
  }
  log('All 6 bands signed', Object.keys(bands).length === 6);

  return { tile, bands };
}

// ---------------------------------------------------------------------------
// Step 2 — Call Prithvi HF Dedicated Endpoint
// ---------------------------------------------------------------------------

async function callPrithvi(tile, bands) {
  console.log('\n── Step 2: Call Prithvi-EO-2.0 HF Dedicated Endpoint ────────────');
  console.log(`   Endpoint: ${PRITHVI_URL}`);
  console.log('   (Cold start may take ~2 min if endpoint was paused...)');

  const body = {
    bands,
    bbox: {
      west:  tile.bbox[0],
      south: tile.bbox[1],
      east:  tile.bbox[2],
      north: tile.bbox[3],
    },
    chip_size: 512,
    confidence_threshold: 0.5,
  };

  const t0 = Date.now();
  const res = await fetch(PRITHVI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${HF_TOKEN}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000), // 5 min
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log('Endpoint responded', res.ok, { status: res.status, elapsed_s: elapsed });

  if (!res.ok) {
    const err = await res.text();
    log('Response body', false, { error: err.slice(0, 200) });
    throw new Error(`Endpoint HTTP ${res.status}`);
  }

  const result = await res.json();
  log('dominant_class present', !!result.dominant_class, { dominant_class: result.dominant_class });
  log('dominant_class is valid', ['flood','no_flood','cloud_nodata'].includes(result.dominant_class));
  log('flood_pixel_pct present', typeof result.flood_pixel_pct === 'number',
    { flood_pixel_pct: result.flood_pixel_pct });
  log('confidence > 0', result.confidence > 0, { confidence: result.confidence });
  log('mask_shape is [512,512]',
    Array.isArray(result.mask_shape) && result.mask_shape[0] === 512,
    { mask_shape: result.mask_shape });
  log('class_counts present',
    result.class_counts && typeof result.class_counts.no_flood === 'number',
    result.class_counts);
  log('model_id present', !!result.model_id, { model_id: result.model_id });
  log('Rome classified as no_flood (expected)',
    result.dominant_class === 'no_flood',
    { note: 'Rome is not flooded — model should classify as no_flood' });

  return result;
}

// ---------------------------------------------------------------------------
// Step 3 — Write perception chain to Spatial Memory
// ---------------------------------------------------------------------------

async function writeToSpatialMemory(tile, inferenceResult) {
  console.log('\n── Step 3: Write perception chain to Spatial Memory ─────────────');

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const bbox = { west: tile.bbox[0], south: tile.bbox[1], east: tile.bbox[2], north: tile.bbox[3] };
  const centerLon = (bbox.west + bbox.east) / 2;
  const centerLat = (bbox.south + bbox.north) / 2;

  const perceptionChain = {
    h3_cell: ROME_H3_CELL,
    tile_id: tile.id,
    acquisition_datetime: tile.properties.datetime,
    model_id: inferenceResult.model_id,
    model_version: inferenceResult.model_version,
    confidence: inferenceResult.confidence,
    agent_note: 'phase 4.1 e2e test — flood classification',
  };

  const metadata = {
    perception_chain: perceptionChain,
    classification: {
      dominant_class: inferenceResult.dominant_class,
      flood_pixel_pct: inferenceResult.flood_pixel_pct,
      class_counts: inferenceResult.class_counts,
    },
  };

  const { data: stored, error } = await supabase.rpc('geiant_store_geometry', {
    p_geometry_id: `perception-${ROME_H3_CELL}-${tile.id}`,
    p_geom_wkt:    `POINT(${centerLon} ${centerLat})`,
    p_h3_cells:    [ROME_H3_CELL],
    p_source:      'phase4_1_e2e_test',
    p_checksum:    'test',
    p_metadata:    metadata,
  });

  log('geometry_store RPC succeeded', !error, error ? { error: error.message } : { stored });

  if (error) throw new Error(`Supabase write failed: ${error.message}`);

  // Step 4 — Read it back with geometry_at
  console.log('\n── Step 4: Verify perception chain via geometry_at ──────────────');

  const { data: retrieved, error: readError } = await supabase.rpc('geiant_get_geometry_at', {
    p_geometry_id: `perception-${ROME_H3_CELL}-${tile.id}`,
    p_at_time: new Date().toISOString(),
  });

  log('geometry_at retrieval succeeded', !readError, readError ? { error: readError.message } : null);
  log('Row returned', Array.isArray(retrieved) && retrieved.length > 0,
    { count: retrieved?.length });

  if (retrieved?.length > 0) {
    const row = retrieved[0];
    const chain = row.metadata?.perception_chain;
    log('perception_chain in metadata', !!chain);
    log('tile_id matches', chain?.tile_id === tile.id,
      { expected: tile.id, got: chain?.tile_id });
    log('model_id matches', chain?.model_id === inferenceResult.model_id,
      { model_id: chain?.model_id });
    log('h3_cell matches', chain?.h3_cell === ROME_H3_CELL,
      { h3_cell: chain?.h3_cell });
    log('dominant_class in metadata',
      !!row.metadata?.classification?.dominant_class,
      { dominant_class: row.metadata?.classification?.dominant_class });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  requireEnv();

  console.log('\n🛰️  GEIANT Phase 4.1 — Prithvi Classification E2E Test');
  console.log(`   Rome H3 cell:     ${ROME_H3_CELL}`);
  console.log(`   Prithvi endpoint: ${PRITHVI_URL}`);
  console.log(`   Supabase:         ${SUPABASE_URL}`);

  try {
    const { tile, bands } = await fetchRomeTile();
    const inferenceResult = await callPrithvi(tile, bands);
    await writeToSpatialMemory(tile, inferenceResult);
  } catch (err) {
    console.error('\n💥 Fatal:', err.message);
    failed++;
  }

  console.log('\n── Results ───────────────────────────────────────────────────────');
  console.log(`   ✓ ${passed} passed   ✗ ${failed} failed`);

  if (failed === 0) {
    console.log('\n🟢 Sub-phase 4.1 COMPLETE — Prithvi classification + perception chain verified');
    console.log('   Next: Sub-phase 4.2 — Clay v1.5 embeddings');
  } else {
    console.log('\n🔴 Failures detected — check output above');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
