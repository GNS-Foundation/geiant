---
sidebar_position: 3
title: Delegation Certificates
---

# Delegation Certificates

A delegation certificate is the cryptographic link between a human principal and an AI agent. It answers: **who authorized this agent to do what, where, and until when?**

## Structure

```typescript
interface DelegationCertificate {
  version: 1;
  agent_pk: string;           // Agent's Ed25519 public key
  principal_pk: string;       // Human principal's Ed25519 public key
  h3_cells: string[];         // Allowed jurisdictional H3 cells
  facets: string[];           // Allowed capability scopes
  not_before: string;         // Validity start (ISO 8601)
  not_after: string;          // Validity end (ISO 8601)
  max_depth: number;          // Max sub-delegation depth (0 = none)
  constraints?: {
    max_ops_per_hour?: number;
    allowed_tools?: string[];
    denied_tools?: string[];
    require_human_approval?: string[];
    max_cost_per_op_xlm?: number;
  };
  principal_signature: string; // Ed25519 signature by principal
}
```

## Lifecycle

### 1. Creation

The human principal creates and signs the certificate. The agent never touches the principal's secret key:

```typescript
const cert = await createDelegationCert({
  agentIdentity: agent.publicKey,
  principalIdentity: principal.publicKey,
  territoryCells: ['851e8053fffffff', '851e8057fffffff'],
  facetPermissions: ['energy', 'transport'],
  validityHours: 720,
}, principal.secretKey);
```

### 2. Pre-flight Enforcement

Before every tool call, the audit middleware checks:

1. **Temporal validity** — Is `now` between `not_before` and `not_after`?
2. **Jurisdiction** — Is the target H3 cell in `h3_cells`?
3. **Facet** — Is the requested capability in `facets`?
4. **Tool whitelist** — Is the tool in `allowed_tools` (if set)?
5. **Tool blacklist** — Is the tool NOT in `denied_tools`?

If any check fails, the tool call is **blocked** and a compliance violation is logged.

### 3. Verification

Anyone can verify a delegation certificate with just the principal's public key — no server contact needed:

```typescript
import { verifyDelegationCert, isDelegationActive } from '@gns-aip/sdk';

const sigValid = verifyDelegationCert(cert);      // Ed25519 signature check
const isActive = isDelegationActive(cert);          // Temporal check
const inScope = isDelegationAuthorizedForCell(cert, '851e8053fffffff');
```

### 4. Revocation

Revocation is recorded in Supabase (`revoked_at` timestamp on the `delegation_certificates` table). A future version will support on-chain revocation via Stellar.

## Sub-Delegation

Agents can sub-delegate to other agents, creating a delegation chain:

```typescript
import { createSubDelegation, verifyDelegationChain } from '@gns-aip/sdk';

const subCert = await createSubDelegation({
  parentCert: cert,
  childAgentPk: subAgent.publicKey,
  // Sub-delegation can only narrow scope, never widen
  territoryCells: ['851e8053fffffff'], // subset of parent
  facetPermissions: ['energy'],         // subset of parent
}, agent.secretKey);

// Verify the full chain back to the human principal
const chain = await verifyDelegationChain([cert, subCert]);
console.log('Root principal:', chain.rootPrincipal); // human PK
```

**Key constraint**: Sub-delegation can only **narrow** scope — a child cert cannot have more territory, more facets, or a longer validity period than its parent. This is enforced cryptographically.

## EU AI Act Mapping

| Certificate Field | EU AI Act Article | Purpose |
|-------------------|-------------------|---------|
| `principal_pk` | Art. 14 (Human Oversight) | Proves human authorization |
| `h3_cells` | Art. 9 (Risk Management) | Jurisdictional boundary |
| `facets` | Art. 6 (Classification) | Capability scope |
| `not_after` | Art. 14 | Temporal boundary on autonomy |
| `max_depth` | Art. 14 | Limits delegation chain depth |
| `constraints` | Art. 14 | Operational guardrails |
