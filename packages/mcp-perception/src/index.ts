/**
 * @geiant/mcp-perception
 * GEIANT Perception Layer MCP Server
 *
 * Sub-phase 4.0 — Tile Pipeline
 *   perception_fetch_tile  ← implemented now (no GPU required)
 *
 * Sub-phase 4.1 — perception_classify  (Prithvi-EO-2.0, TODO)
 * Sub-phase 4.2 — perception_embed     (Clay v1.5, TODO)
 * Sub-phase 4.3 — perception_weather   (Prithvi-WxC, TODO)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { cellToBoundary, getResolution } from 'h3-js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PC_STAC_URL  = 'https://planetarycomputer.microsoft.com/api/stac/v1';
const PC_SIGN_URL  = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign';

// Sentinel-2 L2A bands required by Prithvi-EO-2.0 and Clay
// B02=Blue  B03=Green  B04=Red  B8A=Narrow NIR  B11=SWIR1  B12=SWIR2
const REQUIRED_BANDS = ['B02', 'B03', 'B04', 'B8A', 'B11', 'B12'] as const;
type Band = typeof REQUIRED_BANDS[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StacItem {
  id: string;
  properties: {
    datetime: string;
    'eo:cloud_cover': number;
    'platform': string;
  };
  assets: Record<string, { href: string; type?: string }>;
  bbox: [number, number, number, number];
  geometry: {
    type: string;
    coordinates: number[][][];
  };
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
  bands: Record<Band, string>;   // band → signed COG URL
  stac_item_url: string;
  status: 'ok' | 'no_tile_found' | 'error';
  message?: string;
}

// ---------------------------------------------------------------------------
// H3 → bounding box
// ---------------------------------------------------------------------------

function h3ToBbox(h3Cell: string): [number, number, number, number] {
  // cellToBoundary returns [lat, lng] pairs — flip to [lng, lat] for GeoJSON
  const boundary = cellToBoundary(h3Cell);
  const lons = boundary.map(([lat, lng]) => lng);
  const lats = boundary.map(([lat, lng]) => lat);
  return [
    Math.min(...lons), // west
    Math.min(...lats), // south
    Math.max(...lons), // east
    Math.max(...lats), // north
  ];
}

// ---------------------------------------------------------------------------
// Planetary Computer — search for least-cloudy Sentinel-2 tile
// ---------------------------------------------------------------------------

async function searchTile(
  bbox: [number, number, number, number],
  datetimeRange: string,
  maxCloudCover: number,
): Promise<StacItem | null> {
  const body = {
    collections: ['sentinel-2-l2a'],
    bbox,
    datetime: datetimeRange,
    query: { 'eo:cloud_cover': { lt: maxCloudCover } },
    sortby: [{ field: 'eo:cloud_cover', direction: 'asc' }],
    limit: 5,
  };

  const res = await fetch(`${PC_STAC_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`STAC search failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { features: StacItem[] };
  if (!data.features || data.features.length === 0) return null;

  // Return least cloudy (already sorted)
  return data.features[0];
}

// ---------------------------------------------------------------------------
// Planetary Computer — sign asset URLs for access
// PC public data works without signing, but signing gives better rate limits
// ---------------------------------------------------------------------------

async function signUrl(href: string): Promise<string> {
  try {
    const res = await fetch(`${PC_SIGN_URL}?href=${encodeURIComponent(href)}`);
    if (!res.ok) return href; // fall back to unsigned
    const data = await res.json() as { href: string };
    return data.href ?? href;
  } catch {
    return href; // fall back gracefully
  }
}

async function signBandUrls(item: StacItem): Promise<Record<Band, string>> {
  const result = {} as Record<Band, string>;

  for (const band of REQUIRED_BANDS) {
    const asset = item.assets[band];
    if (!asset) {
      throw new Error(`Band ${band} not found in STAC item ${item.id}`);
    }
    result[band] = await signUrl(asset.href);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tool: perception_fetch_tile
// ---------------------------------------------------------------------------

async function fetchTile(params: {
  h3_cell: string;
  timestamp?: string;
  max_cloud_cover?: number;
  days_back?: number;
}): Promise<TileResult> {
  const { h3_cell, max_cloud_cover = 20, days_back = 30 } = params;

  // 1. Validate H3 cell
  let bbox: [number, number, number, number];
  let resolution: number;
  try {
    bbox = h3ToBbox(h3_cell);
    resolution = getResolution(h3_cell);
  } catch (err) {
    return {
      tile_id: '',
      collection: 'sentinel-2-l2a',
      platform: '',
      acquisition_datetime: '',
      cloud_cover_pct: 0,
      bbox: { west: 0, south: 0, east: 0, north: 0 },
      h3_cell,
      h3_resolution: -1,
      bands: {} as Record<Band, string>,
      stac_item_url: '',
      status: 'error',
      message: `Invalid H3 cell: ${err}`,
    };
  }

  // 2. Build date range
  const endDate   = params.timestamp
    ? new Date(params.timestamp)
    : new Date();
  const startDate = new Date(endDate.getTime() - days_back * 86_400_000);
  const datetimeRange = `${startDate.toISOString().slice(0, 10)}/${endDate.toISOString().slice(0, 10)}`;

  // 3. Search Planetary Computer STAC
  let item: StacItem | null;
  try {
    item = await searchTile(bbox, datetimeRange, max_cloud_cover);
  } catch (err) {
    return {
      tile_id: '',
      collection: 'sentinel-2-l2a',
      platform: '',
      acquisition_datetime: '',
      cloud_cover_pct: 0,
      bbox: { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] },
      h3_cell,
      h3_resolution: resolution,
      bands: {} as Record<Band, string>,
      stac_item_url: '',
      status: 'error',
      message: `STAC search error: ${err}`,
    };
  }

  if (!item) {
    return {
      tile_id: '',
      collection: 'sentinel-2-l2a',
      platform: '',
      acquisition_datetime: '',
      cloud_cover_pct: 0,
      bbox: { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] },
      h3_cell,
      h3_resolution: resolution,
      bands: {} as Record<Band, string>,
      stac_item_url: '',
      status: 'no_tile_found',
      message: `No Sentinel-2 tile with cloud cover < ${max_cloud_cover}% found for ${h3_cell} in the last ${days_back} days`,
    };
  }

  // 4. Sign band URLs
  let bands: Record<Band, string>;
  try {
    bands = await signBandUrls(item);
  } catch (err) {
    return {
      tile_id: item.id,
      collection: 'sentinel-2-l2a',
      platform: item.properties.platform,
      acquisition_datetime: item.properties.datetime,
      cloud_cover_pct: item.properties['eo:cloud_cover'],
      bbox: { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] },
      h3_cell,
      h3_resolution: resolution,
      bands: {} as Record<Band, string>,
      stac_item_url: `${PC_STAC_URL}/collections/sentinel-2-l2a/items/${item.id}`,
      status: 'error',
      message: `Band URL signing failed: ${err}`,
    };
  }

  return {
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
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

function buildServer(): McpServer {
  const srv = new McpServer({
    name: 'geiant-perception',
    version: '0.1.0',
  });

  // ── perception_fetch_tile ────────────────────────────────────────────────
  srv.tool(
    'perception_fetch_tile',
    'Fetch the least-cloudy Sentinel-2 L2A tile covering a given H3 cell from ' +
    'Microsoft Planetary Computer. Returns signed COG band URLs for all 6 ' +
    'Prithvi/Clay spectral bands (B02 Blue, B03 Green, B04 Red, B8A NIR, ' +
    'B11 SWIR1, B12 SWIR2), plus tile metadata (tile_id, acquisition_datetime, ' +
    'cloud_cover_pct, bbox). Always call this first before perception_classify ' +
    'or perception_embed.',
    {
      h3_cell: z.string().describe(
        'H3 cell ID at any resolution. The bounding box is derived automatically.'
      ),
      timestamp: z.string().optional().describe(
        'ISO 8601 datetime. Search for tiles up to days_back before this point. ' +
        'Defaults to now.'
      ),
      max_cloud_cover: z.number().min(0).max(100).optional().describe(
        'Maximum cloud cover percentage (0–100). Default: 20.'
      ),
      days_back: z.number().min(1).max(365).optional().describe(
        'How many days back to search. Default: 30.'
      ),
    },
    async (params) => {
      const result = await fetchTile(params);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    },
  );

  // ── perception_classify  (Sub-phase 4.1 — stub) ─────────────────────────
  srv.tool(
    'perception_classify',
    '[Sub-phase 4.1 — NOT YET IMPLEMENTED] Will run Prithvi-EO-2.0 flood/land ' +
    'cover classification on a tile returned by perception_fetch_tile.',
    {
      tile_id: z.string().describe('tile_id from perception_fetch_tile result'),
      task: z.enum(['flood', 'landcover', 'burnscar', 'anomaly']),
    },
    async () => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'not_implemented',
          message: 'perception_classify will be available in Sub-phase 4.1 (Prithvi-EO-2.0 HuggingFace endpoint). Use perception_fetch_tile for now.',
        }),
      }],
    }),
  );

  // ── perception_embed  (Sub-phase 4.2 — stub) ────────────────────────────
  srv.tool(
    'perception_embed',
    '[Sub-phase 4.2 — NOT YET IMPLEMENTED] Will generate 768-dimensional Clay ' +
    'Foundation Model embeddings for a tile and store them in Spatial Memory.',
    {
      tile_id: z.string().describe('tile_id from perception_fetch_tile result'),
    },
    async () => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'not_implemented',
          message: 'perception_embed will be available in Sub-phase 4.2 (Clay v1.5 HuggingFace endpoint).',
        }),
      }],
    }),
  );

  // ── perception_weather  (Sub-phase 4.3 — stub) ──────────────────────────
  srv.tool(
    'perception_weather',
    '[Sub-phase 4.3 — NOT YET IMPLEMENTED] Will query Prithvi-WxC for ' +
    'atmospheric conditions (wind, precipitation, temperature anomaly) at a ' +
    'geometry and timestamp.',
    {
      h3_cell: z.string(),
      timestamp: z.string().optional(),
    },
    async () => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'not_implemented',
          message: 'perception_weather will be available in Sub-phase 4.3 (Prithvi-WxC).',
        }),
      }],
    }),
  );

  return srv;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main() {
  console.error('🛰️  GEIANT mcp-perception starting (sub-phase 4.0 — tile pipeline)');
  const srv = buildServer();
  const transport = new StdioServerTransport();
  await srv.connect(transport);
  console.error('✅  mcp-perception ready — 4 tools registered (1 live, 3 stubs)');
}

main().catch((err) => {
  console.error('💥  mcp-perception fatal:', err);
  process.exit(1);
});
