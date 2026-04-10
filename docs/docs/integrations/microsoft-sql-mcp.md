---
sidebar_position: 3
---

# Microsoft SQL MCP Server

`@gns-foundation/mcp-client-sql` wraps Microsoft's [SQL MCP Server](https://aka.ms/sql/mcp) (Data API builder) with GEIANT's full governance pipeline — delegation pre-flight, Ed25519-signed breadcrumbs, and EU AI Act compliance reporting — in a single install.

## What is Microsoft SQL MCP Server?

Microsoft's SQL MCP Server is a feature of [Data API builder](https://aka.ms/dab) that exposes enterprise SQL databases as MCP tools. Agents can query entities, execute stored procedures, and read relational data over a standard SSE connection — without schema exposure or fragile natural language parsing.

It handles **data access security** (RBAC, Azure Key Vault, OAuth/Entra).  
GEIANT handles **agent governance** (who authorized the agent, what territory, full audit trail).

## How it fits together

```
LangChain / AutoGen / custom orchestrator
  │
  ├─► GEIANT pre-flight gate
  │   ├── Delegation certificate valid? ✅
  │   ├── H3 cell within territory? ✅
  │   └── Facet authorized? ✅
  │
  ├─► Microsoft SQL MCP Server (Data API builder / SSE)
  │   └── SQL query executes
  │
  └─► GEIANT breadcrumb drop
      ├── SHA-256 context digest (tool input + output)
      ├── Ed25519 signed by agent
      ├── Chained to previous block
      └── Written to audit store
```

Every SQL tool call becomes a governed, auditable operation traceable back to the human principal who signed the delegation certificate.

## Installation

```bash
npm install @gns-foundation/mcp-client-sql
```

**Peer dependencies:** `@gns-aip/sdk ^0.1.0`, `@langchain/core >=0.3.0`

## Quick Start

```typescript
import { SqlMcpClient } from '@gns-foundation/mcp-client-sql';
import { createDelegationCert, generateAgentIdentity } from '@gns-aip/sdk';
import { latLngToH3 } from '@gns-aip/sdk';

// 1. Identities
const principal = generateAgentIdentity(); // human — SK stays on device in production
const agent     = generateAgentIdentity();

// 2. Delegation certificate (human → agent)
const cert = await createDelegationCert({
  deployerIdentity:  principal.publicKey,
  principalIdentity: principal.publicKey,
  agentIdentity:     agent.publicKey,
  territoryCells:    [latLngToH3(41.9028, 12.4964, 7)], // Rome
  facetPermissions:  ['energy'],
  validUntil:        new Date(Date.now() + 30 * 86_400_000).toISOString(),
}, principal.secretKey);

// 3. Connect to Microsoft SQL MCP Server
const sqlClient = await SqlMcpClient.connect({
  endpoint:       'https://your-tenant.azure-api.net/mcp/sse', // Data API builder endpoint
  agentIdentity:  agent,
  delegationCert: cert,
  operationCell:  latLngToH3(41.9028, 12.4964, 7),
  facet:          'energy',
  authToken:      process.env.AZURE_API_KEY,    // optional — Azure Key Vault / OAuth
  supabaseUrl:    process.env.SUPABASE_URL,     // optional — breadcrumb persistence
  supabaseKey:    process.env.SUPABASE_KEY,
});

// 4. Get governed LangChain tools (one per SQL MCP tool)
const tools = await sqlClient.asLangChainTools();
console.log(tools.map(t => t.name));
// ['sql_query_entities', 'sql_get_by_pk', 'sql_execute_stored_procedure', ...]

// 5. Use with any LangChain agent
const agent = createToolCallingAgent({ llm, tools, prompt });
```

Every tool call now:
- Checks the delegation certificate **before** the SQL query fires
- Drops a signed, hash-chained breadcrumb **after** execution
- Returns a `governance_violation` error (no query fired) if pre-flight fails

## Breadcrumb callback

Inspect governance events in real time:

```typescript
const sqlClient = await SqlMcpClient.connect(opts, ({ breadcrumb, toolName, latencyMs }) => {
  console.log(`✓ Block #${breadcrumb.index} | ${toolName} | ${latencyMs}ms | ${breadcrumb.blockHash.slice(0, 12)}…`);
});
```

## Pre-flight checks

The governance gate runs three checks before every SQL call:

| Check | Failure response |
|---|---|
| `isDelegationActive(cert)` | `governance_violation: Certificate not active` |
| `isDelegationAuthorizedForCell(cert, cell)` | `governance_violation: H3 cell outside territory` |
| `isDelegationAuthorizedForFacet(cert, facet)` | `governance_violation: Facet not authorised` |

If any check fails, the SQL tool **never executes** and a compliance violation is logged.

## Compliance report

After your agent runs, fetch a full EU AI Act Art. 12/14 report:

```bash
curl https://your-geiant-service/compliance?agent_pk=<agent_public_key>
```

```json
{
  "total_operations": 42,
  "chain_verification": { "is_valid": true, "block_count": 42, "issues": [] },
  "delegation_certificate": { "principal_pk": "...", "validUntil": "..." },
  "violations": [],
  "current_tier": "observed"
}
```

→ [Compliance Report Reference](../compliance/compliance-reports)

## Structural gap vs. Microsoft Entra Agent ID

Microsoft Entra Agent ID manages agent authentication within Azure. It cannot produce:

1. **Third-party verifiable** proof — Ed25519 signatures are verifiable by anyone, offline, without contacting Microsoft
2. **Geospatially-bound** delegation — H3 cells are a geographic primitive, not an organizational one
3. **Cryptographically immutable** audit log — breadcrumb chains cannot be silently modified; CloudTrail entries can

GEIANT and Microsoft SQL MCP Server are complementary: Microsoft secures the data layer, GEIANT governs the agent layer.

## npm

- **Package**: [`@gns-foundation/mcp-client-sql`](https://www.npmjs.com/package/@gns-foundation/mcp-client-sql)
- **Version**: 0.1.0
- **License**: Apache-2.0
- **Source**: [GNS-Foundation/geiant](https://github.com/GNS-Foundation/geiant/tree/main/packages/mcp-client-sql)
