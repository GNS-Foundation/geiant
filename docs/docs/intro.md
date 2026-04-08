---
slug: /
sidebar_position: 1
---

# GEIANT — Geospatial AI Governance Runtime

**Every AI agent action, cryptographically traceable to the human who authorized it.**

GEIANT is an open-source runtime that gives AI agents verifiable identity, jurisdictional boundaries, and an immutable audit trail — so enterprises can deploy autonomous agents and prove compliance with the EU AI Act, GDPR, and FINMA regulations.

GEIANT Hive extends this with a geospatial compute fabric: AI inference, map tile rendering, and satellite imagery processing — all settled on Stellar mainnet with cryptographic proofs stored in MobyDB.

## The Problem

AI agents are operating without identity. When an agent processes medical data in Frankfurt, trades securities in Zurich, or classifies satellite imagery over Rome — there is no cryptographic proof of:

- **Who authorized it** (which human principal?)
- **Where it operated** (which jurisdiction?)
- **What it did** (which tools, which data?)
- **Whether it was allowed to** (delegation scope?)

## The Solution

GEIANT provides three primitives that existing infrastructure lacks:

### 1. Agent Identity (Ed25519)

Every agent gets a cryptographic keypair. The public key **is** the identity — no usernames, no passwords, no OAuth tokens. Same key signs breadcrumbs, delegation certificates, and Stellar transactions.

```javascript
import { generateAgentIdentity } from '@gns-aip/sdk';

const agent = generateAgentIdentity();
// agent.publicKey  → "c14094ea7efb6122..." (64 hex chars)
// agent.stellarAddress → "GCAU..." (derived from same key)
```

### 2. Delegation Certificates

A human principal signs a certificate that says: "This agent may operate within these H3 cells, using these capabilities, until this date." Every agent action is checked against this certificate **before execution**.

```javascript
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

Every tool call produces a signed, hash-chained breadcrumb — an immutable record of what the agent did, where, when, and under whose authority.

## Architecture

GEIANT is built on six layers:

| Layer | Name | Purpose |
|-------|------|---------|
| **Layer 4** | **GEIANT Hive** | Geospatial compute fabric — inference, tiles, imagery, settlement |
| **DB** | **MobyDB** | Audit storage — epoch-sealed Merkle proofs, O(log n) verification |
| **Layer 3** | **GNS Human Identity** | Proof-of-Trajectory — breadcrumbs, trust tiers, @handles |
| **Layer 2** | **GNS-AIP** | Agent Identity Protocol — delegation, jurisdiction, EU AI Act |
| **Layer 1** | **GEP** | Geographic addressing fabric — 569 trillion addressable points |
| **Layer 0** | **H3 Grid** | Uber's hexagonal geospatial indexing system |

→ [Architecture deep dive](/architecture/overview)

## Who Is This For?

| Audience | Use Case |
|----------|----------|
| **Enterprise AI teams** | Deploy agents with auditable delegation chains for EU AI Act compliance |
| **AI framework authors** | Add identity + jurisdiction to LangChain, CrewAI, AutoGen agents |
| **GRC/compliance teams** | Runtime evidence generation for Art. 12/14 |
| **Developers** | AI inference, map tiles, satellite imagery — all via one API |
| **Device owners** | Run a Hive worker, earn GNS tokens from idle hardware |

## Live right now

- **Unified Compute API:** `POST /v1/compute` with step DAG (inference + tiles + imagery)
- **Tile API:** `GET /v1/tiles/{cell}/{zoom}/{style}.png` — 5 styles, no API key
- **Satellite:** `GET /v1/imagery/ndvi` — Sentinel-2 NDVI via Element84
- **Audit Trail:** [hive.geiant.com/audit](https://hive.geiant.com/audit) — live inference logs
- **@hai on Telegram:** proof footer on every response
- **Worker CLI:** `npx @gns-foundation/hive-worker join`

## Get Started

→ [Quick Start Guide](/quick-start)
→ [Hive Unified Compute API](/hive/unified-compute)
→ [Tile Rendering](/hive/tile-rendering)
→ [Satellite Imagery](/hive/satellite-imagery)
