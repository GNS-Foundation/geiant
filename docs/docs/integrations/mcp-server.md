---
sidebar_position: 2
title: MCP Server
---

# MCP Server — GEIANT Perception Service

The GEIANT perception service is a live [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes geospatial AI tools over SSE. Every tool call is audit-wrapped with delegation checks and breadcrumb drops.

## Connection

```
SSE endpoint: https://packagesmcp-perception-production.up.railway.app/sse
Messages:     POST /message?sessionId=<id>
Health:       GET /health
```

### Connect with MCP SDK

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const BASE = 'https://packagesmcp-perception-production.up.railway.app';
const transport = new SSEClientTransport(new URL(`${BASE}/sse`));
const client = new Client({ name: 'my-app', version: '1.0.0' });

await client.connect(transport);
const tools = await client.listTools();
console.log(tools.tools.map(t => t.name));
// ['perception_fetch_tile', 'perception_classify',
//  'perception_embed', 'perception_weather']
```

### Connect with Claude Desktop

Add to your Claude Desktop MCP config (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "geiant-perception": {
      "url": "https://packagesmcp-perception-production.up.railway.app/sse"
    }
  }
}
```

## Available Tools

### `perception_weather`

Fetch historical or forecast weather for any H3 cell via Open-Meteo ERA5.

```typescript
const result = await client.callTool({
  name: 'perception_weather',
  arguments: {
    h3_cell: '851e8053fffffff',          // Rome
    timestamp: '2026-03-20T12:00:00Z',   // Optional, defaults to now
    write_to_spatial_memory: false,       // Write result to Supabase
  },
});

const weather = JSON.parse(result.content[0].text);
// { temperature_c: 18.1, wind_speed_ms: 1.57, status: 'ok', ... }
```

### `perception_fetch_tile`

Fetch Sentinel-2 L2A satellite tiles for any H3 cell. Returns STAC metadata and band URLs.

```typescript
const result = await client.callTool({
  name: 'perception_fetch_tile',
  arguments: {
    h3_cell: '851e8053fffffff',
    max_cloud_cover: 20,
    bands: ['B02', 'B03', 'B04', 'B8A', 'B11', 'B12'],
  },
});
```

### `perception_classify`

Run Prithvi-EO-2.0 foundation model inference on a fetched tile. Requires a running RunPod GPU endpoint.

```typescript
const result = await client.callTool({
  name: 'perception_classify',
  arguments: {
    h3_cell: '851e8053fffffff',
    model: 'prithvi-eo-2.0-300m',
    task: 'flood_detection',
  },
});
```

### `perception_embed` (Planned)

Generate Clay v1.5 geospatial embeddings for a tile. Phase 4.2 — coming soon.

## HTTP Endpoints

Beyond MCP tools, the service exposes REST endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service status, chain tip, audit state |
| `/test/weather` | GET | Quick test — drops a breadcrumb |
| `/epoch/roll` | POST | Roll all unrolled breadcrumbs into an epoch |
| `/compliance` | GET | Generate EU AI Act compliance report |
| `/compliance/:agent_pk` | GET | Compliance report for a specific agent |

### Epoch Rollup

```bash
curl -X POST https://packagesmcp-perception-production.up.railway.app/epoch/roll
```

```json
{
  "success": true,
  "epoch_index": 1,
  "block_count": 3,
  "start_block": 5,
  "end_block": 7,
  "merkle_root": "6fa3e35a8f8fd9d4...",
  "tier_at_close": "provisioned",
  "epoch_hash": "5c6b317cadc39538..."
}
```

### Compliance Report

```bash
curl https://packagesmcp-perception-production.up.railway.app/compliance
```

Returns a full [EU AI Act compliance report](/compliance/compliance-reports) with chain verification, epoch summaries, delegation certificate, trust score, and violation history.

## Audit Trail

Every MCP tool call automatically:

1. **Pre-flight**: Checks delegation certificate (jurisdiction, facet, temporal validity, tool whitelist)
2. **Executes**: Runs the actual tool
3. **Post-flight**: Builds context digest, chains to previous block, Ed25519-signs, writes to Supabase

If pre-flight fails, the tool call is **blocked** — it never executes. A compliance violation is logged instead.

The chain tip is visible in the `/health` endpoint:

```bash
curl -s .../health | jq '{chain_tip, audit_active, agent_pk}'
# { "chain_tip": 8, "audit_active": true, "agent_pk": "c14094ea7efb6122" }
```

## Governance Tools

The server exposes four governance tools alongside the perception tools. These provide cryptographic chain verification, trust scoring, epoch management, and full EU AI Act compliance reports.

### `gns_get_compliance_report`

Returns a full EU AI Act compliance report for the server's agent. Includes trust score, chain verification, Merkle epoch proofs, delegation certificate, and regulatory status.

This tool is registered as an **MCP App** — in supported hosts (Claude, Claude Desktop, goose), it renders an interactive compliance dashboard directly in the conversation.

```typescript
const result = await client.callTool({
  name: 'gns_get_compliance_report',
  arguments: {},  // Omit agent_pk to use the server's own agent
});

const report = JSON.parse(result.content[0].text);
// {
//   agent_pk: "c14094ea...",
//   agent_handle: "energy@italy-geiant",
//   trust_score: 21.41,
//   current_tier: "provisioned",
//   total_operations: 8,
//   chain_verification: { is_valid: true, block_count: 8, issues: [] },
//   epochs: [...],
//   delegation_certificate: {...},
//   violations: []
// }
```

### `gns_get_trust_score`

Get the current TierGate trust tier and score for an agent.

Tiers: `provisioned` (0%) → `observed` (25%) → `trusted` (60%) → `certified` (85%) → `sovereign` (99%).

```typescript
const result = await client.callTool({
  name: 'gns_get_trust_score',
  arguments: {
    agent_pk: 'c14094ea7efb6122...',  // Optional — omit for own agent
  },
});
```

### `gns_verify_chain`

Verify the cryptographic integrity of the breadcrumb chain. Returns block-by-block hash verification.

```typescript
const result = await client.callTool({
  name: 'gns_verify_chain',
  arguments: {},
});
```

### `gns_roll_epoch`

Seal all unrolled breadcrumbs into a new epoch with a Merkle root. Creates a tamper-evident checkpoint.

```typescript
const result = await client.callTool({
  name: 'gns_roll_epoch',
  arguments: {},
});
```

## MCP App — Compliance Dashboard

The `gns_get_compliance_report` tool includes MCP App metadata (`_meta.ui.resourceUri`). In hosts that support [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview), the compliance report renders as an interactive dashboard:

- Trust score + TierGate progression bar
- Chain verification status (blocks, issues, date range)
- Epoch Merkle roots with validity badges
- Delegation certificate details (principal, territory, validity, facets)
- EU AI Act article compliance (Art. 9, 12, 13, 14)
- Live countdown to August 2, 2026 enforcement deadline
- Export PDF, Copy JSON, Verify Offline buttons

### Supported Hosts

| Host | MCP App Rendering |
|------|------------------|
| Claude (web) | Interactive dashboard |
| Claude Desktop | Interactive dashboard |
| goose (v1.19.0+) | Interactive dashboard |
| VS Code (GitHub Copilot) | Interactive dashboard |
| Other MCP clients | JSON text fallback |

### Connect in Claude.ai

1. Go to **Settings** → **Connectors** → **Add custom connector**
2. Enter: `https://packagesmcp-perception-production.up.railway.app/mcp`
3. Name: `GEIANT Perception`
4. In a new conversation: "Run a compliance report for energy@italy-geiant"

## AuthZen COAZ Integration

The GEIANT MCP server is designed to work with the [OpenID AuthZen MCP Profile](https://openid.github.io/authzen/authzen-mcp-profile-1_0.html) for fine-grained, jurisdictional authorization.

See [AuthZen COAZ — Jurisdictional Context](/integrations/authzen-coaz) for the full mapping specification.
