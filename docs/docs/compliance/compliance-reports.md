---
sidebar_position: 2
title: Compliance Reports
---

# Compliance Reports

GEIANT generates compliance reports on demand via the `GET /compliance` endpoint. Reports are computed live from Supabase data — they are not cached or pre-generated.

## Endpoint

```
GET /compliance
GET /compliance/:agent_pk
```

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | ISO 8601 string | Start of reporting period (default: `2020-01-01`) |
| `to` | ISO 8601 string | End of reporting period (default: now) |

**Example:**

```bash
curl "https://packagesmcp-perception-production.up.railway.app/compliance?from=2026-03-01T00:00:00Z"
```

## Report Structure

```typescript
interface ComplianceReport {
  version: 1;
  generated_at: string;
  agent_pk: string;
  agent_handle: string;
  principal_pk: string;
  reporting_period: { from: string; to: string };

  // Art. 12 — Record-keeping
  total_operations: number;
  operations_by_tool: Record<string, number>;
  jurisdiction_cells: string[];
  chain_verification: ChainVerificationResult;
  epochs: AgentEpochSummary[];

  // Art. 14 — Human oversight
  delegation_certificate: DelegationCertificate;
  delegation_chain_depth: number;
  human_approvals_required: number;
  human_approvals_received: number;

  // Trust assessment
  current_tier: AgentTier;
  trust_score: number;
  violations: ComplianceViolation[];
}
```

## Chain Verification

The `chain_verification` field contains the result of verifying every breadcrumb in the reporting period:

```typescript
interface ChainVerificationResult {
  is_valid: boolean;     // true if all checks pass
  block_count: number;
  issues: string[];      // Empty if valid
  first_block_at: string;
  last_block_at: string;
  delegation_cert_hash: string;
}
```

Checks performed per block:
1. **Signature** — Ed25519 signature matches the signed data
2. **Hash** — `block_hash` matches SHA-256 of `data_to_sign + signature`
3. **Chain link** — `previous_hash` matches preceding block's `block_hash`
4. **Index continuity** — No gaps in block index sequence
5. **Timestamp monotonicity** — Each block's timestamp ≥ previous

## Violation Types

```typescript
type ViolationType =
  | 'jurisdiction_breach'  // Agent operated outside allowed H3 cells
  | 'facet_violation'      // Agent used unauthorized capability
  | 'rate_limit'           // Exceeded max_ops_per_hour
  | 'cert_expired'         // Delegation certificate no longer valid
  | 'chain_break';         // Failed to persist a breadcrumb

type Severity = 'warning' | 'critical';
```

## Trust Score

The trust score (0–100) is computed from four factors:

| Factor | Weight | Metric |
|--------|--------|--------|
| Operations | 40% | Total operations / 5000 (capped at 1.0) |
| Territory | 30% | Unique H3 cells / 20 (capped at 1.0) |
| Longevity | 20% | Days since first block / 365 (capped at 1.0) |
| Chain validity | 10% | Boolean — 10 points if chain is valid |

## Programmatic Access

```typescript
import { AuditEngine } from '@geiant/mcp-audit';

const engine = createAuditEngine();
await engine.init();

const report = await engine.generateComplianceReport({
  from: '2026-03-01T00:00:00Z',
  to: '2026-03-31T23:59:59Z',
});

console.log('Operations:', report.total_operations);
console.log('Chain valid:', report.chain_verification.is_valid);
console.log('Trust score:', report.trust_score);
```
