/**
 * server.ts — GEIANT Compliance Dashboard MCP App server registration
 *
 * This file shows the exact code to add to mcp-perception/src/index.ts
 * to wire the compliance dashboard as an MCP App.
 *
 * Uses registerAppTool and registerAppResource from
 * @modelcontextprotocol/ext-apps/server (the canonical pattern).
 */

import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const DIST_DIR = path.join(import.meta.dirname, 'dist');

/**
 * Register the Compliance Dashboard MCP App on an existing McpServer.
 *
 * Call this from mcp-perception's createServer() alongside existing tools.
 */
export function registerComplianceDashboard(server: McpServer): void {
  // The ui:// URI ties the tool to its resource.
  const resourceUri = 'ui://geiant/compliance-dashboard.html';

  // ── Tool registration ─────────────────────────────────
  // When Claude/goose calls this tool, the host reads _meta.ui.resourceUri
  // to know which resource to fetch and render as an interactive UI.
  registerAppTool(
    server,
    'gns_get_compliance_report',
    {
      title: 'Get Compliance Report',
      description:
        'Returns a full EU AI Act compliance report for a GNS agent, ' +
        'including trust score, chain verification, Merkle epoch proofs, ' +
        'delegation certificate, and regulatory status.',
      inputSchema: {
        agentHandle: z.string().describe('GNS handle of the agent (e.g. energy@italy-geiant)').optional(),
      },
      _meta: { ui: { resourceUri } },
    },
    async (args: { agentHandle?: string }) => {
      // In production, fetch from the compliance engine.
      // For now, return the report JSON as structured content.
      const report = await buildComplianceReport(args.agentHandle);

      return {
        // Text fallback for non-UI hosts
        content: [{ type: 'text' as const, text: JSON.stringify(report) }],
        // Structured data for the MCP App UI
        structuredContent: { report },
      };
    },
  );

  // ── Resource registration ─────────────────────────────
  // Serves the bundled single-file HTML to the host.
  registerAppResource(
    server,
    'GEIANT Compliance Dashboard',
    resourceUri,
    {},
    async () => {
      const html = await fs.readFile(
        path.join(DIST_DIR, 'mcp-app.html'),
        'utf8',
      );
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
          },
        ],
      };
    },
  );
}

// ── Placeholder compliance engine ───────────────────────
async function buildComplianceReport(handle?: string) {
  // TODO: Replace with actual compliance engine call
  return {
    agent: {
      handle: handle || 'energy@italy-geiant',
      publicKey: 'c14094ea7b3f2a1d9e6c8b4f0a5d7e2c3b1a9f8e7d6c5b4a3f2e1d0c9b8a7f6',
      territory: '851e8053fffffff',
      territoryLabel: 'Rome, Italy',
    },
    trustScore: {
      score: 20.99,
      tier: 'Provisioned',
      totalOps: 8,
      violations: 0,
      nextTier: 'Observed',
      nextTierThreshold: 25,
      opsToNextTier: 42,
    },
    chain: {
      valid: true,
      blockCount: 8,
      issues: 0,
      firstBlock: '2026-03-20T10:00:00Z',
      lastBlock: '2026-03-22T14:30:00Z',
    },
    epochs: [
      { index: 0, blockRange: [0, 4], merkleRoot: '6fa3e35a9c2b1d4e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5', valid: true },
      { index: 1, blockRange: [5, 7], merkleRoot: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2', valid: true },
    ],
    delegation: {
      principal: '262507c6d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8',
      territory: '851e8053fffffff',
      territoryLabel: 'Rome, Italy',
      validFrom: '2026-03-20T00:00:00Z',
      validUntil: '2027-03-20T00:00:00Z',
      facets: ['energy@italy-geiant'],
    },
    regulatory: {
      articles: [
        { id: 'art-12', label: 'Art. 12 — Record-keeping', compliant: true },
        { id: 'art-14', label: 'Art. 14 — Human oversight', compliant: true },
        { id: 'art-9', label: 'Art. 9 — Risk management', compliant: true },
        { id: 'art-13', label: 'Art. 13 — Transparency', compliant: true },
      ],
      enforcementDate: '2026-08-02T00:00:00Z',
    },
  };
}
