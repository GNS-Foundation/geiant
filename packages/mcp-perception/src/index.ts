/**
 * @geiant/mcp-perception
 * GEIANT Perception Layer MCP Server
 *
 * Sub-phase 4.0 — Tile Pipeline       ✓ COMPLETE
 *   perception_fetch_tile
 *
 * Sub-phase 4.1 — Classification      ✓ COMPLETE
 *   perception_classify → Prithvi-EO-2.0-300M-TL-Sen1Floods11
 *
 * Sub-phase 4.2 — perception_embed    ⏳ Clay v1.5
 * Sub-phase 4.3 — perception_weather  ✓ COMPLETE (Open-Meteo ERA5)
 *
 * Phase 5.1.2 — Audit Middleware      ✓ WIRED
 *   Every tool call drops a signed virtual breadcrumb to Supabase
 *   via @geiant/mcp-audit AuditEngine. Breadcrumbs chain back to
 *   the human principal via Ed25519 delegation certificate.
 *
 * Env vars required:
 *   PRITHVI_ENDPOINT_URL, HF_TOKEN — RunPod inference
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — Spatial Memory
 *   GEIANT_SUPABASE_URL, GEIANT_SUPABASE_SERVICE_KEY — Audit trail (can be same Supabase)
 *   GEIANT_AGENT_SK — Agent Ed25519 secret key (128 hex)
 *   GEIANT_DELEGATION_CERT — Delegation certificate JSON
 *   GEIANT_DEFAULT_FACET — e.g. "energy@italy-geiant"
 *   GEIANT_DEFAULT_H3_CELL — e.g. "851e8053fffffff"
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import { z } from 'zod';
import { cellToBoundary, getResolution, latLngToCell } from 'h3-js';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Phase 5.1.2 — Audit Engine Import
// ---------------------------------------------------------------------------

import { AuditEngine } from '@geiant/mcp-audit/middleware';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PC_STAC_URL = 'https://planetarycomputer.microsoft.com/api/stac/v1';
const PC_SIGN_URL = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign';

// Env vars (set in Railway for the deployed service)
const PRITHVI_ENDPOINT_URL = process.env.PRITHVI_ENDPOINT_URL ?? '';
const HF_TOKEN = process.env.HF_TOKEN ?? '';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// Sentinel-2 L2A bands — order must match Prithvi training config
// Blue, Green, Red, Narrow NIR, SWIR1, SWIR2
const REQUIRED_BANDS = ['B02', 'B03', 'B04', 'B8A', 'B11', 'B12'] as const;
type Band = typeof REQUIRED_BANDS[number];

// ---------------------------------------------------------------------------
// Supabase client (lazy — only instantiated if SUPABASE_URL is set)
// ---------------------------------------------------------------------------

function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StacItem {
  id: string;
  properties: {
    datetime: string;
    'eo:cloud_cover': number;
    platform: string;
    [key: string]: any;
  };
  assets: Record<string, { href: string; type?: string }>;
  bbox: [number, number, number, number];
}

interface TileResult {
  tile_id: string;
  collection: string;
  platform: string;
  acquisition_datetime: string;
  cloud_cover_pct: number;
  bbox: { west: number; south: number; east: number; north: number };
  h3_cell: string;
  h3_resolution: number;
  bands: Record<Band, string>;
  stac_item_url: string;
  status: 'ok' | 'no_tile_found' | 'error';
  message?: string;
}

interface ClassifyResult {
  perception_chain: {
    h3_cell: string;
    tile_id: string;
    acquisition_datetime: string;
    model_id: string;
    model_version: string;
    confidence: number;
    agent_note: string;
  };
  dominant_class: 'no_flood' | 'flood' | 'cloud_nodata';
  flood_pixel_pct: number;
  confidence: number;
  mask_shape: [number, number];
  class_counts: {
    no_flood: number;
    flood: number;
    cloud_nodata: number;
  };
  geometry_state_id: string | null;
  spatial_memory_written: boolean;
  status: 'ok' | 'endpoint_unavailable' | 'error';
  message?: string;
}

interface WeatherResult {
  h3_cell: string;
  lat: number;
  lon: number;
  timestamp: string;
  wind_speed_ms: number;
  wind_direction_deg: number;
  precipitation_mm: number;
  temperature_c: number;
  weather_code: number;
  data_source: string;
  geometry_state_id: string | null;
  spatial_memory_written: boolean;
  status: 'ok' | 'error';
  message?: string;
}

// ---------------------------------------------------------------------------
// In-memory tile cache: tile_id → TileResult
// ---------------------------------------------------------------------------

const tileCache = new Map<string, TileResult>();

// ---------------------------------------------------------------------------
// H3 → bounding box
// ---------------------------------------------------------------------------

function h3ToBbox(h3Cell: string): [number, number, number, number] {
  const boundary = cellToBoundary(h3Cell);
  const lons = boundary.map(([lat, lng]) => lng);
  const lats = boundary.map(([lat, lng]) => lat);
  return [
    Math.min(...lons),
    Math.min(...lats),
    Math.max(...lons),
    Math.max(...lats),
  ];
}

// ---------------------------------------------------------------------------
// Planetary Computer helpers
// ---------------------------------------------------------------------------

async function searchTile(
  bbox: [number, number, number, number],
  datetimeRange: string,
  maxCloudCover: number,
): Promise<StacItem | null> {
  const res = await fetch(`${PC_STAC_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collections: ['sentinel-2-l2a'],
      bbox,
      datetime: datetimeRange,
      query: { 'eo:cloud_cover': { lt: maxCloudCover } },
      sortby: [{ field: 'properties.eo:cloud_cover', direction: 'asc' }],
      limit: 5,
    }),
  });
  if (!res.ok) throw new Error(`STAC search failed: ${res.status}`);
  const data = await res.json() as { features: StacItem[] };
  return data.features?.[0] ?? null;
}

async function signUrl(href: string): Promise<string> {
  try {
    const res = await fetch(`${PC_SIGN_URL}?href=${encodeURIComponent(href)}`);
    if (!res.ok) return href;
    const data = await res.json() as { href: string };
    return data.href ?? href;
  } catch { return href; }
}

async function signBandUrls(item: StacItem): Promise<Record<Band, string>> {
  const result = {} as Record<Band, string>;
  for (const band of REQUIRED_BANDS) {
    const asset = item.assets[band];
    if (!asset) throw new Error(`Band ${band} not found in STAC item ${item.id}`);
    result[band] = await signUrl(asset.href);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tool implementation: perception_fetch_tile
// ---------------------------------------------------------------------------

async function fetchTile(params: {
  h3_cell: string;
  timestamp?: string;
  max_cloud_cover?: number;
  days_back?: number;
}): Promise<TileResult> {
  const { h3_cell, max_cloud_cover = 20, days_back = 30 } = params;

  let bbox: [number, number, number, number];
  let resolution: number;
  try {
    bbox = h3ToBbox(h3_cell);
    resolution = getResolution(h3_cell);
  } catch (err) {
    return {
      tile_id: '', collection: 'sentinel-2-l2a', platform: '',
      acquisition_datetime: '', cloud_cover_pct: 0,
      bbox: { west: 0, south: 0, east: 0, north: 0 },
      h3_cell, h3_resolution: -1, bands: {} as Record<Band, string>,
      stac_item_url: '', status: 'error', message: `Invalid H3 cell: ${err}`,
    };
  }

  const endDate = params.timestamp ? new Date(params.timestamp) : new Date();
  const startDate = new Date(endDate.getTime() - days_back * 86_400_000);
  const datetimeRange = `${startDate.toISOString()}/${endDate.toISOString()}`;

  let item: StacItem | null;
  try {
    item = await searchTile(bbox, datetimeRange, max_cloud_cover);
  } catch (err) {
    return {
      tile_id: '', collection: 'sentinel-2-l2a', platform: '',
      acquisition_datetime: '', cloud_cover_pct: 0,
      bbox: { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] },
      h3_cell, h3_resolution: resolution, bands: {} as Record<Band, string>,
      stac_item_url: '', status: 'error', message: `STAC search error: ${err}`,
    };
  }

  if (!item) {
    return {
      tile_id: '', collection: 'sentinel-2-l2a', platform: '',
      acquisition_datetime: '', cloud_cover_pct: 0,
      bbox: { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] },
      h3_cell, h3_resolution: resolution, bands: {} as Record<Band, string>,
      stac_item_url: '', status: 'no_tile_found',
      message: `No tile with cloud cover < ${max_cloud_cover}% in last ${days_back} days`,
    };
  }

  let bands: Record<Band, string>;
  try {
    bands = await signBandUrls(item);
  } catch (err) {
    return {
      tile_id: item.id, collection: 'sentinel-2-l2a',
      platform: item.properties.platform,
      acquisition_datetime: item.properties.datetime,
      cloud_cover_pct: item.properties['eo:cloud_cover'],
      bbox: { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] },
      h3_cell, h3_resolution: resolution, bands: {} as Record<Band, string>,
      stac_item_url: `${PC_STAC_URL}/collections/sentinel-2-l2a/items/${item.id}`,
      status: 'error', message: `Band URL signing failed: ${err}`,
    };
  }

  const result: TileResult = {
    tile_id: item.id,
    collection: 'sentinel-2-l2a',
    platform: item.properties.platform,
    acquisition_datetime: item.properties.datetime,
    cloud_cover_pct: item.properties['eo:cloud_cover'],
    bbox: { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] },
    h3_cell,
    h3_resolution: resolution,
    bands,
    stac_item_url: `${PC_STAC_URL}/collections/sentinel-2-l2a/items/${item.id}`,
    status: 'ok',
  };

  tileCache.set(item.id, result);
  return result;
}

// ---------------------------------------------------------------------------
// Tool implementation: perception_classify
// ---------------------------------------------------------------------------

async function classifyTile(params: {
  tile_id: string;
  h3_cell?: string;
  task: 'flood' | 'landcover' | 'burnscar' | 'anomaly';
  write_to_spatial_memory?: boolean;
}): Promise<ClassifyResult> {
  const { tile_id, task, write_to_spatial_memory = true } = params;

  if (!PRITHVI_ENDPOINT_URL) {
    return {
      perception_chain: {
        h3_cell: params.h3_cell ?? '', tile_id,
        acquisition_datetime: '',
        model_id: 'Prithvi-EO-2.0-300M-TL-Sen1Floods11',
        model_version: '1.0.0', confidence: 0,
        agent_note: 'endpoint not configured',
      },
      dominant_class: 'no_flood', flood_pixel_pct: 0, confidence: 0,
      mask_shape: [0, 0],
      class_counts: { no_flood: 0, flood: 0, cloud_nodata: 0 },
      geometry_state_id: null, spatial_memory_written: false,
      status: 'endpoint_unavailable',
      message: 'PRITHVI_ENDPOINT_URL env var not set.',
    };
  }

  const tile = tileCache.get(tile_id);
  if (!tile) {
    return {
      perception_chain: {
        h3_cell: params.h3_cell ?? '', tile_id,
        acquisition_datetime: '',
        model_id: 'Prithvi-EO-2.0-300M-TL-Sen1Floods11',
        model_version: '1.0.0', confidence: 0,
        agent_note: 'tile not in cache',
      },
      dominant_class: 'no_flood', flood_pixel_pct: 0, confidence: 0,
      mask_shape: [0, 0],
      class_counts: { no_flood: 0, flood: 0, cloud_nodata: 0 },
      geometry_state_id: null, spatial_memory_written: false,
      status: 'error',
      message: `tile_id ${tile_id} not found in session cache. Call perception_fetch_tile first.`,
    };
  }

  const h3_cell = params.h3_cell ?? tile.h3_cell;

  let inferenceResult: {
    dominant_class: 'no_flood' | 'flood' | 'cloud_nodata';
    flood_pixel_pct: number;
    confidence: number;
    mask_shape: [number, number];
    class_counts: { no_flood: number; flood: number; cloud_nodata: number };
    model_id: string;
    model_version: string;
  };

  try {
    const endpointUrl = PRITHVI_ENDPOINT_URL.replace('/runsync', '/run');

    const { default: proj4 } = await import('proj4');
    const epsg = (tile as any).properties?.['proj:epsg'] ?? 32632;

    let projString: string;
    if (epsg >= 32601 && epsg <= 32660) {
      projString = `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`;
    } else if (epsg >= 32701 && epsg <= 32760) {
      projString = `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`;
    } else {
      projString = `+init=epsg:${epsg}`;
    }

    const [west, south] = proj4('WGS84', projString, [tile.bbox.west, tile.bbox.south]);
    const [east, north] = proj4('WGS84', projString, [tile.bbox.east, tile.bbox.north]);

    const endpointRes = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HF_TOKEN}`,
      },
      body: JSON.stringify({
        input: {
          bands: tile.bands,
          bbox: { west, south, east, north },
          chip_size: 512,
          confidence_threshold: 0.5,
        }
      }),
      signal: AbortSignal.timeout(300_000),
    });

    if (!endpointRes.ok) {
      const errText = await endpointRes.text();
      throw new Error(`RunPod endpoint HTTP ${endpointRes.status}: ${errText}`);
    }

    const initialResult = await endpointRes.json();
    const jobId = initialResult.id;

    if (!jobId) {
      throw new Error(`RunPod did not return a jobId: ${JSON.stringify(initialResult)}`);
    }

    let runpodResult: any = null;
    const startTime = Date.now();

    while (true) {
      if (Date.now() - startTime > 300_000) {
        throw new Error('RunPod polling timed out after 5 minutes.');
      }

      const statusRes = await fetch(`${endpointUrl.replace('/run', '/status')}/${jobId}`, {
        headers: { 'Authorization': `Bearer ${HF_TOKEN}` }
      });

      if (!statusRes.ok) {
        throw new Error(`RunPod status HTTP ${statusRes.status}`);
      }

      const statusData = await statusRes.json();

      if (statusData.status === 'COMPLETED') {
        runpodResult = statusData;
        break;
      } else if (statusData.status === 'FAILED') {
        throw new Error(`RunPod job failed: ${statusData.error || JSON.stringify(statusData)}`);
      }

      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    inferenceResult = runpodResult.output ?? runpodResult;

  } catch (err) {
    return {
      perception_chain: {
        h3_cell, tile_id,
        acquisition_datetime: tile.acquisition_datetime,
        model_id: 'Prithvi-EO-2.0-300M-TL-Sen1Floods11',
        model_version: '1.0.0', confidence: 0,
        agent_note: 'inference failed',
      },
      dominant_class: 'no_flood', flood_pixel_pct: 0, confidence: 0,
      mask_shape: [0, 0],
      class_counts: { no_flood: 0, flood: 0, cloud_nodata: 0 },
      geometry_state_id: null, spatial_memory_written: false,
      status: 'error',
      message: `Prithvi inference failed: ${err}`,
    };
  }

  const perceptionChain = {
    h3_cell, tile_id,
    acquisition_datetime: tile.acquisition_datetime,
    model_id: inferenceResult.model_id ?? 'Prithvi-EO-2.0-300M-TL-Sen1Floods11',
    model_version: inferenceResult.model_version ?? '1.0.0',
    confidence: inferenceResult.confidence,
    agent_note: `flood classification via Sen1Floods11 fine-tune; task=${task}`,
  };

  let geometryStateId: string | null = null;
  let spatialMemoryWritten = false;

  if (write_to_spatial_memory) {
    const supabase = getSupabase();
    if (supabase) {
      try {
        const bbox = tile.bbox;
        const centerLon = (bbox.west + bbox.east) / 2;
        const centerLat = (bbox.south + bbox.north) / 2;

        const geometryId = `perception-${h3_cell}-${tile_id}`;
        const metadata = {
          perception_chain: perceptionChain,
          classification: {
            dominant_class: inferenceResult.dominant_class,
            flood_pixel_pct: inferenceResult.flood_pixel_pct,
            class_counts: inferenceResult.class_counts,
          },
          stac_item_url: tile.stac_item_url,
          platform: tile.platform,
          cloud_cover_pct: tile.cloud_cover_pct,
        };

        const checksum = createHash('sha256')
          .update(JSON.stringify(metadata))
          .digest('hex');

        const { data: stored, error } = await supabase.rpc(
          'geiant_store_geometry',
          {
            p_geometry_id: geometryId,
            p_geojson: JSON.stringify({ type: 'Point', coordinates: [centerLon, centerLat] }),
            p_h3_cells: [h3_cell],
            p_source: 'mcp-perception/perception_classify',
            p_checksum: checksum,
            p_metadata: metadata,
          }
        );

        if (error) {
          console.error('⚠️  Spatial Memory write failed:', error.message);
        } else {
          geometryStateId = stored ?? geometryId;
          spatialMemoryWritten = true;
          console.error(`✅  Perception chain written to Spatial Memory: ${geometryStateId}`);
        }
      } catch (err) {
        console.error('⚠️  Spatial Memory write exception:', err);
      }
    }
  }

  return {
    perception_chain: perceptionChain,
    dominant_class: inferenceResult.dominant_class,
    flood_pixel_pct: inferenceResult.flood_pixel_pct,
    confidence: inferenceResult.confidence,
    mask_shape: inferenceResult.mask_shape,
    class_counts: inferenceResult.class_counts,
    geometry_state_id: geometryStateId,
    spatial_memory_written: spatialMemoryWritten,
    status: 'ok',
  };
}

// ---------------------------------------------------------------------------
// Tool implementation: perception_weather (Open-Meteo ERA5 reanalysis)
// ---------------------------------------------------------------------------

async function fetchWeather(params: {
  h3_cell: string;
  timestamp?: string;
  write_to_spatial_memory?: boolean;
}): Promise<WeatherResult> {
  const { h3_cell, write_to_spatial_memory = true } = params;

  const { cellToLatLng } = await import('h3-js');
  const [lat, lon] = cellToLatLng(h3_cell);

  const dt = params.timestamp ? new Date(params.timestamp) : new Date();
  const dateStr = dt.toISOString().slice(0, 10);
  const hour = dt.getUTCHours();

  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude',  lat.toFixed(6));
  url.searchParams.set('longitude', lon.toFixed(6));
  url.searchParams.set('start_date', dateStr);
  url.searchParams.set('end_date',   dateStr);
  url.searchParams.set('hourly', [
    'temperature_2m', 'precipitation', 'windspeed_10m',
    'winddirection_10m', 'weathercode',
  ].join(','));
  url.searchParams.set('timezone', 'UTC');
  url.searchParams.set('wind_speed_unit', 'ms');

  let weatherData: {
    temperature_2m: number;
    precipitation: number;
    windspeed_10m: number;
    winddirection_10m: number;
    weathercode: number;
  };

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const data = await res.json() as {
      hourly: {
        time: string[];
        temperature_2m: number[];
        precipitation: number[];
        windspeed_10m: number[];
        winddirection_10m: number[];
        weathercode: number[];
      };
    };
    const idx = Math.min(hour, data.hourly.time.length - 1);
    weatherData = {
      temperature_2m:    data.hourly.temperature_2m[idx]    ?? 0,
      precipitation:     data.hourly.precipitation[idx]     ?? 0,
      windspeed_10m:     data.hourly.windspeed_10m[idx]     ?? 0,
      winddirection_10m: data.hourly.winddirection_10m[idx] ?? 0,
      weathercode:       data.hourly.weathercode[idx]       ?? 0,
    };
  } catch (err) {
    return {
      h3_cell, lat, lon, timestamp: dt.toISOString(),
      wind_speed_ms: 0, wind_direction_deg: 0,
      precipitation_mm: 0, temperature_c: 0, weather_code: 0,
      data_source: 'open-meteo-era5',
      geometry_state_id: null, spatial_memory_written: false,
      status: 'error', message: `Open-Meteo fetch failed: ${err}`,
    };
  }

  const result: WeatherResult = {
    h3_cell, lat, lon,
    timestamp: dt.toISOString(),
    wind_speed_ms:     Math.round(weatherData.windspeed_10m * 100) / 100,
    wind_direction_deg: weatherData.winddirection_10m,
    precipitation_mm:  weatherData.precipitation,
    temperature_c:     weatherData.temperature_2m,
    weather_code:      weatherData.weathercode,
    data_source:       'open-meteo-era5',
    geometry_state_id: null,
    spatial_memory_written: false,
    status: 'ok',
  };

  if (write_to_spatial_memory) {
    const supabase = getSupabase();
    if (supabase) {
      try {
        const geometryId = `weather-${h3_cell}-${dateStr}`;
        const metadata = {
          weather_context: {
            ...result,
            model_id: 'open-meteo-era5',
            model_version: '1.0.0',
          },
        };
        const checksum = createHash('sha256')
          .update(JSON.stringify(metadata))
          .digest('hex');

        const { data: stored, error } = await supabase.rpc('geiant_store_geometry', {
          p_geometry_id: geometryId,
          p_geojson: JSON.stringify({ type: 'Point', coordinates: [lon, lat] }),
          p_h3_cells: [h3_cell],
          p_source: 'mcp-perception/perception_weather',
          p_checksum: checksum,
          p_metadata: metadata,
        });

        if (!error) {
          result.geometry_state_id = stored ?? geometryId;
          result.spatial_memory_written = true;
        }
      } catch (_) { /* non-fatal */ }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Phase 5.1.2 — Audit Engine Setup
// ---------------------------------------------------------------------------

let auditEngine: AuditEngine | null = null;

function getAuditEngine(): AuditEngine | null {
  if (auditEngine) return auditEngine;

  // All four env vars must be present to enable auditing
  const sk   = process.env.GEIANT_AGENT_SK;
  const cert = process.env.GEIANT_DELEGATION_CERT;
  const url  = process.env.GEIANT_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key  = process.env.GEIANT_SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!sk || !cert || !url || !key) {
    return null;  // Audit disabled — tools still work, just no breadcrumbs
  }

  try {
    auditEngine = new AuditEngine({
      supabaseUrl: url,
      supabaseServiceKey: key,
      agentSecretKeyHex: sk,
      delegationCertificate: JSON.parse(cert),
      defaultFacet: process.env.GEIANT_DEFAULT_FACET ?? 'energy@italy-geiant',
      defaultLocationCell: process.env.GEIANT_DEFAULT_H3_CELL ?? '851e8053fffffff',
      defaultLocationResolution: parseInt(process.env.GEIANT_DEFAULT_H3_RES ?? '5', 10),
    });
    return auditEngine;
  } catch (err) {
    console.error('⚠️  Audit engine init failed (tools will run without audit):', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

function buildServer(): McpServer {
  const srv = new McpServer({
    name: 'geiant-perception',
    version: '0.3.0',  // Bumped for Phase 5.1.2 audit integration
  });

  // Try to get audit engine (may be null if env vars not set)
  const audit = getAuditEngine();

  // ── Wrap handlers with audit middleware (if available) ───────────────────
  // If audit is null, we use the raw handlers — no breadcrumbs, but tools work.
  // This means the service degrades gracefully: no audit config = no audit trail,
  // but all perception tools remain fully functional.

  const auditedFetchTile = audit
    ? audit.wrapTool('perception_fetch_tile', fetchTile, {
        locationCell: (input: any) => input.h3_cell ?? '851e8053fffffff',
      })
    : fetchTile;

  const auditedClassifyTile = audit
    ? audit.wrapTool('perception_classify', classifyTile, {
        locationCell: (input: any) => input.h3_cell ?? tileCache.get(input.tile_id)?.h3_cell ?? '851e8053fffffff',
        modelId: 'prithvi-eo-2.0',
        runpodEndpoint: 'o7emejiwlumgj6',
      })
    : classifyTile;

  const auditedFetchWeather = audit
    ? audit.wrapTool('perception_weather', fetchWeather, {
        locationCell: (input: any) => input.h3_cell ?? '851e8053fffffff',
      })
    : fetchWeather;

  // ── perception_fetch_tile ────────────────────────────────────────────────
  srv.tool(
    'perception_fetch_tile',
    'Fetch the least-cloudy Sentinel-2 L2A tile covering a given H3 cell from ' +
    'Microsoft Planetary Computer. Returns signed COG band URLs for all 6 ' +
    'Prithvi/Clay spectral bands (B02 Blue, B03 Green, B04 Red, B8A NIR, ' +
    'B11 SWIR1, B12 SWIR2), plus tile metadata. The tile is cached in memory ' +
    'for subsequent perception_classify or perception_embed calls.',
    {
      h3_cell: z.string().describe('H3 cell ID at any resolution.'),
      timestamp: z.string().optional().describe(
        'ISO 8601 datetime. Search back from this point. Defaults to now.'
      ),
      max_cloud_cover: z.number().min(0).max(100).optional().describe(
        'Max cloud cover %. Default: 20.'
      ),
      days_back: z.number().min(1).max(365).optional().describe(
        'Days to search back. Default: 30.'
      ),
    },
    async (params) => {
      const result = await auditedFetchTile(params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── perception_classify ──────────────────────────────────────────────────
  srv.tool(
    'perception_classify',
    'Run Prithvi-EO-2.0-300M-TL-Sen1Floods11 flood classification on a Sentinel-2 ' +
    'tile previously fetched by perception_fetch_tile. Sends the 6-band chip to a ' +
    'RunPod endpoint and returns: dominant_class, flood_pixel_pct, confidence, ' +
    'class_counts, and the full perception_chain. The perception chain is written ' +
    'to Spatial Memory and a signed audit breadcrumb is dropped to the agent trail.',
    {
      tile_id: z.string().describe(
        'tile_id from perception_fetch_tile result (must be in session cache).'
      ),
      task: z.enum(['flood', 'landcover', 'burnscar', 'anomaly']).describe(
        'Classification task. Currently only "flood" is supported.'
      ),
      h3_cell: z.string().optional().describe(
        'Override H3 cell. Defaults to the cell from the original fetch.'
      ),
      write_to_spatial_memory: z.boolean().optional().describe(
        'Write perception chain to geiant_geometry_state. Default: true.'
      ),
    },
    async (params) => {
      const result = await auditedClassifyTile(params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── perception_embed  (Sub-phase 4.2 — stub, no audit yet) ──────────────
  srv.tool(
    'perception_embed',
    '[Sub-phase 4.2 — NOT YET IMPLEMENTED] Will generate Clay v1.5 embeddings.',
    {
      tile_id: z.string().describe('tile_id from perception_fetch_tile result'),
    },
    async () => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'not_implemented',
          message: 'perception_embed will be available in Sub-phase 4.2.',
        }),
      }],
    }),
  );

  // ── perception_weather ──────────────────────────────────────────────────
  srv.tool(
    'perception_weather',
    'Query atmospheric conditions for an H3 cell at a given timestamp from ' +
    'Open-Meteo ERA5. Returns wind, precipitation, temperature. Writes to ' +
    'Spatial Memory and drops a signed audit breadcrumb.',
    {
      h3_cell: z.string().describe('H3 cell ID at any resolution.'),
      timestamp: z.string().optional().describe(
        'ISO 8601 datetime for weather lookup. Defaults to now.'
      ),
      write_to_spatial_memory: z.boolean().optional().describe(
        'Write weather context to geiant_geometry_state. Default: true.'
      ),
    },
    async ({ h3_cell, timestamp, write_to_spatial_memory = true }) => {
      const result = await auditedFetchWeather({ h3_cell, timestamp, write_to_spatial_memory });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  return srv;
}

// ---------------------------------------------------------------------------
// Bootstrap — HTTP/SSE Transport for Railway deployment
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main() {
  const prithviReady = !!PRITHVI_ENDPOINT_URL;
  const audit = getAuditEngine();
  const auditStatus = audit
    ? '✓ audit trail active'
    : '⚠️ audit disabled (set GEIANT_AGENT_SK + GEIANT_DELEGATION_CERT)';

  console.error('🛰️  GEIANT mcp-perception v0.3.0 starting');
  console.error(`   perception_fetch_tile  ✓ live`);
  console.error(`   perception_classify    ${prithviReady ? '✓ live' : '⏳ waiting for PRITHVI_ENDPOINT_URL'}`);
  console.error(`   perception_embed       ⏳ sub-phase 4.2`);
  console.error(`   perception_weather     ✓ live`);
  console.error(`   🔗 ${auditStatus}`);

  if (audit) {
    try {
      await audit.init();
      console.error(`   🍞 Agent PK: ${audit.agentPublicKey.substring(0, 16)}...`);
      console.error(`   📜 Cert hash: ${audit.delegationCertificateHash.substring(0, 16)}...`);
      console.error(`   📊 Chain tip: block #${audit.chainTip.index}`);
    } catch (err) {
      console.error(`   ⚠️  Audit init failed: ${err}`);
    }
  }

  const srv = buildServer();
  const app = express();

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'geiant-mcp-perception',
      version: '0.3.0',
      audit_active: !!audit,
      agent_pk: audit?.agentPublicKey?.substring(0, 16) ?? null,
      chain_tip: audit?.chainTip?.index ?? null,
      tools: ['perception_fetch_tile', 'perception_classify', 'perception_embed', 'perception_weather'],
    });
  });

  // Test endpoint — triggers weather + audit breadcrumb directly
  app.get('/test/weather', async (_req, res) => {
    try {
      const engine = getAuditEngine();
      const wrapped = engine
        ? engine.wrapTool('perception_weather', fetchWeather, {
            locationCell: () => '851e8053fffffff',
          })
        : fetchWeather;
      const result = await wrapped({
        h3_cell: '851e8053fffffff',
        timestamp: '2026-03-15T12:00:00Z',
        write_to_spatial_memory: false,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // SSE transport: one MCP session per client connection
  const sessions = new Map<string, SSEServerTransport>();

  app.get('/sse', (req, res) => {
    const transport = new SSEServerTransport('/message', res);
    const sessionId = transport.sessionId;
    sessions.set(sessionId, transport);

    console.error(`🔌 SSE client connected: ${sessionId}`);

    res.on('close', () => {
      sessions.delete(sessionId);
      console.error(`🔌 SSE client disconnected: ${sessionId}`);
    });

    srv.connect(transport).catch((err: any) => {
      console.error(`💥 MCP connect error: ${err}`);
    });
  });

  app.post('/message', express.json(), (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = sessions.get(sessionId);

    if (!transport) {
      res.status(400).json({ error: 'Unknown session. Connect via GET /sse first.' });
      return;
    }

    transport.handlePostMessage(req, res);
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.error(`✅  mcp-perception listening on port ${PORT}`);
    console.error(`   SSE:     GET  http://0.0.0.0:${PORT}/sse`);
    console.error(`   Message: POST http://0.0.0.0:${PORT}/message`);
    console.error(`   Health:  GET  http://0.0.0.0:${PORT}/health`);
  });
}

main().catch((err) => {
  console.error('💥  mcp-perception fatal:', err);
  process.exit(1);
});
