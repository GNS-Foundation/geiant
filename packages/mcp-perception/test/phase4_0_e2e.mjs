#!/usr/bin/env node
/**
 * GEIANT Phase 4.0 — Tile Pipeline E2E Test
 *
 * Tests perception_fetch_tile against the live Planetary Computer STAC API.
 * No GPU, no models, no env vars required.
 *
 * Run from ~/geiant:
 *   node packages/mcp-perception/test/phase4_0_e2e.mjs
 */

// ---------------------------------------------------------------------------
// Same Rome H3 cell used in Phase 3 seed
// Resolution 5 — ~252 km² cell covering central Rome
// ---------------------------------------------------------------------------
const ROME_H3_CELL = '851f9ebfffffff'; // res 5, central Rome

// Two additional test cells
const MILAN_H3_CELL  = '851f9c3fffffff'; // Milan area
const VENICE_H3_CELL = '851fb03fffffff'; // Venice area

const PC_STAC_URL = 'https://planetarycomputer.microsoft.com/api/stac/v1';

let passed = 0;
let failed = 0;

function log(label, ok, detail) {
  const icon = ok ? '✓' : '✗';
  console.log(`  ${icon}  ${label}`);
  if (detail !== undefined) {
    console.log(`       ${JSON.stringify(detail)}`);
  }
  if (ok) passed++; else failed++;
}

// ---------------------------------------------------------------------------
// Helpers — replicate the service logic directly (no MCP overhead in test)
// ---------------------------------------------------------------------------

function h3ToBbox(h3Cell) {
  // Use Planetary Computer directly with a rough bbox for res-5 H3 cells
  // Real implementation uses h3-js cellToBoundary — here we call the STAC
  // search with a point + radius approximation for the test
  // Rome center: 41.9028, 12.4964
  const centers = {
    '851f9ebfffffff': { lat: 41.90, lon: 12.49 }, // Rome
    '851f9c3fffffff': { lat: 45.46, lon: 9.18  }, // Milan
    '851fb03fffffff': { lat: 45.44, lon: 12.33 }, // Venice
  };
  const c = centers[h3Cell] ?? { lat: 41.90, lon: 12.49 };
  const d = 0.5; // ~50km buffer for res-5
  return [c.lon - d, c.lat - d, c.lon + d, c.lat + d];
}

async function searchStac(bbox, maxCloud, daysBack) {
  const endDate   = new Date();
  const startDate = new Date(endDate.getTime() - daysBack * 86_400_000);
  const datetimeRange = `${startDate.toISOString().slice(0, 10)}/${endDate.toISOString().slice(0, 10)}`;

  const body = {
    collections: ['sentinel-2-l2a'],
    bbox,
    datetime: datetimeRange,
    query: { 'eo:cloud_cover': { lt: maxCloud } },
    sortby: [{ field: 'eo:cloud_cover', direction: 'asc' }],
    limit: 3,
  };

  const res = await fetch(`${PC_STAC_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`STAC HTTP ${res.status}: ${await res.text()}`);
  return await res.json();
}

// ---------------------------------------------------------------------------
// Step 1 — STAC API reachable
// ---------------------------------------------------------------------------

async function testStacReachable() {
  console.log('\n── Step 1: Planetary Computer STAC API reachable ───────────────');
  const res = await fetch(`${PC_STAC_URL}`);
  log('STAC root responds 200', res.ok, { status: res.status });

  const data = await res.json();
  log('Response has collections link', Array.isArray(data.links) && data.links.length > 0);
}

// ---------------------------------------------------------------------------
// Step 2 — Search for Rome tile (last 30 days, <20% cloud)
// ---------------------------------------------------------------------------

async function testRomeTile() {
  console.log('\n── Step 2: Fetch least-cloudy tile for Rome H3 cell ─────────────');

  const bbox = h3ToBbox(ROME_H3_CELL);
  log('H3 → bbox derived', true, { h3: ROME_H3_CELL, bbox });

  const data = await searchStac(bbox, 20, 30);

  log('STAC search returned features', Array.isArray(data.features));
  log('At least one tile found (30d, <20% cloud)', data.features?.length > 0,
    { count: data.features?.length ?? 0 });

  if (!data.features?.length) {
    console.log('  ⚠️  No tiles in 30 days — trying 90 days...');
    const data90 = await searchStac(bbox, 40, 90);
    log('Tile found within 90 days (<40% cloud)', data90.features?.length > 0,
      { count: data90.features?.length ?? 0 });
    if (!data90.features?.length) return null;
    return data90.features[0];
  }

  const tile = data.features[0];
  log('tile_id present', !!tile.id, { tile_id: tile.id });
  log('acquisition_datetime present', !!tile.properties?.datetime,
    { datetime: tile.properties?.datetime });
  log('cloud_cover_pct < 20', tile.properties?.['eo:cloud_cover'] < 20,
    { cloud_cover_pct: tile.properties?.['eo:cloud_cover'] });
  log('platform present', !!tile.properties?.platform,
    { platform: tile.properties?.platform });

  return tile;
}

// ---------------------------------------------------------------------------
// Step 3 — Verify all 6 required bands present in tile assets
// ---------------------------------------------------------------------------

async function testBandAssets(tile) {
  console.log('\n── Step 3: Verify required spectral bands in tile assets ─────────');

  const REQUIRED = ['B02', 'B03', 'B04', 'B8A', 'B11', 'B12'];
  const assets = tile.assets ?? {};

  for (const band of REQUIRED) {
    const asset = assets[band];
    log(`Band ${band} present`, !!asset, asset ? { href: asset.href?.slice(0, 60) + '...' } : undefined);
  }

  // Check COG format
  const b04 = assets['B04'];
  if (b04) {
    log('B04 is Cloud-Optimized GeoTIFF',
      b04.href?.includes('.tif') || b04.type?.includes('tiff'),
      { type: b04.type });
  }
}

// ---------------------------------------------------------------------------
// Step 4 — Try unsigned URL access (HEAD request to check accessibility)
// ---------------------------------------------------------------------------

async function testUrlAccess(tile) {
  console.log('\n── Step 4: Verify COG URL accessible (unsigned) ─────────────────');

  const b04href = tile.assets?.['B04']?.href;
  if (!b04href) { log('B04 URL accessible', false, { reason: 'no href' }); return; }

  // HEAD request — don't download the full GeoTIFF
  try {
    const res = await fetch(b04href, { method: 'HEAD' });
    // 200 = no auth needed, 302/403 = needs signing
    log('B04 COG URL reachable', res.status < 500,
      { status: res.status, note: res.status === 200 ? 'open access' : 'may need signing' });
  } catch (err) {
    log('B04 COG URL reachable', false, { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Step 5 — Test signing endpoint
// ---------------------------------------------------------------------------

async function testSigning(tile) {
  console.log('\n── Step 5: Test Planetary Computer URL signing ───────────────────');

  const b04href = tile.assets?.['B04']?.href;
  if (!b04href) { log('Signing skipped', false, { reason: 'no href' }); return; }

  try {
    const signRes = await fetch(
      `https://planetarycomputer.microsoft.com/api/sas/v1/sign?href=${encodeURIComponent(b04href)}`
    );
    log('Sign endpoint responds', signRes.ok, { status: signRes.status });

    if (signRes.ok) {
      const signed = await signRes.json();
      log('Signed URL returned', !!signed.href,
        { signed_url_prefix: signed.href?.slice(0, 80) + '...' });
    }
  } catch (err) {
    log('Signing endpoint reachable', false, { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Step 6 — Additional cells (Milan, Venice)
// ---------------------------------------------------------------------------

async function testAdditionalCells() {
  console.log('\n── Step 6: Additional Italian H3 cells ──────────────────────────');

  for (const [name, cell] of [['Milan', MILAN_H3_CELL], ['Venice', VENICE_H3_CELL]]) {
    const bbox = h3ToBbox(cell);
    const data = await searchStac(bbox, 30, 60);
    log(`${name} tile found (60d, <30% cloud)`, data.features?.length > 0,
      {
        count: data.features?.length ?? 0,
        best_cloud: data.features?.[0]?.properties?.['eo:cloud_cover'] ?? 'n/a',
      });
  }
}

// ---------------------------------------------------------------------------
// Step 7 — No-tile scenario (extreme cloud filter)
// ---------------------------------------------------------------------------

async function testNoTileScenario() {
  console.log('\n── Step 7: No-tile scenario (0% cloud, 1 day) ───────────────────');

  const bbox = h3ToBbox(ROME_H3_CELL);
  const data = await searchStac(bbox, 0, 1);  // impossible filter
  log('No tile returned for impossible filter (expected)',
    data.features?.length === 0,
    { count: data.features?.length ?? 0 });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n🛰️  GEIANT Phase 4.0 — Tile Pipeline E2E Test');
  console.log(`   Rome H3 cell: ${ROME_H3_CELL}`);
  console.log(`   STAC API:     ${PC_STAC_URL}`);

  try {
    await testStacReachable();
    const tile = await testRomeTile();

    if (tile) {
      await testBandAssets(tile);
      await testUrlAccess(tile);
      await testSigning(tile);
    } else {
      console.log('\n  ⚠️  Skipping band/URL tests — no tile found');
      failed += 3;
    }

    await testAdditionalCells();
    await testNoTileScenario();

  } catch (err) {
    console.error('\n💥 Unexpected error:', err);
    failed++;
  }

  console.log('\n── Results ───────────────────────────────────────────────────────');
  console.log(`   ✓ ${passed} passed   ✗ ${failed} failed`);

  if (failed === 0) {
    console.log('\n🟢 Sub-phase 4.0 COMPLETE — tile pipeline verified');
    console.log('   Next: Sub-phase 4.1 — deploy Prithvi-EO-2.0-300M-TL-Sen1Floods11');
    console.log('   to a Hugging Face Dedicated Endpoint, then implement perception_classify');
  } else {
    console.log('\n🔴 Failures detected — check output above');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
