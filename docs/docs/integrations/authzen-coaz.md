---
sidebar_position: 7
---

# AuthZen COAZ — Jurisdictional Context for MCP

How GEIANT maps to the [OpenID AuthZen MCP Profile](https://openid.github.io/authzen/authzen-mcp-profile-1_0.html) for EU AI Act compliance.

## Background

The AuthZen MCP Profile (Draft 1, February 2026) defines a standardized mapping from MCP tool invocations to the **SARC model**: Subject, Action, Resource, Context. This enables fine-grained, parameter-level authorization via an AuthZen Policy Decision Point (PDP) before executing MCP tools.

The profile defines the framework but leaves the **Context** vocabulary open. For regulated environments — particularly the EU AI Act (enforcement: August 2, 2026) — the Context field needs to carry jurisdictional, delegation, and audit data.

GEIANT provides this data natively.

## The SARC Model + GEIANT

| SARC Field | AuthZen Definition | GEIANT Contribution |
|------------|-------------------|---------------------|
| **Subject** | Identity making the request | GNS Ed25519 public key + delegation chain to human principal |
| **Action** | Tool being invoked | Standard — tool name from `params.name` |
| **Resource** | What the tool operates on | Standard — mapped from tool arguments via CEL |
| **Context** | Additional authorization context | **Jurisdictional context**: H3 cell, delegation certificate, GEP epoch, trust tier |

## Jurisdictional Context Schema

We propose the following context structure for COAZ-compatible tools operating under EU AI Act requirements:

```json
{
  "context": [{
    "agent_identity": "token.client_id",
    "jurisdiction": {
      "h3_cell": "params.arguments.h3_cell",
      "h3_resolution": "params.arguments.h3_resolution",
      "country_code": "'IT'",
      "regulation": "'eu-ai-act'",
      "enforcement_date": "'2026-08-02'"
    },
    "delegation": {
      "principal_pk": "token.gns_principal_pk",
      "cert_hash": "token.gns_delegation_cert",
      "trust_tier": "token.gns_trust_tier",
      "max_depth": "token.gns_max_depth"
    },
    "audit": {
      "epoch_index": "params.arguments.gep_epoch",
      "chain_tip_hash": "params.arguments.chain_tip",
      "block_count": "params.arguments.block_count"
    }
  }]
}
```

All values are CEL expressions evaluated against the tool call `params` and JWT `token` claims, per the AuthZen MCP Profile specification (Section 4.2).

## Full COAZ Mapping Example

A GEIANT-powered energy grid monitoring tool with jurisdictional authorization:

```json
{
  "name": "monitor_energy_grid",
  "coaz": true,
  "title": "Energy Grid Monitor",
  "description": "Monitor energy grid telemetry within authorized Italian territory",
  "inputSchema": {
    "type": "object",
    "properties": {
      "h3_cell": {
        "type": "string",
        "description": "H3 hexagonal cell ID (resolution 5)"
      },
      "metric": {
        "type": "string",
        "enum": ["voltage", "frequency", "load"],
        "description": "Grid metric to monitor"
      }
    },
    "required": ["h3_cell", "metric"],
    "x-coaz-mapping": {
      "subject": [{
        "type": "'gns_agent'",
        "id": "token.sub",
        "gns_pk": "token.gns_agent_pk"
      }],
      "action": [{
        "name": "params.name"
      }],
      "resource": [{
        "type": "'energy_grid'",
        "id": "params.arguments.h3_cell",
        "metric": "params.arguments.metric"
      }],
      "context": [{
        "agent_identity": "token.client_id",
        "jurisdiction": {
          "h3_cell": "params.arguments.h3_cell",
          "country_code": "'IT'",
          "regulation": "'eu-ai-act'"
        },
        "delegation": {
          "principal_pk": "token.gns_principal_pk",
          "cert_hash": "token.gns_delegation_cert",
          "trust_tier": "token.gns_trust_tier"
        },
        "audit": {
          "epoch_index": "token.gns_epoch",
          "chain_tip_hash": "token.gns_chain_tip"
        }
      }]
    }
  }
}
```

## What the PDP Can Enforce

With jurisdictional context in the SARC model, a Policy Decision Point can make decisions like:

| Policy Rule | SARC Fields Used |
|-------------|-----------------|
| Agent must operate within delegated H3 cells | `context.jurisdiction.h3_cell` vs delegation certificate territory |
| Trust tier must be "Observed" or above for PII tools | `context.delegation.trust_tier` |
| Delegation certificate must not be expired | `context.delegation.cert_hash` → lookup validity |
| Tool call must be within EU jurisdiction for GDPR tools | `context.jurisdiction.country_code` |
| Audit chain must be unbroken | `context.audit.chain_tip_hash` → verify Merkle path |

## How It Maps to EU AI Act

| EU AI Act Article | Requirement | SARC Field |
|-------------------|-------------|------------|
| Art. 9 — Risk management | Risk assessment before deployment | `context.delegation.trust_tier` (TierGate) |
| Art. 12 — Record-keeping | Automatic logging of AI system operation | `context.audit.epoch_index`, `context.audit.chain_tip_hash` |
| Art. 13 — Transparency | Users informed about AI system operation | Tool `description` + `coaz: true` declaration |
| Art. 14 — Human oversight | Human-in-the-loop for high-risk systems | `context.delegation.principal_pk` (delegation chain to human) |

## GNS JWT Claims

GEIANT-issued JWT tokens include custom claims that feed the COAZ mapping:

| Claim | Type | Description |
|-------|------|-------------|
| `gns_agent_pk` | string (64 hex) | Agent's Ed25519 public key |
| `gns_principal_pk` | string (64 hex) | Delegating human's Ed25519 public key |
| `gns_delegation_cert` | string (64 hex) | Blake3 hash of the delegation certificate |
| `gns_trust_tier` | string | Current TierGate tier: `provisioned`, `observed`, `trusted`, `certified` |
| `gns_epoch` | integer | Current GEP epoch index |
| `gns_chain_tip` | string (64 hex) | Latest block hash in the audit chain |
| `gns_h3_cells` | string[] | Authorized H3 cells from delegation certificate |

## Live Implementation

The GEIANT MCP server already produces all the data needed for jurisdictional COAZ context:

```bash
# Compliance report with full chain verification, delegation, trust score
curl https://packagesmcp-perception-production.up.railway.app/compliance

# Trust score and tier
curl https://packagesmcp-perception-production.up.railway.app/compliance | jq '{trust_score, current_tier}'

# Chain integrity
curl https://packagesmcp-perception-production.up.railway.app/compliance | jq '.chain_verification'
```

The compliance dashboard MCP App renders this data interactively inside Claude, Claude Desktop, and goose.

## References

- [OpenID AuthZen MCP Profile — Draft 1](https://openid.github.io/authzen/authzen-mcp-profile-1_0.html)
- [OpenID AuthZen Authorization API](https://openid.net/specs/authorization-api-1_0-03.html)
- [EU AI Act — Regulation (EU) 2024/1689](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689)
- [IETF draft-ayerbe-trip-protocol-03](https://datatracker.ietf.org/doc/draft-ayerbe-trip-protocol)
- [GEP — GeoEpoch Protocol](https://github.com/GNS-Foundation/gep-core)
- [MCP Server — GEIANT Perception Service](/integrations/mcp-server)
