---
sidebar_position: 4
title: goose (Block / AAIF)
description: Add EU AI Act compliance to goose agents via GEIANT MCP server
---

# goose Integration

Add geospatial identity, jurisdictional binding, and EU AI Act compliance to
**goose** — the open-source, local-first agent framework from Block / AAIF — in one
config entry.

## Why GEIANT + goose

goose is the local-first counterpart to Claude Managed Agents. Where cloud
agents suit SaaS deployments, goose runs on-premise — which is exactly what
enterprises with strict data sovereignty requirements need.

| Layer | Provider | What it does |
|---|---|---|
| **Execution** | goose (Block / AAIF) | Local-first agent runtime, any LLM, on-premise |
| **Identity** | GEIANT | Ed25519 keypair — the agent's cryptographic identity |
| **Jurisdiction** | GEIANT | H3 territorial binding — which laws apply |
| **Audit trail** | GEIANT | Signed breadcrumb chain — what the agent did, when, under whose authority |
| **Compliance** | GEIANT | Auto-generated EU AI Act Art. 12 / Art. 14 report |

## Connect

Add GEIANT to your goose config (`~/.config/goose/config.yaml`):

```yaml
extensions:
  geiant:
    name: geiant
    type: streamable_http
    uri: https://packagesmcp-perception-production.up.railway.app/mcp
    enabled: true
    timeout: 30
```

Restart goose. All 8 GEIANT tools are immediately available in any session.

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
| `gns_get_compliance_report` | Full EU AI Act Art. 12 / Art. 14 report |
| `gns_get_trust_score` | Current TierGate tier and trust score |
| `gns_verify_chain` | Cryptographic integrity check of the breadcrumb chain |
| `gns_roll_epoch` | Seal pending breadcrumbs into a Merkle-rooted epoch snapshot |

## Example Session

```bash
goose session
```

```
> Call gns_get_trust_score.

▸ gns_get_trust_score geiant

Agent Handle:    energy@italy-geiant
Agent PK:        c14094ea...fbc04
Current Tier:    provisioned
Trust Score:     21.12%
Total Ops:       8
Violations:      None ✅
Jurisdiction:    851e8053fffffff (Italy)
```

Every tool call in that session is a signed, hash-chained breadcrumb in the
audit trail — cryptographically traceable to the human principal who authorized
the agent.

## EU AI Act — Why Local Agents Need This Most

Cloud agents can implement compliance as a platform feature. Local agents
cannot — there is no intermediary to enforce it. GEIANT fills this gap:

- **Data stays local** — goose processes data on your machine; GEIANT adds
  the audit layer without routing data through a cloud provider
- **Jurisdiction is explicit** — H3 territorial binding declares which laws
  apply before the agent acts, not after
- **Chain is tamper-evident** — breadcrumbs are Ed25519-signed and hash-chained;
  any tampering invalidates all subsequent blocks

This makes GEIANT + goose the only local-first EU AI Act compliance stack
available today.

## goose + AAIF

goose is part of the **Agentic AI Foundation (AAIF)** at the Linux Foundation,
alongside Anthropic's MCP and OpenAI's AGENTS.md. AAIF platinum members include
AWS, Anthropic, Block, Bloomberg, Cloudflare, Google, Microsoft, and OpenAI.

GEIANT is listed in the official MCP Registry (`com.geiant/mcp-perception`) and
works with any MCP-compliant client in the AAIF ecosystem.

## See Also

- [MCP Server reference](./mcp-server) — connection details, tool schemas, audit trail
- [Claude Managed Agents](./claude-managed-agents) — cloud-hosted counterpart
- [EU AI Act compliance](../compliance/eu-ai-act) — Art. 12 / Art. 14 deep dive
- [goose documentation](https://goose-docs.ai) — goose setup and extensions
