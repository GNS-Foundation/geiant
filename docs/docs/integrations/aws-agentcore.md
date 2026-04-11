---
sidebar_position: 6
title: AWS AgentCore
description: Deploy GEIANT governance tools on AWS AgentCore Runtime
---

# AWS AgentCore Integration

Deploy GEIANT's AI governance tools on **AWS AgentCore Runtime** — the managed
platform for building, deploying, and operating agents at scale.

## Why GEIANT + AgentCore

AWS AgentCore provides the runtime. GEIANT provides the governance layer that
AgentCore doesn't ship — cryptographic proof of jurisdiction, tamper-evident
audit trails, and human→agent delegation chains required by EU AI Act.

| Layer | Provider | What it does |
|---|---|---|
| **Runtime** | AWS AgentCore | Managed agent hosting, scaling, observability |
| **Registry** | AWS Agent Registry | Centralized discovery of agents, tools, MCP servers |
| **Identity** | GEIANT | Ed25519 keypair — the agent's cryptographic identity |
| **Jurisdiction** | GEIANT | H3 territorial binding — which laws apply |
| **Audit trail** | GEIANT | Signed breadcrumb chain — what the agent did, when, under whose authority |
| **Compliance** | GEIANT | Auto-generated EU AI Act Art. 12 / Art. 14 evidence bundle |

## Architecture

GEIANT runs as an MCP server on AgentCore Runtime at `0.0.0.0:8000/mcp`
(the AgentCore default). Any agent in the AgentCore ecosystem can call
GEIANT's three governance tools over Streamable HTTP.

```
┌─────────────────────────────────────────────────────────┐
│  AWS AgentCore Runtime                                  │
│                                                         │
│  ┌──────────────┐    POST /mcp    ┌──────────────────┐  │
│  │  Your Agent   │───────────────▶│  GEIANT          │  │
│  │  (any LLM)    │◀───────────────│  AgentCore MCP   │  │
│  └──────────────┘    SSE stream   │                  │  │
│                                   │  • verify_juris. │  │
│                                   │  • audit_proof   │  │
│                                   │  • deleg_chain   │  │
│                                   └────────┬─────────┘  │
│                                            │            │
└────────────────────────────────────────────┼────────────┘
                                             │ HTTPS
                                    ┌────────▼─────────┐
                                    │ GEIANT Perception │
                                    │ (compliance API)  │
                                    └──────────────────┘
```

## Tools

### `verify_jurisdiction`

Validate that an AI agent is authorized to operate in a specific H3 cell.
Checks delegation certificate signature, temporal bounds, cell authorization,
and facet authorization.

```json
{
  "h3_cell": "851e8053fffffff",
  "facet": "energy@italy-geiant"
}
```

Returns:

```json
{
  "authorized": true,
  "signature_valid": true,
  "cert_active": true,
  "cell_authorized": true,
  "facet_authorized": true,
  "agent_pk": "c14094ea...",
  "principal_pk": "39545553...",
  "valid_until": "2027-04-10T19:39:32.969Z"
}
```

### `generate_audit_proof`

Produce a EU AI Act Art. 12 (record-keeping) and Art. 14 (human oversight)
compliance evidence bundle. Returns cryptographic audit chain, Merkle epoch
roots, delegation certificate, trust score, and violation history.

```json
{
  "agent_pk": "c14094ea...",
  "from": "2026-01-01T00:00:00Z",
  "to": "2026-04-11T00:00:00Z"
}
```

### `check_delegation_chain`

Verify the human→agent authorization chain and check whether a specific tool
is whitelisted. Answers: "Did a real human authorize this AI action?"

```json
{
  "tool_name": "perception_fetch_tile"
}
```

Returns:

```json
{
  "authorized": true,
  "human_principal_pk": "39545553...",
  "agent_pk": "c14094ea...",
  "signature_valid": true,
  "tool_allowed": true,
  "allowed_tools": [
    "perception_fetch_tile",
    "perception_classify",
    "perception_embed",
    "perception_weather",
    "spatial_query",
    "trajectory_audit",
    "compliance_report",
    "gns_get_compliance_report",
    "gns_get_trust_score",
    "gns_verify_chain",
    "gns_roll_epoch"
  ]
}
```

## Connect — Public Endpoint

The GEIANT AgentCore MCP server is live and publicly accessible:

```
https://geiant-agentcore-production.up.railway.app/mcp
```

Any MCP client can connect directly:

```json
{
  "mcpServers": {
    "geiant-agentcore": {
      "type": "streamable-http",
      "url": "https://geiant-agentcore-production.up.railway.app/mcp"
    }
  }
}
```

## Connect — AWS AgentCore Runtime

To deploy inside your own AgentCore Runtime:

**1. Clone and install**

```bash
git clone https://github.com/GNS-Foundation/geiant
cd geiant/packages/mcp-agentcore
npm install
```

**2. Set environment variables**

```bash
export PORT=8000
export GEIANT_DELEGATION_CERT='{ ... your delegation cert JSON ... }'
export COMPLIANCE_URL=https://packagesmcp-perception-production.up.railway.app
```

**3. Deploy via AgentCore CLI**

```bash
npm install -g @aws/agentcore
agentcore init --protocol mcp
# Point entrypoint to dist/index.js
agentcore deploy
```

AgentCore expects MCP servers at `0.0.0.0:8000/mcp` — GEIANT is pre-configured
to match this spec exactly.

## MCP Registry

GEIANT is published on the official MCP Registry under the `com.geiant` namespace:

| Server | Version | Transport |
|---|---|---|
| `com.geiant/mcp-agentcore` | 0.1.0 | Streamable HTTP |
| `com.geiant/mcp-perception` | 0.3.3 | Streamable HTTP |

Browse at [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io)

## AWS Agent Registry

To register GEIANT in your organization's AWS Agent Registry, point the
registry at the live MCP endpoint — it auto-discovers tools, schemas,
and capabilities:

1. Open **AgentCore Console** → **Agent Registry**
2. Click **Register resource** → **URL-based discovery**
3. Enter: `https://geiant-agentcore-production.up.railway.app/mcp`
4. The registry pulls tool schemas automatically
5. Submit for approval

## Health Check

```bash
curl https://geiant-agentcore-production.up.railway.app/health
```

```json
{
  "status": "ok",
  "service": "geiant-agentcore",
  "version": "0.1.0",
  "tools": [
    "verify_jurisdiction",
    "generate_audit_proof",
    "check_delegation_chain"
  ],
  "cert_loaded": true
}
```

## Key Technical Notes

- **Port 8000** — matches AgentCore Runtime spec
- **Streamable HTTP** at `/mcp` — MCP 2024-11-05 protocol
- **No `express.json()` globally** — MCP SDK needs the raw stream
- **Delegation cert** via `GEIANT_DELEGATION_CERT` env var (JSON string)
- **Signature verification** uses GNS canonical JSON with snake_case fields
- **Ed25519 keys** serve triple duty: GNS identity, Stellar wallet, GEIANT worker
