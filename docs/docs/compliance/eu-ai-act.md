---
sidebar_position: 1
title: EU AI Act
---

# EU AI Act Compliance

The EU AI Act enters enforcement on **August 2, 2026**. GEIANT provides runtime evidence generation for Article 12 (Record-keeping) and Article 14 (Human Oversight) — the two articles that documentation-only compliance cannot satisfy for agentic AI systems.

## The Gap

Traditional compliance approaches produce documentation: risk assessments, data sheets, process descriptions. This works for static ML models. It breaks for **multi-agent agentic AI** where:

- Agents delegate to sub-agents autonomously
- Operations span multiple jurisdictions in a single chain
- Tool calls happen faster than any human can review
- Service accounts obscure the human-agent authorization chain

**GEIANT closes the gap** by generating cryptographic proof of compliance at runtime — not after the fact.

## Article 12 — Record-keeping

> *"High-risk AI systems shall technically allow for the automatic recording of events ('logs') over the lifetime of the system."*

### What Art. 12 Requires

The system must maintain logs that enable:
- Tracing the operation of the AI system throughout its lifecycle
- Monitoring of the AI system's operation
- Post-market surveillance

### How GEIANT Satisfies It

| Requirement | GEIANT Implementation |
|-------------|----------------------|
| Automatic event recording | Every tool call drops a signed breadcrumb — no manual logging |
| Traceable to operation | `context_digest` = SHA-256 of tool input + output |
| Traceable to agent | `identity_public_key` = Ed25519 agent PK |
| Traceable to authorization | `delegation_cert_hash` = link to delegation certificate |
| Tamper-evident | SHA-256 hash chain — modify one block, all subsequent blocks invalid |
| Persistent | Stored in Supabase PostgreSQL with Row Level Security |
| Auditable | `GET /compliance` generates a full report on demand |

### Evidence Chain

```
Human Principal (Ed25519 PK: 262507c6...)
  │
  ├── signs DelegationCertificate
  │     ├── agent_pk: c14094ea...
  │     ├── h3_cells: [851e8053fffffff]
  │     ├── facets: [energy]
  │     └── valid_until: 2026-12-31
  │
  └── Agent operates under certificate
        ├── Block #0: perception_weather → SHA-256 chain
        ├── Block #1: perception_classify → chains to #0
        ├── ...
        └── Epoch #0: Merkle root over blocks 0→4
```

Every link in this chain is cryptographically verifiable without contacting any server.

## Article 14 — Human Oversight

> *"High-risk AI systems shall be designed and developed in such a way [...] that they can be effectively overseen by natural persons during the period in which the AI system is in use."*

### What Art. 14 Requires

- Natural persons can understand the system's capabilities and limitations
- Natural persons can decide when and how to use the system
- Natural persons can intervene or interrupt the system

### How GEIANT Satisfies It

| Requirement | GEIANT Implementation |
|-------------|----------------------|
| **"Seamless chain traceable to living person"** | Delegation certificate links agent PK → principal PK (human) |
| **Understand capabilities** | `facets` field defines what the agent can do |
| **Decide when/how** | `not_before` / `not_after` temporal boundaries |
| **Intervene** | Certificate revocation stops all operations immediately |
| **Interrupt** | `require_human_approval` constraint on specific tools |
| **Limit territory** | `h3_cells` confines agent to specific jurisdictions |
| **Limit delegation** | `max_depth` prevents unbounded sub-delegation |

### The Structural Gap in Existing Solutions

Microsoft Entra Agent ID, for example, cannot produce:

1. **Third-party verifiable** proof of jurisdiction — Ed25519 signatures can be verified by anyone, not just the issuing cloud provider
2. **Geospatially-bound** delegation — H3 cells are a geographic primitive, not an organizational one
3. **Cryptographically immutable** operation log — breadcrumb chains cannot be silently modified

This is GEIANT's structural moat for EU AI Act compliance.

## Compliance Report

The `GET /compliance` endpoint generates a complete Art. 12/14 report:

```json
{
  "version": 1,
  "generated_at": "2026-03-22T08:49:44.408Z",
  "agent_pk": "c14094ea7efb6122...",
  "agent_handle": "energy@italy-geiant",
  "principal_pk": "262507c61565a59e...",
  "reporting_period": { "from": "...", "to": "..." },

  "total_operations": 8,
  "operations_by_tool": { "perception_weather": 8 },
  "jurisdiction_cells": ["851e8053fffffff"],
  "chain_verification": { "is_valid": true, "block_count": 8, "issues": [] },
  "epochs": [{ "epoch_index": 0, "block_count": 5, "merkle_root": "..." }],

  "delegation_certificate": { "principal_pk": "262507c6...", "..." },
  "delegation_chain_depth": 1,

  "current_tier": "provisioned",
  "trust_score": 15.66,
  "violations": []
}
```

→ [Compliance Report Reference](/compliance/compliance-reports)
