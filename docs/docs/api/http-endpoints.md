---
sidebar_position: 1
title: HTTP Endpoints
---

# HTTP API Reference

Base URL: `https://packagesmcp-perception-production.up.railway.app`

## Health

```
GET /health
```

Returns service status, audit state, and chain tip.

```json
{
  "status": "ok",
  "service": "geiant-mcp-perception",
  "version": "0.3.1",
  "audit_active": true,
  "agent_pk": "c14094ea7efb6122",
  "chain_tip": 8,
  "tools": [
    "perception_fetch_tile",
    "perception_classify",
    "perception_embed",
    "perception_weather"
  ]
}
```

## MCP SSE

```
GET /sse          → SSE stream (MCP client connects here)
POST /message     → MCP messages (sessionId query param)
```

Standard MCP SSE transport. See [MCP Server guide](/integrations/mcp-server).

## Epoch Rollup

```
POST /epoch/roll
```

Rolls all breadcrumbs since the last epoch into a new epoch with a Merkle root.

**Response (200):**

```json
{
  "success": true,
  "epoch_index": 1,
  "block_count": 3,
  "start_block": 5,
  "end_block": 7,
  "merkle_root": "6fa3e35a8f8fd9d43ae35003...",
  "tier_at_close": "provisioned",
  "epoch_hash": "5c6b317cadc39538e0e114f0..."
}
```

**Error (500):** No blocks to roll since last epoch.

```json
{ "error": "EPOCH: no blocks to roll since block_index 8" }
```

## Compliance Report

```
GET /compliance
GET /compliance/:agent_pk
```

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `from` | ISO 8601 | `2020-01-01T00:00:00Z` | Period start |
| `to` | ISO 8601 | Now | Period end |

**Response:** Full [ComplianceReport](/compliance/compliance-reports) JSON.

**Example:**

```bash
# Full report for the server's agent
curl https://packagesmcp-perception-production.up.railway.app/compliance

# Filtered by date
curl "https://packagesmcp-perception-production.up.railway.app/compliance?from=2026-03-20T00:00:00Z"
```

## Weather Test

```
GET /test/weather
```

Quick diagnostic — calls `perception_weather` for Rome and drops a breadcrumb. Useful for verifying the audit trail is working.

```json
{
  "h3_cell": "851e8053fffffff",
  "temperature_c": 18.1,
  "status": "ok"
}
```
