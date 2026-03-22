---
slug: /
sidebar_position: 1
title: What is GEIANT?
---

# GEIANT — Geospatial AI Governance Runtime

**Every AI agent action, cryptographically traceable to the human who authorized it.**

GEIANT is an open-source runtime that gives AI agents verifiable identity, jurisdictional boundaries, and an immutable audit trail — so enterprises can deploy autonomous agents and prove compliance with the EU AI Act, GDPR, and FINMA regulations.

## The Problem

AI agents are operating without identity. When an agent processes medical data in Frankfurt, trades securities in Zurich, or classifies satellite imagery over Rome — there is no cryptographic proof of:

- **Who authorized it** (which human principal?)
- **Where it operated** (which jurisdiction?)
- **What it did** (which tools, which data?)
- **Whether it was allowed to** (delegation scope?)

Existing solutions (OAuth tokens, CloudTrail logs, service accounts) fail three critical tests:

1. **Delegation chains are not auditable** — you can't trace a service account back to the human who approved the agent's creation
2. **No pre-flight jurisdiction enforcement** — logs record violations after the fact, not prevent them
3. **Mutable logs** — CloudTrail entries can be deleted; breadcrumb chains cannot

## The Solution

GEIANT provides three primitives that existing infrastructure lacks:

### 1. Agent Identity (Ed25519)

Every agent gets a cryptographic keypair. The public key **is** the identity — no usernames, no passwords, no OAuth tokens. Same key signs breadcrumbs, delegation certificates, and Stellar transactions.

```typescript
import { generateAgentIdentity } from '@gns-aip/sdk';

const agent = generateAgentIdentity();
// agent.publicKey  → "c14094ea7efb6122..." (64 hex chars)
// agent.stellarAddress → "GCAU..." (derived from same key)
```

### 2. Delegation Certificates

A human principal signs a certificate that says: "This agent may operate within these H3 cells, using these capabilities, until this date." Every agent action is checked against this certificate **before execution**.

```typescript
import { createDelegationCert } from '@gns-aip/sdk';

const cert = await createDelegationCert({
  agentIdentity: agent.publicKey,
  principalIdentity: human.publicKey,
  territoryCells: ['851e8053fffffff'], // Rome
  facetPermissions: ['energy'],
  validityHours: 720, // 30 days
}, human.secretKey);
```

### 3. Virtual Breadcrumbs

Every tool call produces a signed, hash-chained breadcrumb — an immutable record of what the agent did, where, when, and under whose authority. Breadcrumbs are SHA-256 chained: tamper with one and every subsequent block is invalid.

```typescript
import { createVirtualBreadcrumb } from '@gns-aip/sdk';

const crumb = await createVirtualBreadcrumb({
  agentIdentity: agent.publicKey,
  operationCell: '851e8053fffffff',
  meta: {
    operationType: 'perception_weather',
    delegationCertHash: cert.certHash,
    facet: 'energy',
    withinTerritory: true,
  },
}, agent.secretKey, previousBlock);
```

## Who Is This For?

| Audience | Use Case |
|----------|----------|
| **Enterprise AI teams** | Deploy agents with auditable delegation chains for EU AI Act compliance |
| **AI framework authors** | Add identity + jurisdiction to LangChain, CrewAI, AutoGen agents |
| **GRC/compliance teams** | Runtime evidence generation (not just documentation) for Art. 12/14 |
| **Infrastructure providers** | Embed agent governance into cloud platforms and edge networks |

## Architecture

GEIANT is built on four layers:

| Layer | Name | Purpose |
|-------|------|---------|
| 0 | **H3 Grid** | Uber's hexagonal geospatial indexing — 569 trillion addressable points |
| 1 | **GEP** | Geographic addressing fabric — open infrastructure |
| 2 | **Agent Identity Protocol** | Delegation, jurisdiction, breadcrumbs, trust tiers |
| 3 | **Perception Runtime** | Satellite imagery, weather, embeddings — MCP-native |

→ [Architecture deep dive](/architecture/overview)

## Get Started

The fastest path: install the SDK and have a working agent identity in under 10 minutes.

→ [Quick Start Guide](/quick-start)
