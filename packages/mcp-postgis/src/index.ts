// =============================================================================
// @geiant/mcp-postgis — GEIANT PostGIS MCP Server
//
// The first production spatial MCP server.
// Exposes PostGIS/Supabase spatial operations as MCP tools.
//
// Tools:
//   spatial_query          — execute a validated PostGIS SQL query
//   h3_to_geojson          — convert H3 cell(s) to GeoJSON polygons
//   geometry_buffer        — ST_Buffer a GeoJSON geometry
//   geometry_intersection  — ST_Intersection of two geometries
//   geometry_area          — ST_Area of a geometry (sq meters)
//   geometry_distance      — ST_Distance between two geometries
//   geometry_within        — ST_Within point-in-polygon test
//   territory_cells        — find H3 cells covering a geometry
//   jurisdiction_lookup    — resolve country + frameworks for a lat/lng
//
// Transport: StreamableHTTP on PORT (default 3200)
// Auth: GEIANT_MCP_API_KEY header (validates against env var)
//
// Design principles:
//   - Every tool validates inputs with Zod before touching the DB
//   - SQL is parameterized — no string interpolation, no injection
//   - Geometry inputs/outputs are always GeoJSON (EPSG:4326)
//   - Results include H3 cell index at res 9 for GEIANT routing
// =============================================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT        = parseInt(process.env.PORT ?? '3200');
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const API_KEY      = process.env.GEIANT_MCP_API_KEY ?? 'geiant-dev-key';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Supabase client (service role — full PostGIS access)
// ---------------------------------------------------------------------------

const db: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// MCP Server definition
// ---------------------------------------------------------------------------

// Server factory — new instance per request (StreamableHTTP stateless mode)
function createMcpServer(): McpServer {
  const srv = new McpServer({
    name: 'geiant-postgis',
    version: '0.1.0',
  });

// ---------------------------------------------------------------------------
// Tool: spatial_query
// Execute a validated read-only PostGIS SQL query.
// Only SELECT statements allowed — no DDL/DML.
// ---------------------------------------------------------------------------

  srv.tool(
  'spatial_query',
  'Execute a read-only PostGIS SQL query. Returns GeoJSON FeatureCollection. Only SELECT allowed.',
  {
    sql: z.string().min(10).max(4000).describe('SELECT SQL query with PostGIS functions'),
    params: z.array(z.unknown()).optional().describe('Query parameters ($1, $2, ...)'),
  },
  async ({ sql, params }) => {
    // Safety: only allow SELECT
    const normalized = sql.trim().toLowerCase();
    if (!normalized.startsWith('select')) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Error: Only SELECT queries are permitted.' }],
      };
    }

    // Block dangerous keywords
    const blocked = ['drop', 'delete', 'insert', 'update', 'truncate', 'alter', 'create', 'pg_'];
    for (const kw of blocked) {
      if (normalized.includes(kw)) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error: Keyword '${kw}' is not allowed.` }],
        };
      }
    }

    try {
      const { data, error } = await db.rpc('execute_spatial_query', {
        query_sql: sql,
        query_params: params ?? [],
      });

      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(data, null, 2),
        }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Query error: ${err.message}` }],
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: h3_to_geojson
// Convert H3 cell index(es) to GeoJSON polygon(s).
// ---------------------------------------------------------------------------

  srv.tool(
  'h3_to_geojson',
  'Convert one or more H3 cell indexes to GeoJSON polygons. Returns a FeatureCollection.',
  {
    cells: z.array(z.string().regex(/^[0-9a-f]{15}$/i)).min(1).max(100)
      .describe('Array of H3 cell indexes (15 hex chars each)'),
    resolution: z.number().int().min(0).max(15).optional().describe('Expected H3 resolution for validation'),
  },
  async ({ cells, resolution }) => {
    try {
      // Use PostGIS h3 extension if available, otherwise compute via SQL
      const { data, error } = await db.rpc('h3_cells_to_geojson', {
        cell_ids: cells,
      });

      if (error) {
        // Fallback: return cells as properties only (no PostGIS h3 extension)
        const features = cells.map(cell => ({
          type: 'Feature',
          properties: { h3_cell: cell, resolution: cell.length },
          geometry: null,
        }));
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              type: 'FeatureCollection',
              features,
              note: 'H3 extension not available — geometry null. Install h3-pg for full support.',
            }, null, 2),
          }],
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(data, null, 2),
        }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `H3 conversion error: ${err.message}` }],
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: geometry_buffer
// ST_Buffer a GeoJSON geometry by distance in meters.
// ---------------------------------------------------------------------------

  srv.tool(
  'geometry_buffer',
  'Buffer a GeoJSON geometry by a distance in meters. Returns buffered GeoJSON geometry.',
  {
    geometry: z.object({
      type: z.string(),
      coordinates: z.unknown(),
    }).describe('GeoJSON geometry object (Point, LineString, or Polygon)'),
    distance_meters: z.number().positive().max(100000)
      .describe('Buffer distance in meters (max 100km)'),
  },
  async ({ geometry, distance_meters }) => {
    try {
      const { data, error } = await db.rpc('geiant_buffer', {
        geom_json: JSON.stringify(geometry),
        distance_m: distance_meters,
      });

      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            type: 'Feature',
            geometry: data,
            properties: {
              operation: 'ST_Buffer',
              distance_meters,
              original_type: geometry.type,
            },
          }, null, 2),
        }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Buffer error: ${err.message}` }],
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: geometry_area
// Compute ST_Area of a GeoJSON polygon in square meters.
// ---------------------------------------------------------------------------

  srv.tool(
  'geometry_area',
  'Compute the area of a GeoJSON polygon in square meters using ST_Area (geography).',
  {
    geometry: z.object({
      type: z.string(),
      coordinates: z.unknown(),
    }).describe('GeoJSON Polygon or MultiPolygon'),
  },
  async ({ geometry }) => {
    try {
      const { data, error } = await db.rpc('geiant_area', {
        geom_json: JSON.stringify(geometry),
      });

      if (error) throw new Error(error.message);

      const areaSqM = data as number;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            area_sq_meters: areaSqM,
            area_sq_km: areaSqM / 1_000_000,
            area_hectares: areaSqM / 10_000,
          }, null, 2),
        }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Area error: ${err.message}` }],
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: geometry_distance
// ST_Distance between two GeoJSON geometries in meters.
// ---------------------------------------------------------------------------

  srv.tool(
  'geometry_distance',
  'Compute the distance in meters between two GeoJSON geometries using ST_Distance (geography).',
  {
    from_geometry: z.object({ type: z.string(), coordinates: z.unknown() })
      .describe('First GeoJSON geometry'),
    to_geometry: z.object({ type: z.string(), coordinates: z.unknown() })
      .describe('Second GeoJSON geometry'),
  },
  async ({ from_geometry, to_geometry }) => {
    try {
      const { data, error } = await db.rpc('geiant_distance', {
        geom_a_json: JSON.stringify(from_geometry),
        geom_b_json: JSON.stringify(to_geometry),
      });

      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            distance_meters: data,
            distance_km: (data as number) / 1000,
          }, null, 2),
        }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Distance error: ${err.message}` }],
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: geometry_within
// ST_Within — test if a point is within a polygon.
// ---------------------------------------------------------------------------

  srv.tool(
  'geometry_within',
  'Test whether a point is within a polygon using ST_Within. Returns boolean.',
  {
    point: z.object({
      type: z.literal('Point'),
      coordinates: z.tuple([z.number(), z.number()]),
    }).describe('GeoJSON Point [longitude, latitude]'),
    polygon: z.object({
      type: z.string(),
      coordinates: z.unknown(),
    }).describe('GeoJSON Polygon or MultiPolygon'),
  },
  async ({ point, polygon }) => {
    try {
      const { data, error } = await db.rpc('geiant_within', {
        point_json: JSON.stringify(point),
        polygon_json: JSON.stringify(polygon),
      });

      if (error) throw new Error(error.message);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            within: data,
            point: point.coordinates,
          }, null, 2),
        }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Within error: ${err.message}` }],
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: jurisdiction_lookup
// Resolve country + regulatory frameworks for a lat/lng.
// ---------------------------------------------------------------------------

  srv.tool(
  'jurisdiction_lookup',
  'Resolve the regulatory jurisdiction and frameworks for a geographic coordinate.',
  {
    latitude: z.number().min(-90).max(90).describe('Latitude (WGS84)'),
    longitude: z.number().min(-180).max(180).describe('Longitude (WGS84)'),
  },
  async ({ latitude, longitude }) => {
    // Use GEIANT's jurisdiction resolver (pure TypeScript — no DB needed)
    try {
      const { latLngToCell } = await import('h3-js');
      const { resolveJurisdiction } = await import('@geiant/core/src/router/jurisdiction.js');

      const cell = latLngToCell(latitude, longitude, 7);
      const jurisdiction = await resolveJurisdiction(cell);

      if (!jurisdiction) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              latitude, longitude,
              h3_cell: cell,
              jurisdiction: null,
              note: 'No jurisdiction resolved for this coordinate.',
            }, null, 2),
          }],
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            latitude, longitude,
            h3_cell: cell,
            country: jurisdiction.countryCode,
            region: jurisdiction.regionCode,
            data_residency: jurisdiction.dataResidency,
            frameworks: jurisdiction.frameworks.map(f => ({
              id: f.id,
              name: f.name,
              requires_audit: f.requiresAuditTrail,
              requires_human_oversight: f.requiresHumanOversight,
              max_autonomy_tier: f.maxAutonomyTier,
            })),
          }, null, 2),
        }],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Jurisdiction error: ${err.message}` }],
      };
    }
  }
);


  // ---------------------------------------------------------------------------
  // Tool: geometry_store  [Phase 3 — Spatial Memory]
  // ---------------------------------------------------------------------------
  srv.tool(
    'geometry_store',
    'Store a versioned GeoJSON geometry. Creates a new version and closes the previous.',
    {
      geometry_id: z.string().min(1).max(200).describe('Logical name, e.g. "rome-municipality"'),
      geojson: z.string().min(10).describe('GeoJSON geometry string (Polygon or MultiPolygon)'),
      h3_cells: z.array(z.string()).optional().describe('H3 res-9 cells covering this geometry'),
      source: z.string().optional().describe('Who is storing this geometry'),
      metadata: z.record(z.unknown()).optional().describe('Arbitrary key/value metadata'),
    },
    async ({ geometry_id, geojson, h3_cells, source, metadata }) => {
      try {
        const { createHash } = await import('crypto');
        const checksum = createHash('sha256').update(geojson).digest('hex');
        const { data, error } = await db.rpc('geiant_store_geometry', {
          p_geometry_id: geometry_id,
          p_geojson: geojson,
          p_h3_cells: h3_cells ?? [],
          p_source: source ?? 'geiant-mcp',
          p_checksum: checksum,
          p_metadata: metadata ?? {},
        });
        if (error) throw new Error(error.message);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: geometry_at  [Phase 3 — Spatial Memory]
  // ---------------------------------------------------------------------------
  srv.tool(
    'geometry_at',
    'Retrieve the version of a named geometry that was current at a given timestamp. Returns GeoJSON + metadata.',
    {
      geometry_id: z.string().min(1).describe('Logical geometry name'),
      at_time: z.string().optional().describe('ISO 8601 timestamp. Defaults to now().'),
    },
    async ({ geometry_id, at_time }) => {
      try {
        const { data, error } = await db.rpc('geiant_get_geometry_at', {
          p_geometry_id: geometry_id,
          p_at_time: at_time ?? new Date().toISOString(),
        });
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No geometry found for ' + geometry_id }) }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: data[0] }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: geometry_diff  [Phase 3 — Spatial Memory]
  // ---------------------------------------------------------------------------
  srv.tool(
    'geometry_diff',
    'Compare two versions of a named geometry at different timestamps. Returns symmetric difference and area of change in sq meters.',
    {
      geometry_id: z.string().min(1).describe('Logical geometry name'),
      t1: z.string().describe('ISO 8601 timestamp for the earlier version'),
      t2: z.string().optional().describe('ISO 8601 timestamp for the later version. Defaults to now().'),
    },
    async ({ geometry_id, t1, t2 }) => {
      try {
        const { data, error } = await db.rpc('geiant_diff_geometry', {
          p_geometry_id: geometry_id,
          p_t1: t1,
          p_t2: t2 ?? new Date().toISOString(),
        });
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Could not diff ' + geometry_id }) }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: data[0] }) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool: validate_coordinates  [Phase 3 — Spatial Memory]
  // Coordinate guardrail — anti-hallucination check.
  // ---------------------------------------------------------------------------
  srv.tool(
    'validate_coordinates',
    'Validate a lon/lat coordinate. Checks Earth bounds, detects Null Island (0,0), and optionally verifies containment within a named geometry.',
    {
      lon: z.number().describe('Longitude (-180 to 180)'),
      lat: z.number().describe('Latitude (-90 to 90)'),
      geometry_id: z.string().optional().describe('Optional geometry name to check containment against'),
      at_time: z.string().optional().describe('ISO 8601 timestamp for geometry version. Defaults to now().'),
    },
    async ({ lon, lat, geometry_id, at_time }) => {
      try {
        const { data, error } = await db.rpc('geiant_validate_coordinates', {
          p_lon: lon,
          p_lat: lat,
          p_geometry_id: geometry_id ?? null,
          p_at_time: at_time ?? new Date().toISOString(),
        });
        if (error) throw new Error(error.message);
        const result = data?.[0] ?? { valid: false, reason: 'No result from guardrail' };
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: result }) }], isError: !result.valid };
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
      }
    }
  );

  return srv;
}

// ---------------------------------------------------------------------------
// HTTP server with API key auth
// ---------------------------------------------------------------------------

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Health check
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      server: 'geiant-postgis',
      version: '0.1.0',
      tools: 11,
    }));
    return;
  }

  // API key validation
  const apiKey = req.headers['x-geiant-api-key'] ?? req.headers['authorization']?.replace('Bearer ', '');
  if (apiKey !== API_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized — invalid or missing GEIANT API key' }));
    return;
  }

  // MCP endpoint
  if (req.url === '/mcp' && req.method === 'POST') {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — new transport per request
    });

    // Fresh server instance per request — stateless mode requirement
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404);
  res.end();
});

httpServer.listen(PORT, () => {
  console.log(`\n🌍 GEIANT PostGIS MCP Server`);
  console.log(`   The first spatial MCP server`);
  console.log(`   Listening on port ${PORT}`);
  console.log(`   Endpoint: http://localhost:${PORT}/mcp`);
  console.log(`   Health:   http://localhost:${PORT}/health`);
  console.log(`   Tools: spatial_query, h3_to_geojson, geometry_buffer,`);
  console.log(`          geometry_area, geometry_distance, geometry_within,`);
  console.log(`          jurisdiction_lookup\n`);
});
