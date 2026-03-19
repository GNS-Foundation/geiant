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

const ROME_H3_CELL = '851f9ebfffffff';
const STAC_URL = 'https://earth-search.aws.element84.com/v1';

const PRITHVI_URL = process.env.PRITHVI_ENDPOINT_URL;
const HF_TOKEN = process.env.HF_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Element84 uses named Sentinel-2 bands
const REQUIRED_BANDS = {
  B02: 'blue',
  B03: 'green',
  B04: 'red',
  B8A: 'nir08',
  B11: 'swir16',
  B12: 'swir22'
};

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
  if (!PRITHVI_URL) missing.push('PRITHVI_ENDPOINT_URL');
  if (!HF_TOKEN) missing.push('HF_TOKEN');
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
  console.log('\n── Step 1: Fetch Rome tile from Element84 Earth Search ───────────');

  const bbox = [11.4, 41.4, 12.99, 42.4];
  const end = new Date();
  const start = new Date(end.getTime() - 60 * 86_400_000); // 60 days
  const dateRange = `${start.toISOString()}/${end.toISOString()}`;

  const res = await fetch(`${STAC_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collections: ['sentinel-2-c1-l2a'],
      bbox,
      datetime: dateRange,
      query: { 'eo:cloud_cover': { lt: 20 } },
      sortby: [{ field: 'properties.eo:cloud_cover', direction: 'asc' }],
      limit: 1,
    }),
  });

  const data = await res.json();
  const tile = data.features?.[0];
  log('Rome tile found', !!tile, { tile_id: tile?.id, cloud: tile?.properties?.['eo:cloud_cover'] });

  if (!tile) throw new Error('No tile found — cannot proceed');

  // Do NOT sign band URLs locally! Element84 AWS Earth Search supports anonymous access
  const bands = {};
  for (const [prithviName, stacName] of Object.entries(REQUIRED_BANDS)) {
    const href = tile.assets?.[stacName]?.href;
    if (!href) throw new Error(`Band ${stacName} missing from STAC (expected for ${prithviName})`);
    bands[prithviName] = href;
  }
  log('All 6 bands extracted (Element84)', Object.keys(bands).length === 6);

  const epsg = tile.properties?.['proj:epsg'];
  if (!epsg) throw new Error('No proj:epsg found in STAC item');
  log('Tile EPSG found', !!epsg, { epsg });

  return { tile, bands, epsg };
}

// ---------------------------------------------------------------------------
// Step 2 — Call Prithvi HF Dedicated Endpoint
// ---------------------------------------------------------------------------

import proj4 from 'proj4';

function getUtmProjString(epsg) {
  if (epsg >= 32601 && epsg <= 32660) {
    return `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`;
  } else if (epsg >= 32701 && epsg <= 32760) {
    return `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`;
  }
  throw new Error(`Unsupported EPSG: ${epsg}`);
}

async function callPrithvi(tile, bands, epsg) {
  console.log('\n── Step 2: Call Prithvi-EO-2.0 HF Dedicated Endpoint ────────────');
  console.log(`   Endpoint: ${PRITHVI_URL}`);
  console.log('   (Cold start may take ~2 min if endpoint was paused...)');

  // Reproject WGS84 bbox to native tile CRS (UTM) for rasterio window
  const projString = getUtmProjString(epsg);
  const [minX, minY] = proj4('WGS84', projString, [tile.bbox[0], tile.bbox[1]]);
  const [maxX, maxY] = proj4('WGS84', projString, [tile.bbox[2], tile.bbox[3]]);

  log('Reprojected bounding box to Native CRS', true, { epsg, minX, minY, maxX, maxY });

  const body = {
    bands,
    bbox: {
      west: minX,
      south: minY,
      east: maxX,
      north: maxY,
    },
    chip_size: 512,
    confidence_threshold: 0.5,
  };

  const endpointUrl = PRITHVI_URL.replace('/runsync', '/run');
  const t0 = Date.now();
  const res = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${HF_TOKEN}`,
    },
    body: JSON.stringify({ input: body }),
    signal: AbortSignal.timeout(300_000), // 5 min
  });

  if (!res.ok) {
    const err = await res.text();
    log('Response body', false, { error: err.slice(0, 200) });
    throw new Error(`Endpoint HTTP ${res.status}`);
  }

  const initial = await res.json();
  const jobId = initial.id;
  log('RunPod Job ID created', !!jobId, { id: jobId });

  let raw = null;
  while (true) {
    if (Date.now() - t0 > 300_000) {
      throw new Error('RunPod polling timed out after 5 minutes.');
    }

    process.stdout.write('.');
    const statusRes = await fetch(`${endpointUrl.replace('/run', '/status')}/${jobId}`, {
      headers: { 'Authorization': `Bearer ${HF_TOKEN}` }
    });

    if (!statusRes.ok) throw new Error(`RunPod status HTTP ${statusRes.status}`);

    const statusData = await statusRes.json();
    if (statusData.status === 'COMPLETED') {
      console.log('\n');
      raw = statusData;
      break;
    } else if (statusData.status === 'FAILED') {
      console.log('\n');
      throw new Error(`RunPod Status FAILED: ${statusData.error || JSON.stringify(statusData)}`);
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log('Endpoint responded complete', true, { elapsed_s: elapsed });

  // RunPod wraps handler return in { output: {...}, status: "COMPLETED" }
  const result = raw.output ?? raw;
  console.log(`   RunPod output keys: ${Object.keys(result)}`);
  log('dominant_class present', !!result.dominant_class, { dominant_class: result.dominant_class });
  log('dominant_class is valid', ['flood', 'no_flood', 'cloud_nodata'].includes(result.dominant_class));
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
    p_geojson: JSON.stringify({ type: 'Point', coordinates: [centerLon, centerLat] }),
    p_h3_cells: [ROME_H3_CELL],
    p_source: 'phase4_1_e2e_test',
    p_checksum: 'test',
    p_metadata: metadata,
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
    const { tile, bands, epsg } = await fetchRomeTile();
    const inferenceResult = await callPrithvi(tile, bands, epsg);
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
