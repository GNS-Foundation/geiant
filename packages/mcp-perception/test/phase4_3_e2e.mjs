#!/usr/bin/env node
/**
 * GEIANT Phase 4.3 — Weather Context E2E Test
 * Tests perception_weather via Open-Meteo ERA5
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ROME_H3   = '851e8053fffffff';
const TIMESTAMP = '2026-03-17T10:09:33.201000Z'; // Same tile date as 4.1/4.2

let passed = 0, failed = 0;
function check(name, condition, detail = '') {
  if (condition) { console.log(`  ✓  ${name}${detail ? '\n       ' + JSON.stringify(detail) : ''}`); passed++; }
  else           { console.log(`  ✗  ${name}${detail ? '\n       ' + JSON.stringify(detail) : ''}`); failed++; }
}

async function main() {
  for (const [k,v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SUPABASE_KEY })) {
    if (!v) { console.error(`Missing env: ${k}`); process.exit(1); }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  console.log('\nGEIANT Phase 4.3 — Weather Context E2E Test');
  console.log(`   Rome H3: ${ROME_H3}`);
  console.log(`   Timestamp: ${TIMESTAMP}\n`);

  // ── Step 1: Fetch weather from Open-Meteo ─────────────────────────────
  console.log('── Step 1: Fetch weather from Open-Meteo ERA5 ────────────────────────────');

  // Derive centroid from Rome H3
  const { cellToLatLng } = await import('h3-js');
  const [lat, lon] = cellToLatLng(ROME_H3);
  check('H3 centroid derived', lat > 41 && lat < 43, { lat, lon });

  const dt = new Date(TIMESTAMP);
  const dateStr = dt.toISOString().slice(0, 10);
  const hour = dt.getUTCHours();

  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude',   lat.toFixed(6));
  url.searchParams.set('longitude',  lon.toFixed(6));
  url.searchParams.set('start_date', dateStr);
  url.searchParams.set('end_date',   dateStr);
  url.searchParams.set('hourly', 'temperature_2m,precipitation,windspeed_10m,winddirection_10m,weathercode');
  url.searchParams.set('timezone', 'UTC');
  url.searchParams.set('wind_speed_unit', 'ms');

  let weather;
  try {
    const res = await fetch(url.toString());
    check('Open-Meteo HTTP 200', res.ok, { status: res.status });
    const data = await res.json();
    const idx = Math.min(hour, data.hourly.time.length - 1);
    weather = {
      wind_speed_ms:      data.hourly.windspeed_10m[idx],
      wind_direction_deg: data.hourly.winddirection_10m[idx],
      precipitation_mm:   data.hourly.precipitation[idx],
      temperature_c:      data.hourly.temperature_2m[idx],
      weather_code:       data.hourly.weathercode[idx],
    };
    check('wind_speed_ms present',     typeof weather.wind_speed_ms === 'number',      { wind_speed_ms: weather.wind_speed_ms });
    check('wind_direction_deg present', typeof weather.wind_direction_deg === 'number', { wind_direction_deg: weather.wind_direction_deg });
    check('precipitation_mm present',  typeof weather.precipitation_mm === 'number',   { precipitation_mm: weather.precipitation_mm });
    check('temperature_c present',     typeof weather.temperature_c === 'number',      { temperature_c: weather.temperature_c });
    check('temperature plausible',     weather.temperature_c > -30 && weather.temperature_c < 50);
    check('wind_speed plausible',      weather.wind_speed_ms >= 0 && weather.wind_speed_ms < 100);
  } catch (e) {
    check('Open-Meteo fetch succeeded', false, { error: e.message });
    process.exit(1);
  }

  // ── Step 2: Write to Spatial Memory ───────────────────────────────────
  console.log('\n── Step 2: Write weather context to Spatial Memory ──────────────────────');

  const geometryId = `weather-${ROME_H3}-${dateStr}`;
  const metadata = {
    weather_context: {
      ...weather,
      h3_cell: ROME_H3, lat, lon,
      timestamp: TIMESTAMP,
      data_source: 'open-meteo-era5',
      model_id: 'open-meteo-era5',
      model_version: '1.0.0',
    },
  };

  const { data: stored, error: storeErr } = await supabase.rpc('geiant_store_geometry', {
    p_geometry_id: geometryId,
    p_geojson:     JSON.stringify({ type: 'Point', coordinates: [lon, lat] }),
    p_h3_cells:    [ROME_H3],
    p_source:      'phase4-3-e2e-test',
    p_checksum:    'weather-' + geometryId.slice(0, 8),
    p_metadata:    metadata,
  });
  check('geometry_store succeeded', !storeErr, storeErr?.message || 'ok');
  check('row stored',               !!stored);

  // ── Step 3: Verify retrieval ───────────────────────────────────────────
  console.log('\n── Step 3: Verify retrieval from Spatial Memory ─────────────────────────');

  const { data: rows, error: fetchErr } = await supabase
    .from('geiant_geometry_state')
    .select('geometry_id, metadata, valid_from')
    .eq('geometry_id', geometryId)
    .order('valid_from', { ascending: false })
    .limit(1);

  check('retrieval succeeded',       !fetchErr,          fetchErr?.message || 'ok');
  check('row returned',              rows?.length === 1, { count: rows?.length });

  const wc = rows?.[0]?.metadata?.weather_context;
  check('weather_context in metadata', !!wc);
  check('wind_speed_ms in chain',      typeof wc?.wind_speed_ms === 'number',     { got: wc?.wind_speed_ms });
  check('precipitation_mm in chain',   typeof wc?.precipitation_mm === 'number',  { got: wc?.precipitation_mm });
  check('temperature_c in chain',      typeof wc?.temperature_c === 'number',     { got: wc?.temperature_c });
  check('h3_cell matches',             wc?.h3_cell === ROME_H3);
  check('data_source is era5',         wc?.data_source === 'open-meteo-era5',     { got: wc?.data_source });

  // ── Results ────────────────────────────────────────────────────────────
  console.log(`\n── Results ───────────────────────────────────────────────────────────────`);
  console.log(`   ✓ ${passed} passed   ✗ ${failed} failed`);

  if (failed === 0) {
    console.log('\n🟢 Sub-phase 4.3 COMPLETE — Weather context verified');
    console.log('   Full GEIANT Perception Layer operational:');
    console.log('   4.0 ✅ Tile pipeline');
    console.log('   4.1 ✅ Prithvi flood classification');
    console.log('   4.2 ✅ Clay embeddings (1024-dim)');
    console.log('   4.3 ✅ Weather context (Open-Meteo ERA5)');
    console.log('\n   Next: Phase 5 — Full GEIANT Runtime');
  } else {
    process.exit(1);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
