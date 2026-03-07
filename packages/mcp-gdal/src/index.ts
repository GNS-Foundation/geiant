// @geiant/mcp-gdal — GEIANT GDAL MCP Server
// 9 tools: raster_info, raster_stats, reproject, warp,
//          clip_to_geometry, contours, translate, band_algebra, h3_sample
// Transport: StreamableHTTP on PORT (default 3201)
// Backend: Python subprocess (gdal_worker.py) — system GDAL 3.8.4

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { z } from 'zod';
import { spawn, ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const PORT = parseInt(process.env.PORT ?? '3201');
const API_KEY = process.env.GEIANT_MCP_API_KEY ?? 'geiant-dev-key';
const __dir = dirname(fileURLToPath(import.meta.url));
const WORKER = join(__dir, 'gdal_worker.py');

// ─── Python GDAL Bridge ──────────────────────────────────────────────────────

class GdalWorker {
    proc: ChildProcess;
    private buffer = '';
    private pending = new Map<string, (v: any) => void>();
    readyPromise: Promise<void>;

    constructor() {
        this.proc = spawn('python3', [WORKER], { stdio: ['pipe', 'pipe', 'pipe'] });

        this.readyPromise = new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('GDAL worker startup timeout')), 15_000);
            const onData = (chunk: Buffer) => {
                const lines = chunk.toString().split('\n');
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const msg = JSON.parse(line);
                        if (msg.status === 'ready') {
                            clearTimeout(t);
                            this.proc.stdout!.removeListener('data', onData);
                            this.setupDataHandler();
                            console.log(`🐍 GDAL worker ready — GDAL ${msg.gdal_version}`);
                            resolve();
                        }
                    } catch { /* not ready yet */ }
                }
            };
            this.proc.stdout!.on('data', onData);
        });

        this.proc.stderr!.on('data', (d: Buffer) => {
            const m = d.toString().trim();
            if (!m.includes('NumPy') && !m.includes('FutureWarning') && !m.includes('compiled using') && m.length > 0)
                console.error('🐍 worker:', m);
        });
    }

    private setupDataHandler() {
        this.proc.stdout!.on('data', (chunk: Buffer) => {
            this.buffer += chunk.toString();
            const lines = this.buffer.split('\n');
            this.buffer = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const resp = JSON.parse(line);
                    const resolve = this.pending.get(resp.id);
                    if (resolve) { this.pending.delete(resp.id); resolve(resp); }
                } catch { /* malformed */ }
            }
        });
    }

    async call(tool: string, params: Record<string, unknown>): Promise<unknown> {
        await this.readyPromise;
        return new Promise((resolve, reject) => {
            const id = randomUUID();
            const t = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`GDAL timeout: ${tool}`));
            }, 60_000);
            this.pending.set(id, (resp) => {
                clearTimeout(t);
                resp.error ? reject(new Error(resp.error)) : resolve(resp.result);
            });
            this.proc.stdin!.write(JSON.stringify({ id, tool, params }) + '\n');
        });
    }
}

let _worker: GdalWorker | null = null;
function getWorker(): GdalWorker {
    if (!_worker) {
        _worker = new GdalWorker();
        _worker.proc.on('exit', () => {
            console.log('🔄 Restarting GDAL worker...');
            _worker = null;
            setTimeout(() => getWorker(), 1000);
        });
    }
    return _worker;
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const GeoJSON = z.object({ type: z.string(), coordinates: z.unknown() }).passthrough();
const EPSG = z.number().int().min(1024).max(900913).describe('EPSG code e.g. 4326, 32632, 3857');

// ─── MCP Server ──────────────────────────────────────────────────────────────

function createMcpServer(): McpServer {
    const server = new McpServer({ name: 'geiant-gdal', version: '0.1.0' });
    const w = getWorker();

    const ok = (r: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }] });
    const err = (e: Error) => ({ content: [{ type: 'text' as const, text: JSON.stringify({ error: e.message }) }], isError: true as const });

    server.tool('raster_info',
        'Get raster metadata: driver, CRS/EPSG, dimensions, band info, pixel size, extent, H3 cell for routing.',
        { file_path: z.string().describe('Absolute path to raster (GeoTIFF, PNG, HDF5, NetCDF, JPEG2000...)') },
        async ({ file_path }) => { try { return ok(await w.call('raster_info', { file_path })); } catch (e: any) { return err(e); } }
    );

    server.tool('raster_stats',
        'Per-band statistics (min, max, mean, stddev). Use for quality checks before processing.',
        {
            file_path: z.string().describe('Path to raster'),
            band_numbers: z.array(z.number().int().min(1)).optional().describe('Bands to analyze (default: all)'),
        },
        async ({ file_path, band_numbers }) => { try { return ok(await w.call('raster_stats', { file_path, band_numbers })); } catch (e: any) { return err(e); } }
    );

    server.tool('reproject',
        'Reproject a GeoJSON geometry from EPSG:4326 to any target CRS.',
        {
            geometry: GeoJSON.describe('GeoJSON geometry in EPSG:4326'),
            target_epsg: EPSG.describe('Target CRS (e.g. 32632 = UTM Zone 32N, 3857 = Web Mercator)'),
        },
        async ({ geometry, target_epsg }) => { try { return ok(await w.call('reproject', { geometry, target_epsg })); } catch (e: any) { return err(e); } }
    );

    server.tool('warp',
        'Reproject a raster file to a new CRS using GDAL bilinear warping. Writes to /tmp/geiant-gdal/.',
        {
            input_path: z.string().describe('Path to input raster'),
            target_epsg: EPSG.describe('Target CRS EPSG code'),
            output_format: z.enum(['GTiff', 'COG', 'PNG']).default('GTiff'),
        },
        async ({ input_path, target_epsg, output_format }) => { try { return ok(await w.call('warp', { input_path, target_epsg, output_format })); } catch (e: any) { return err(e); } }
    );

    server.tool('clip_to_geometry',
        'Clip a raster to a GeoJSON polygon (cookie-cutter). Returns output path, clip bounds, H3 cell.',
        {
            input_path: z.string().describe('Path to input raster'),
            clip_geometry: GeoJSON.describe('GeoJSON Polygon in EPSG:4326 to use as clip mask'),
        },
        async ({ input_path, clip_geometry }) => { try { return ok(await w.call('clip_to_geometry', { input_path, clip_geometry })); } catch (e: any) { return err(e); } }
    );

    server.tool('contours',
        'Generate contour lines from an elevation band. Returns GeoJSON LineStrings with elevation attribute.',
        {
            input_path: z.string().describe('Path to DEM or elevation raster'),
            band_number: z.number().int().min(1).default(1).describe('Elevation band (default 1)'),
            interval_meters: z.number().positive().describe('Contour interval in raster units (meters)'),
        },
        async ({ input_path, band_number, interval_meters }) => { try { return ok(await w.call('contours', { input_path, band_number, interval_meters })); } catch (e: any) { return err(e); } }
    );

    server.tool('translate',
        'Convert raster format. COG = Cloud-Optimized GeoTIFF (LZW + tiling, optimal for streaming).',
        {
            input_path: z.string().describe('Path to input raster'),
            output_format: z.enum(['GTiff', 'COG', 'PNG']).describe('Target format'),
            options: z.record(z.string()).optional().describe('GDAL creation options e.g. {"COMPRESS":"DEFLATE"}'),
        },
        async ({ input_path, output_format, options }) => { try { return ok(await w.call('translate', { input_path, output_format, options })); } catch (e: any) { return err(e); } }
    );

    server.tool('band_algebra',
        'Pixel-wise numpy formula across raster bands. NDVI = (NIR-RED)/(NIR+RED+1e-8), NDWI = (GREEN-NIR)/(GREEN+NIR+1e-8). Custom expressions supported.',
        {
            input_path: z.string().describe('Path to multi-band raster'),
            formula: z.string().describe('numpy expression. Example: "(NIR-RED)/(NIR+RED+1e-8)"'),
            band_mapping: z.record(z.number().int().min(1)).describe('Band name→number. Example: {"RED":3,"NIR":4}'),
        },
        async ({ input_path, formula, band_mapping }) => { try { return ok(await w.call('band_algebra', { input_path, formula, band_mapping })); } catch (e: any) { return err(e); } }
    );

    server.tool('h3_sample',
        'Sample raster values at H3 cell centroid locations. Bridges GEIANT H3 routing with raster data. Returns null for out-of-extent or nodata cells.',
        {
            input_path: z.string().describe('Path to raster (must have valid geotransform)'),
            h3_cells: z.array(z.string()).min(1).max(10000).describe('GEIANT H3 cell strings: "h3:lat,lon:resN"'),
            band_number: z.number().int().min(1).default(1).describe('Band to sample (default 1)'),
        },
        async ({ input_path, h3_cells, band_number }) => { try { return ok(await w.call('h3_sample', { input_path, h3_cells, band_number })); } catch (e: any) { return err(e); } }
    );

    return server;
}

// ─── HTTP server ─────────────────────────────────────────────────────────────

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-geiant-api-key, Accept');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok', server: 'geiant-gdal', version: '0.1.0', port: PORT,
            gdalBackend: 'python3-gdal',
            tools: ['raster_info', 'raster_stats', 'reproject', 'warp', 'clip_to_geometry', 'contours', 'translate', 'band_algebra', 'h3_sample'],
        }));
        return;
    }

    if (req.headers['x-geiant-api-key'] !== API_KEY) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized — invalid x-geiant-api-key' }));
        return;
    }

    if (req.url === '/mcp') {
        try {
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
            const mcpServer = createMcpServer();
            await mcpServer.connect(transport);
            res.setHeader('Accept', 'application/json, text/event-stream');
            await transport.handleRequest(req, res);
        } catch (err: any) {
            console.error('❌ MCP error:', err.message);
            if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
        }
        return;
    }

    res.writeHead(404); res.end(JSON.stringify({ error: 'Not found', routes: ['/health', '/mcp'] }));
});

getWorker(); // pre-warm

httpServer.listen(PORT, () => {
    console.log('');
    console.log('🐜🌍 @geiant/mcp-gdal — GEIANT GDAL MCP Server');
    console.log(`   Port    : ${PORT}`);
    console.log(`   Backend : Python GDAL 3.8.4 (subprocess bridge)`);
    console.log(`   Tools   : raster_info · raster_stats · reproject · warp`);
    console.log(`             clip_to_geometry · contours · translate · band_algebra · h3_sample`);
    console.log(`   Health  : http://localhost:${PORT}/health`);
    console.log(`   MCP     : http://localhost:${PORT}/mcp`);
    console.log('');
});

httpServer.on('error', (err) => { console.error('❌ Server error:', err); process.exit(1); });