---
sidebar_position: 3
title: Claude Managed Agents
description: Add EU AI Act compliance to Claude Managed Agents in one SSE endpoint
---

# Claude Managed Agents

Add geospatial identity, jurisdictional binding, and EU AI Act compliance to
**Claude Managed Agents** in one SSE endpoint — no infrastructure required.

## Why GEIANT + Claude Managed Agents

Claude Managed Agents gives you the execution runtime. GEIANT gives you the
accountability layer. Together they form the first complete sovereign agent
deployment stack:

| Layer | Provider | What it does |
|---|---|---|
| **Execution** | Anthropic | Sandboxed runtime, long-running sessions, multi-agent coordination |
| **Identity** | GEIANT | Ed25519 keypair — the agent's cryptographic identity |
| **Jurisdiction** | GEIANT | H3 territorial binding — which laws apply |
| **Audit trail** | GEIANT | Signed breadcrumb chain — what the agent did, when, under whose authority |
| **Compliance** | GEIANT | Auto-generated EU AI Act Art. 12 / Art. 14 report |

## Connect

Add GEIANT to your Claude Managed Agents session via the `mcp_servers` parameter:

```javascript
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "anthropic-beta": "managed-agents-2026-04-01",
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    mcp_servers: [
      {
        type: "url",
        url: "https://packagesmcp-perception-production.up.railway.app/sse",
        name: "geiant",
      }
    ],
    messages: [
      { role: "user", content: "Analyse flood risk for Rome and generate a compliance report." }
    ],
  }),
});
```

Every tool call made through the GEIANT MCP server automatically:

1. **Pre-flight** — checks the delegation certificate (jurisdiction, facet, temporal validity)
2. **Executes** — runs the tool
3. **Post-flight** — builds a SHA-256 context digest, chains to the previous block, Ed25519-signs, writes to the audit trail

If pre-flight fails, the tool call is **blocked** — it never executes.

## Available Tools

### Perception

| Tool | Description |
|---|---|
| `perception_weather` | Historical / forecast weather for any H3 cell via ERA5 |
| `perception_fetch_tile` | Sentinel-2 L2A satellite tiles via Element84 |
| `perception_classify` | Prithvi-EO-2.0 foundation model inference (flood detection, land use) |
| `perception_embed` | Clay v1.5 geospatial embeddings *(coming soon)* |

### Governance

| Tool | Description |
|---|---|
| `gns_get_compliance_report` | Full EU AI Act Art. 12 / Art. 14 report with chain verification, epochs, delegation cert, and violation history |
| `gns_get_trust_score` | Current TierGate tier and trust score |
| `gns_verify_chain` | Cryptographic integrity check of the breadcrumb chain |
| `gns_roll_epoch` | Seal pending breadcrumbs into a Merkle-rooted epoch snapshot |

## Example Agent Session

A Claude Managed Agent analysing flood risk and producing a compliance report
in a single session:

```javascript
// The agent autonomously calls tools in sequence:

// 1. Fetch satellite tile for Rome
perception_fetch_tile({ h3_cell: "851e8053fffffff", bands: ["B04", "B8A"] })

// 2. Run flood detection
perception_classify({ h3_cell: "851e8053fffffff", task: "flood_detection" })

// 3. Get current weather context
perception_weather({ h3_cell: "851e8053fffffff" })

// 4. Generate compliance report mid-session
gns_get_compliance_report()
// → {
//     agent_pk: "c14094ea...",
//     agent_handle: "energy@italy-geiant",
//     current_tier: "provisioned",
//     trust_score: 20.99,
//     chain_verification: { is_valid: true, block_count: 8, issues: [] },
//     violations: []
//   }

// 5. Seal the session into an epoch
gns_roll_epoch()
// → {
//     epoch_index: 1,
//     merkle_root: "6fa3e35a...",
//     block_count: 3
//   }
```

Every one of those tool calls is now a signed, hash-chained breadcrumb in the
audit trail — cryptographically traceable to the human principal who authorized
the agent.

## EU AI Act Compliance

GEIANT generates runtime evidence for the two articles that
documentation-only compliance cannot satisfy for agentic AI:

**Article 12 — Record-keeping**
Every tool call automatically produces a signed breadcrumb with:
- `context_digest` — SHA-256 of tool input + output
- `identity_public_key` — Ed25519 agent identity
- `delegation_cert_hash` — link to the human authorization
- Hash chain — tamper-evident, verifiable offline

**Article 14 — Human Oversight**
The delegation certificate proves:
- Which human principal authorized the agent (`principal_pk`)
- What the agent is allowed to do (`facets`, `allowed_tools`)
- Where it is allowed to operate (`h3_cells`)
- For how long (`not_before` / `not_after`)
- How many levels of sub-delegation are permitted (`max_depth`)

Pull the full report at any time:

```bash
curl https://packagesmcp-perception-production.up.railway.app/compliance | jq .
```

## Structural Advantage over Existing Solutions

Microsoft Entra Agent ID cannot produce:

1. **Third-party verifiable** proof of jurisdiction — Ed25519 signatures are
   verifiable by anyone without contacting a central authority
2. **Geospatially-bound** delegation — H3 cells are a geographic primitive,
   not an organizational one
3. **Cryptographically immutable** operation log — breadcrumb chains cannot
   be silently modified; any tampering invalidates all subsequent blocks

This is GEIANT's structural moat for EU AI Act compliance — and it plugs
directly into Claude Managed Agents with a single SSE URL.

## Live Status

```bash
curl https://packagesmcp-perception-production.up.railway.app/health | jq .
```

```json
{
  "status": "ok",
  "service": "geiant-mcp-perception",
  "version": "0.3.1",
  "audit_active": true,
  "agent_pk": "c14094ea7efb6122...",
  "chain_tip": 8,
  "tools": [
    "perception_fetch_tile",
    "perception_classify",
    "perception_embed",
    "perception_weather",
    "gns_get_compliance_report",
    "gns_get_trust_score",
    "gns_verify_chain",
    "gns_roll_epoch"
  ]
}
```

## See Also

- [MCP Server reference](./mcp-server) — SSE connection, tool schemas, audit trail detail
- [EU AI Act compliance](../compliance/eu-ai-act) — Art. 12 / Art. 14 deep dive
- [LangChain integration](./langchain) — for LangChain-based agent workflows
- [`@gns-aip/sdk`](https://www.npmjs.com/package/@gns-aip/sdk) — provision your own agent identity
