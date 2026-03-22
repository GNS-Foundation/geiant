---
sidebar_position: 2
title: Quick Start
---

# Quick Start — 10 Minutes to Your First Auditable Agent

This guide walks you through the complete lifecycle: create an agent identity, delegate authority from a human principal, execute a tool call with an audit breadcrumb, and verify the chain.

## Prerequisites

- Node.js 18+
- npm or pnpm

## 1. Install the SDK

```bash
npm install @gns-aip/sdk
```

## 2. Generate Identities

Every participant in the system gets an Ed25519 keypair. In production, the human principal's key lives on their mobile device and never leaves it.

```typescript
import {
  generateAgentIdentity,
  agentIdentityFromSeed,
} from '@gns-aip/sdk';

// Human principal (in production: generated on mobile, SK never exported)
const principal = generateAgentIdentity();
console.log('Principal PK:', principal.publicKey);

// AI agent
const agent = generateAgentIdentity();
console.log('Agent PK:', agent.publicKey);
```

## 3. Create a Delegation Certificate

The principal authorizes the agent to operate within specific jurisdictional boundaries and capability scopes:

```typescript
import { createDelegationCert } from '@gns-aip/sdk';

const cert = await createDelegationCert({
  agentIdentity: agent.publicKey,
  principalIdentity: principal.publicKey,
  // H3 cells defining jurisdictional boundary (Rome metro area)
  territoryCells: ['851e8053fffffff'],
  // Capability scope — what the agent is allowed to do
  facetPermissions: ['energy'],
  // Certificate validity (hours)
  validityHours: 720,
}, principal.secretKey);

console.log('Cert hash:', cert.certHash);
console.log('Valid until:', cert.notAfter);
```

The certificate is Ed25519-signed by the principal. Anyone can verify the signature without contacting any server.

## 4. Drop a Breadcrumb

Every agent operation produces a signed, hash-chained breadcrumb:

```typescript
import { createVirtualBreadcrumb } from '@gns-aip/sdk';

const breadcrumb = await createVirtualBreadcrumb({
  agentIdentity: agent.publicKey,
  operationCell: '851e8053fffffff',
  meta: {
    operationType: 'weather_query',
    delegationCertHash: cert.certHash,
    facet: 'energy',
    withinTerritory: true,
    durationMs: 142,
  },
}, agent.secretKey, null); // null = genesis block

console.log('Block #0:', breadcrumb.blockHash);
```

Chain a second breadcrumb:

```typescript
const breadcrumb2 = await createVirtualBreadcrumb({
  agentIdentity: agent.publicKey,
  operationCell: '851e8053fffffff',
  meta: {
    operationType: 'tile_classification',
    delegationCertHash: cert.certHash,
    facet: 'energy',
    withinTerritory: true,
    durationMs: 3400,
    modelId: 'prithvi-eo-2.0',
  },
}, agent.secretKey, breadcrumb); // chains to previous

console.log('Block #1:', breadcrumb2.blockHash);
console.log('Previous:', breadcrumb2.previousHash); // === breadcrumb.blockHash
```

## 5. Verify the Chain

Anyone with the public key can verify the entire chain — signatures, hashes, and links:

```typescript
import { verifyBreadcrumbChain } from '@gns-aip/sdk';

const result = await verifyBreadcrumbChain(
  [breadcrumb, breadcrumb2],
  agent.publicKey,
);

console.log('Valid:', result.valid);        // true
console.log('Blocks:', result.blockCount);  // 2
console.log('Issues:', result.issues);      // []
```

## 6. Check Compliance Score

The trust tier system promotes agents based on their operational history:

```typescript
import { calculateComplianceScore, determineTier } from '@gns-aip/sdk';

const score = calculateComplianceScore({
  totalOperations: 2,
  successfulOperations: 2,
  jurisdictionViolations: 0,
  delegationViolations: 0,
  chainBreaks: 0,
  uniqueTerritoryCells: 1,
  daysSinceProvisioning: 0,
});

const tier = determineTier(score);
console.log('Score:', score);  // ~5.0
console.log('Tier:', tier);    // 'provisioned'
```

Tiers progress as the agent builds operational history:

| Tier | Min Operations | Trust % | Capabilities |
|------|---------------|---------|-------------|
| Provisioned | 0 | 0% | Read-only, sandboxed |
| Observed | 50 | 25% | Basic data processing |
| Trusted | 500 | 60% | Full data processing |
| Certified | 5,000 | 85% | Financial transactions |
| Sovereign | 50,000 | 99% | Full autonomy |

## What's Next?

- **[Architecture Overview](/architecture/overview)** — understand the four-layer stack
- **[LangChain Integration](/integrations/langchain)** — wrap existing LangChain agents in 3 lines
- **[MCP Server](/integrations/mcp-server)** — connect to the live GEIANT perception service
- **[EU AI Act Compliance](/compliance/eu-ai-act)** — map GEIANT to Art. 12/14 requirements
- **[HTTP API](/api/http-endpoints)** — epoch rollups and compliance reports
