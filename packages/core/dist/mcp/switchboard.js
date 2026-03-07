"use strict";
// =============================================================================
// GEIANT — MCP SWITCHBOARD
// Routes dispatched tasks to the correct MCP server tool.
//
// After the router selects an ant, the switchboard determines which
// MCP tool to call based on task type + ant capabilities + jurisdiction.
//
// Tool dispatch matrix:
//   spatial_analysis    → geometry_buffer | geometry_area | spatial_query
//   gis_operation       → geometry_buffer | geometry_intersection | spatial_query
//   jurisdictional_check→ jurisdiction_lookup
//   compliance_audit    → spatial_query + jurisdiction_lookup
//   eo_inference        → [future: @geiant/mcp-gdal]
//   general             → spatial_query
//
// Each dispatch returns a SwitchboardResult with the tool response,
// latency, and a virtual breadcrumb for the audit trail.
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpSwitchboard = void 0;
exports.createSwitchboard = createSwitchboard;
const crypto_1 = require("crypto");
const h3_js_1 = require("h3-js");
// ---------------------------------------------------------------------------
// MCP Client — calls a remote MCP tool via HTTP
// ---------------------------------------------------------------------------
async function callMcpTool(serverUrl, apiKey, tool, params) {
    try {
        const body = {
            jsonrpc: '2.0',
            id: crypto.randomUUID(),
            method: 'tools/call',
            params: {
                name: tool,
                arguments: params,
            },
        };
        const response = await fetch(`${serverUrl}/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'x-geiant-api-key': apiKey,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30_000), // 30s timeout
        });
        if (!response.ok) {
            return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
        }
        const raw = await response.text();
        // Parse SSE format: "event: message\ndata: {...}"
        let jsonText = raw;
        const dataMatch = raw.match(/^data:\s*(.+)$/m);
        if (dataMatch)
            jsonText = dataMatch[1].trim();
        const data = JSON.parse(jsonText);
        if (data.error) {
            return { success: false, error: data.error.message ?? JSON.stringify(data.error) };
        }
        // Extract text content from MCP response
        const content = data.result?.content ?? [];
        const textContent = content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n');
        let parsed = textContent;
        try {
            parsed = JSON.parse(textContent);
        }
        catch { /* keep as string */ }
        return { success: !data.result?.isError, result: parsed };
    }
    catch (err) {
        return { success: false, error: `Network error: ${err.message}` };
    }
}
// ---------------------------------------------------------------------------
// Switchboard class
// ---------------------------------------------------------------------------
class McpSwitchboard {
    servers;
    constructor(servers) {
        this.servers = new Map(servers.map(s => [s.name, s]));
        console.log(`[GEIANT Switchboard] Initialized with ${servers.length} MCP server(s):`);
        servers.forEach(s => console.log(`  • ${s.name} → ${s.url}`));
    }
    // -------------------------------------------------------------------------
    // dispatch — main entry point
    // -------------------------------------------------------------------------
    async dispatch(task, routingDecision) {
        const startedAt = Date.now();
        const ant = routingDecision.selectedAnt;
        // Select the best tool for this task
        const toolCall = this.selectTool(task, ant);
        if (!toolCall) {
            return this.errorResult(task, 'No suitable MCP tool found for task type', startedAt);
        }
        // Find the server config
        const serverConfig = this.servers.get(toolCall.server);
        if (!serverConfig) {
            return this.errorResult(task, `MCP server '${toolCall.server}' not registered in switchboard`, startedAt);
        }
        console.log(`🔧 [Switchboard] Dispatching task ${task.id} → ${toolCall.server}.${toolCall.tool}`);
        // Call the tool
        const { success, result, error } = await callMcpTool(serverConfig.url, serverConfig.apiKey, toolCall.tool, toolCall.params);
        const latencyMs = Date.now() - startedAt;
        const breadcrumbHash = this.buildBreadcrumbHash(task, toolCall, latencyMs);
        if (!success) {
            console.error(`❌ [Switchboard] Tool call failed: ${error}`);
            return {
                success: false,
                taskId: task.id,
                toolCalled: toolCall.tool,
                serverUsed: toolCall.server,
                error,
                latencyMs,
                breadcrumbHash,
            };
        }
        console.log(`✅ [Switchboard] Tool call succeeded in ${latencyMs}ms`);
        return {
            success: true,
            taskId: task.id,
            toolCalled: toolCall.tool,
            serverUsed: toolCall.server,
            result,
            latencyMs,
            breadcrumbHash,
        };
    }
    // -------------------------------------------------------------------------
    // selectTool — dispatch matrix
    // -------------------------------------------------------------------------
    selectTool(task, ant) {
        const type = task.payload.type;
        const params = task.payload.params ?? {};
        const geometry = task.geometries?.[0]?.geometry;
        switch (type) {
            case 'spatial_analysis':
                // If geometry provided → area or buffer based on params
                if (geometry) {
                    if (params.operation === 'buffer' && params.distance_meters) {
                        return {
                            tool: 'geometry_buffer',
                            server: 'geiant-postgis',
                            params: {
                                geometry,
                                distance_meters: params.distance_meters,
                            },
                        };
                    }
                    if (params.operation === 'area' || geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
                        return {
                            tool: 'geometry_area',
                            server: 'geiant-postgis',
                            params: { geometry },
                        };
                    }
                    if (params.operation === 'distance' && params.to_geometry) {
                        return {
                            tool: 'geometry_distance',
                            server: 'geiant-postgis',
                            params: {
                                from_geometry: geometry,
                                to_geometry: params.to_geometry,
                            },
                        };
                    }
                }
                // Fallback: spatial query
                if (params.sql) {
                    return {
                        tool: 'spatial_query',
                        server: 'geiant-postgis',
                        params: { sql: params.sql, params: params.query_params },
                    };
                }
                return null;
            case 'jurisdictional_check': {
                // Resolve from origin cell lat/lng
                const [lat, lng] = (0, h3_js_1.cellToLatLng)(task.originCell);
                return {
                    tool: 'jurisdiction_lookup',
                    server: 'geiant-postgis',
                    params: { latitude: lat, longitude: lng },
                };
            }
            case 'gis_operation':
                if (geometry && params.operation === 'buffer' && params.distance_meters) {
                    return {
                        tool: 'geometry_buffer',
                        server: 'geiant-postgis',
                        params: { geometry, distance_meters: params.distance_meters },
                    };
                }
                if (params.sql) {
                    return {
                        tool: 'spatial_query',
                        server: 'geiant-postgis',
                        params: { sql: params.sql },
                    };
                }
                return null;
            case 'compliance_audit': {
                const [lat, lng] = (0, h3_js_1.cellToLatLng)(task.originCell);
                return {
                    tool: 'jurisdiction_lookup',
                    server: 'geiant-postgis',
                    params: { latitude: lat, longitude: lng },
                };
            }
            case 'general':
                if (params.sql) {
                    return {
                        tool: 'spatial_query',
                        server: 'geiant-postgis',
                        params: { sql: params.sql },
                    };
                }
                if (geometry) {
                    return {
                        tool: 'geometry_area',
                        server: 'geiant-postgis',
                        params: { geometry },
                    };
                }
                return null;
            default:
                return null;
        }
    }
    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    errorResult(task, error, startedAt) {
        return {
            success: false,
            taskId: task.id,
            toolCalled: 'none',
            serverUsed: 'none',
            error,
            latencyMs: Date.now() - startedAt,
            breadcrumbHash: (0, crypto_1.createHash)('sha256')
                .update(`${task.id}:error:${error}`)
                .digest('hex'),
        };
    }
    buildBreadcrumbHash(task, toolCall, latencyMs) {
        return (0, crypto_1.createHash)('sha256')
            .update(JSON.stringify({
            taskId: task.id,
            tool: toolCall.tool,
            server: toolCall.server,
            latencyMs,
            timestamp: new Date().toISOString(),
        }))
            .digest('hex');
    }
    // -------------------------------------------------------------------------
    // Server management
    // -------------------------------------------------------------------------
    addServer(config) {
        this.servers.set(config.name, config);
        console.log(`[GEIANT Switchboard] Added server: ${config.name} → ${config.url}`);
    }
    getServers() {
        return Array.from(this.servers.values());
    }
    async ping(serverName) {
        const config = this.servers.get(serverName);
        if (!config)
            return false;
        try {
            const res = await fetch(`${config.url}/health`, {
                signal: AbortSignal.timeout(5000),
            });
            return res.ok;
        }
        catch {
            return false;
        }
    }
    async pingAll() {
        const results = {};
        for (const [name] of this.servers) {
            results[name] = await this.ping(name);
        }
        return results;
    }
}
exports.McpSwitchboard = McpSwitchboard;
// ---------------------------------------------------------------------------
// Factory — create switchboard from env vars
// ---------------------------------------------------------------------------
function createSwitchboard() {
    const servers = [];
    // PostGIS server (local or remote)
    const postgisUrl = process.env.GEIANT_MCP_POSTGIS_URL ?? 'http://localhost:3200';
    const postgisKey = process.env.GEIANT_MCP_API_KEY ?? 'geiant-dev-key';
    servers.push({
        name: 'geiant-postgis',
        url: postgisUrl,
        apiKey: postgisKey,
        capabilities: [
            'spatial_query', 'h3_to_geojson', 'geometry_buffer',
            'geometry_area', 'geometry_distance', 'geometry_within',
            'jurisdiction_lookup',
        ],
    });
    // Future: @geiant/mcp-gdal
    // if (process.env.GEIANT_MCP_GDAL_URL) {
    //   servers.push({ name: 'geiant-gdal', url: process.env.GEIANT_MCP_GDAL_URL, ... });
    // }
    return new McpSwitchboard(servers);
}
//# sourceMappingURL=switchboard.js.map