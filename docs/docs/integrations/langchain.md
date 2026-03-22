---
sidebar_position: 1
title: LangChain
---

# LangChain Integration

`langchain-gns-aip` wraps any LangChain agent with GEIANT identity, delegation, and audit trails in three lines of code.

## Installation

```bash
npm install langchain-gns-aip @gns-aip/sdk
```

## Quick Start

```typescript
import { GNSAgentIdentity } from 'langchain-gns-aip';

// 1. Provision: create agent identity
const id = await GNSAgentIdentity.provision({
  domain: 'energy',
  handle: 'flood-monitor',
});

// 2. Delegate: human principal authorizes the agent
await id.delegate(principalPublicKey, {
  scope: {
    territoryCells: ['851e8053fffffff'],
    facets: ['energy'],
    validityHours: 720,
  },
});

// 3. Wrap: every tool call now drops an audit breadcrumb
const agent = id.wrap(myLangChainAgent);
```

Every tool invocation through the wrapped agent now:
1. Checks the delegation certificate (jurisdiction, facet, validity)
2. Executes the tool
3. Drops a signed breadcrumb to the audit trail
4. Chains to the previous breadcrumb

## Compliance Callback

For real-time compliance monitoring, use the callback handler:

```typescript
import { GNSComplianceCallback } from 'langchain-gns-aip';

const callback = new GNSComplianceCallback({
  agentIdentity: id,
  onViolation: (event) => {
    console.error('Compliance violation:', event.type, event.description);
    // Alert, log, escalate
  },
  onBreadcrumb: (event) => {
    console.log('Breadcrumb dropped:', event.blockHash);
  },
});

const agent = id.wrap(myLangChainAgent, { callbacks: [callback] });
```

## Delegation Tool

Expose delegation status as a LangChain tool — useful when the agent needs to check its own authority:

```typescript
import { createGNSDelegationTool } from 'langchain-gns-aip';

const delegationTool = createGNSDelegationTool(id);
// Agent can now call this tool to check:
// - Am I authorized for this H3 cell?
// - Is my certificate still valid?
// - What facets am I allowed?
```

## What Happens Under the Hood

When a wrapped agent calls a tool:

```
Agent.invoke("Check flood risk for Rome")
  │
  ├─► LangChain routes to tool
  │
  ├─► GNS pre-flight check
  │   ├── Cert valid? ✅
  │   ├── Cell authorized? ✅
  │   ├── Facet authorized? ✅
  │   └── Tool whitelisted? ✅
  │
  ├─► Tool executes (e.g., weather API call)
  │
  ├─► GNS post-flight
  │   ├── Build context digest (SHA-256 of I/O)
  │   ├── Chain to previous block
  │   ├── Ed25519 sign
  │   └── Write breadcrumb to Supabase
  │
  └─► Return result to agent
```

## npm

- **Package**: [`langchain-gns-aip`](https://www.npmjs.com/package/langchain-gns-aip)
- **Version**: 0.1.0
- **Peer dependency**: `@gns-aip/sdk ^0.1.0`
