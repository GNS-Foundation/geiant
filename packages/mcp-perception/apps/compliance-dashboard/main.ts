/**
 * main.ts — Server entry point with HTTP and stdio transport.
 *
 * In production, this gets merged into mcp-perception's existing
 * main.ts. Standalone here for testing the compliance dashboard
 * in isolation with basic-host or Claude Desktop.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import cors from 'cors';
import express from 'express';
import { registerComplianceDashboard } from './server.js';

function createServer(): McpServer {
  const server = new McpServer({
    name: 'GEIANT Compliance Dashboard',
    version: '0.1.0',
  });

  registerComplianceDashboard(server);

  return server;
}

// ── Stdio transport (for Claude Desktop, VS Code, goose) ──
if (process.argv.includes('--stdio')) {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
} else {
  // ── HTTP transport (for Claude.ai, development) ─────────
  const app = express();
  app.use(cors());

  app.post('/mcp', async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT ?? '3001');
  app.listen(port, () => {
    console.log(`GEIANT Compliance Dashboard MCP server on http://localhost:${port}/mcp`);
  });
}
