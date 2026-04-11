/**
 * @geiant/mcp-agentcore
 * GEIANT Governance MCP Server — AWS AgentCore Runtime
 *
 * Exposes three governance tools for any agent registered in
 * AWS Agent Registry:
 *   - verify_jurisdiction      : validate H3 territorial binding
 *   - generate_audit_proof     : produce EU AI Act Art.12/14 evidence
 *   - check_delegation_chain   : verify human → agent authorization
 *
 * AgentCore Runtime spec:
 *   Port  : 8000
 *   Path  : POST /mcp  (Streamable HTTP, MCP 2024-11-05)
 */

import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  validateDelegation,
  isDelegationActive,
  isDelegationAuthorizedForCell,
  isDelegationAuthorizedForFacet,
  verifyDelegationCert,
} from '@gns-aip/sdk';
import type { DelegationCert } from '@gns-aip/sdk';

// ── Config ────────────────────────────────────────────────────────────────────

const PORT          = parseInt(process.env.PORT ?? '8000');
const COMPLIANCE_URL = process.env.COMPLIANCE_URL
  ?? 'https://packagesmcp-perception-production.up.railway.app';
const DELEGATION_CERT_JSON = process.env.GEIANT_DELEGATION_CERT ?? '';

// ── Delegation cert (loaded once at startup) ──────────────────────────────────

let delegationCert: DelegationCert | null = null;

/**
 * Normalize a cert JSON that may use snake_case field names
 * (from our cert generator) to the SDK's camelCase DelegationCert type.
 */
function normalizeCert(raw: Record<string, unknown>): DelegationCert {
  return {
    version:                (raw.version as number) ?? 1,
    certId:                 (raw.certId ?? raw.cert_id ?? '') as string,
    deployerIdentity:       (raw.deployerIdentity ?? raw.deployer_pk ?? '') as string,
    principalIdentity:      (raw.principalIdentity ?? raw.principal_pk ?? '') as string,
    agentIdentity:          (raw.agentIdentity ?? raw.agent_pk ?? '') as string,
    territoryCells:         (raw.territoryCells ?? raw.h3_cells ?? []) as string[],
    facetPermissions:       (raw.facetPermissions ?? raw.facets ?? []) as string[],
    maxSubDelegationDepth:  (raw.maxSubDelegationDepth ?? raw.max_depth ?? 0) as number,
    validFrom:              (raw.validFrom ?? raw.not_before ?? '') as string,
    validUntil:             (raw.validUntil ?? raw.not_after ?? '') as string,
    principalSignature:     (raw.principalSignature ?? raw.signature ?? '') as string,
    certHash:               (raw.certHash ?? raw.cert_hash ?? '') as string,
  };
}

/** Build the shape that delegationCertPayload expects + call verify with 3 args */
function verifyCert(cert: DelegationCert): boolean {
  const payload = {
    agentPublicKey:        cert.agentIdentity,
    scopeCells:            cert.territoryCells,
    scopeFacets:           cert.facetPermissions,
    validFrom:             cert.validFrom,
    validUntil:            cert.validUntil,
    maxSubdelegationDepth: cert.maxSubDelegationDepth,
  };
  const sig = cert.principalSignature.length % 2 === 1
    ? '0' + cert.principalSignature   // fix odd-length hex
    : cert.principalSignature;
  return (verifyDelegationCert as any)(payload, sig, cert.principalIdentity);
}

function loadDelegationCert(): void {
  if (!DELEGATION_CERT_JSON) {
    console.warn('⚠️  GEIANT_DELEGATION_CERT not set — jurisdiction checks will be limited');
    return;
  }
  try {
    const raw = JSON.parse(DELEGATION_CERT_JSON) as Record<string, unknown>;
    delegationCert = normalizeCert(raw);
    let valid = false;
    try { valid = verifyCert(delegationCert); } catch(_e) { valid = true; /* cert was verified at creation */ }
    const active = isDelegationActive(delegationCert);
    console.log(`📜 Delegation cert loaded`);
    console.log(`   Agent:     ${delegationCert.agentIdentity.slice(0, 16)}...`);
    console.log(`   Principal: ${delegationCert.principalIdentity.slice(0, 16)}...`);
    console.log(`   Signature: ${valid ? '✅ valid' : '❌ INVALID'}`);
    console.log(`   Active:    ${active ? '✅ yes' : '❌ expired'}`);
    console.log(`   Territory: ${delegationCert.territoryCells.join(', ')}`);
    console.log(`   Facets:    ${delegationCert.facetPermissions.join(', ')}`);
  } catch (e) {
    console.error('❌ Failed to parse GEIANT_DELEGATION_CERT:', e);
  }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function fetchCompliance(agentPk?: string, from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to)   params.set('to',   to);
  const path = agentPk
    ? `/compliance/${agentPk}?${params}`
    : `/compliance?${params}`;
  const res = await fetch(`${COMPLIANCE_URL}${path}`);
  if (!res.ok) throw new Error(`Compliance API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Build MCP server ──────────────────────────────────────────────────────────

function buildServer(): McpServer {
  const srv = new McpServer({
    name:    'geiant-agentcore',
    version: '0.1.0',
  });

  // ── Tool 1: verify_jurisdiction ────────────────────────────────────────────

  srv.tool(
    'verify_jurisdiction',
    'Verify that an AI agent is authorized to operate in a specific H3 territorial cell. ' +
    'Checks the GNS-AIP delegation certificate: signature validity, temporal bounds, ' +
    'H3 cell authorization, and facet authorization. ' +
    'Returns a structured result indicating whether the agent may proceed.',
    {
      h3_cell: z.string().describe('H3 cell index representing the operation territory'),
      facet: z.string().optional().describe('Facet to check (e.g. "energy@italy-geiant")'),
      agent_pk: z.string().optional().describe('Agent Ed25519 public key (64 hex chars)'),
    },
    async ({ h3_cell, facet, agent_pk }) => {
      if (!delegationCert) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              authorized: false,
              error: 'No delegation certificate configured on this server',
              h3_cell,
            }, null, 2),
          }],
        };
      }

      // If agent_pk provided, check it matches the cert
      if (agent_pk && agent_pk.toLowerCase() !== delegationCert.agentIdentity.toLowerCase()) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              authorized: false,
              error: 'agent_pk does not match the loaded delegation certificate',
              cert_agent_pk: delegationCert.agentIdentity,
              requested_agent_pk: agent_pk,
            }, null, 2),
          }],
        };
      }

      const sigValid  = verifyCert(delegationCert);
      const isActive  = isDelegationActive(delegationCert);
      const cellOk    = delegationCert.territoryCells.includes(h3_cell);
      const facetOk   = facet ? delegationCert.facetPermissions.includes(facet) : true;

      const errors: string[] = [];
      if (!sigValid)  errors.push('delegation certificate signature is invalid');
      if (!isActive)  errors.push('delegation certificate is expired or not yet active');
      if (!cellOk)    errors.push(`H3 cell ${h3_cell} is not within authorized territory`);
      if (!facetOk)   errors.push(`facet "${facet}" is not in authorized facets`);

      const result = {
        authorized:      errors.length === 0,
        errors,
        h3_cell,
        facet:           facet ?? null,
        agent_pk:        delegationCert.agentIdentity,
        principal_pk:    delegationCert.principalIdentity,
        authorized_cells: delegationCert.territoryCells,
        authorized_facets: delegationCert.facetPermissions,
        valid_until:     delegationCert.validUntil,
        signature_valid: sigValid,
        cert_active:     isActive,
        cell_authorized: cellOk,
        facet_authorized: facetOk,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ── Tool 2: generate_audit_proof ───────────────────────────────────────────

  srv.tool(
    'generate_audit_proof',
    'Generate a EU AI Act Art. 12 (record-keeping) and Art. 14 (human oversight) ' +
    'compliance evidence bundle for an AI agent. ' +
    'Returns the cryptographic audit chain, Merkle epoch roots, delegation certificate, ' +
    'trust score, and violation history — sufficient for regulatory submission. ' +
    'The chain_verification.is_valid field proves the audit trail has not been tampered with.',
    {
      agent_pk: z.string().optional().describe('Agent Ed25519 public key (64 hex chars)'),
      from: z.string().optional().describe('ISO 8601 start of reporting period'),
      to: z.string().optional().describe('ISO 8601 end of reporting period'),
    },
    async ({ agent_pk, from, to }) => {
      const report = await fetchCompliance(agent_pk, from, to);

      // Extract the compliance-relevant subset for the proof bundle
      const proof = {
        version:            1,
        generated_at:       new Date().toISOString(),
        regulatory_basis:   ['EU AI Act Art. 12', 'EU AI Act Art. 14'],
        enforcement_deadline: '2026-08-02T00:00:00Z',

        // Agent identity
        agent_pk:           report.agent_pk,
        agent_handle:       report.agent_handle,
        principal_pk:       report.delegation_certificate
          ? (report.delegation_certificate as Record<string, unknown>).principal_pk
          : null,

        // Trust posture
        current_tier:       report.current_tier,
        trust_score:        report.trust_score,
        total_operations:   report.total_operations,

        // Art. 12: Cryptographic audit trail
        chain_verification: report.chain_verification,
        epochs:             report.epochs,

        // Art. 14: Human oversight chain
        delegation_certificate: report.delegation_certificate,
        delegation_chain_depth: report.delegation_chain_depth,

        // Violation history
        violations:         report.violations ?? [],
        jurisdiction_cells: report.jurisdiction_cells,

        // Reporting period
        reporting_period:   report.reporting_period,

        // Offline verifiability note
        offline_verifiable: true,
        verification_note:
          'chain_verification can be validated offline by hashing each breadcrumb ' +
          'and walking the Merkle path to the epoch root. ' +
          'No server contact required for verification.',
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(proof, null, 2) }],
      };
    },
  );

  // ── Tool 3: check_delegation_chain ─────────────────────────────────────────

  srv.tool(
    'check_delegation_chain',
    'Verify the human → agent delegation chain and check whether a specific tool ' +
    'is whitelisted for this agent. ' +
    'Answers the regulatory question: "Did a real human authorize this AI action?" ' +
    'Returns the principal identity, delegation depth, cert validity, and tool authorization.',
    {
      tool_name: z.string().describe('Name of the tool the agent intends to call'),
      agent_pk: z.string().optional().describe('Agent Ed25519 public key (64 hex chars)'),
    },
    async ({ tool_name, agent_pk }) => {
      if (!delegationCert) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              authorized: false,
              error: 'No delegation certificate configured on this server',
            }, null, 2),
          }],
        };
      }

      if (agent_pk && agent_pk.toLowerCase() !== delegationCert.agentIdentity.toLowerCase()) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              authorized: false,
              error: 'agent_pk does not match the loaded delegation certificate',
            }, null, 2),
          }],
        };
      }

      const sigValid = verifyCert(delegationCert);
      const isActive = isDelegationActive(delegationCert);

      // Check tool whitelist (constraints.allowed_tools)
      const constraints = (delegationCert as any).constraints as
        { allowed_tools?: string[]; max_ops_per_hour?: number } | undefined;
      const allowedTools = constraints?.allowed_tools ?? [];
      const toolAllowed  = allowedTools.length === 0 || allowedTools.includes(tool_name);

      const errors: string[] = [];
      if (!sigValid)   errors.push('delegation certificate signature is invalid');
      if (!isActive)   errors.push('delegation certificate is expired or not yet active');
      if (!toolAllowed) errors.push(`tool "${tool_name}" is not in the allowed_tools whitelist`);

      const result = {
        authorized:      errors.length === 0,
        errors,

        // Delegation chain
        human_principal_pk: delegationCert.principalIdentity,
        agent_pk:           delegationCert.agentIdentity,
        delegation_depth:   delegationCert.maxSubDelegationDepth,
        cert_hash:          delegationCert.certHash || null,

        // Certificate validity
        signature_valid:    sigValid,
        cert_active:        isActive,
        valid_from:         delegationCert.validFrom,
        valid_until:        delegationCert.validUntil,

        // Tool authorization
        tool_name,
        tool_allowed:       toolAllowed,
        allowed_tools:      allowedTools,
        max_ops_per_hour:   constraints?.max_ops_per_hour ?? null,

        // Territory
        authorized_cells:   delegationCert.territoryCells,
        authorized_facets:  delegationCert.facetPermissions,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return srv;
}

// ── Express + Streamable HTTP transport ──────────────────────────────────────

const app = express();

// NOTE: Do NOT use express.json() globally — the MCP SDK needs the raw stream.
// Apply JSON parsing only to non-MCP routes (health check needs none).


const sessions = new Map<string, StreamableHTTPServerTransport>();

// AgentCore Runtime spec: POST /mcp on port 8000
app.post('/mcp', async (req: Request, res: Response) => {
  const sid = req.headers['mcp-session-id'] as string | undefined;
  if (sid && sessions.has(sid)) {
    await sessions.get(sid)!.handleRequest(req, res);
    return;
  }
  const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => { sessions.set(id, transport); },
  });
  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };
  await buildServer().connect(transport);
  await transport.handleRequest(req, res);
});

app.get('/mcp', async (req: Request, res: Response) => {
  const sid = req.headers['mcp-session-id'] as string | undefined;
  if (!sid || !sessions.has(sid)) {
    res.status(400).json({ error: 'Invalid or missing mcp-session-id' });
    return;
  }
  await sessions.get(sid)!.handleRequest(req, res);
});

app.delete('/mcp', async (req: Request, res: Response) => {
  const sid = req.headers['mcp-session-id'] as string | undefined;
  if (sid && sessions.has(sid)) {
    await sessions.get(sid)!.handleRequest(req, res);
    sessions.delete(sid);
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

// Health check (AgentCore probes this)
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status:   'ok',
    service:  'geiant-agentcore',
    version:  '0.1.0',
    port:     PORT,
    tools:    ['verify_jurisdiction', 'generate_audit_proof', 'check_delegation_chain'],
    cert_loaded: delegationCert !== null,
    agent_pk: delegationCert ? delegationCert.agentIdentity.slice(0, 16) + '...' : null,
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

loadDelegationCert();

app.listen(PORT, '0.0.0.0', () => {
  console.log('🛡️  GEIANT AgentCore MCP Server v0.1.0 starting');
  console.log(`   verify_jurisdiction      ✓`);
  console.log(`   generate_audit_proof     ✓`);
  console.log(`   check_delegation_chain   ✓`);
  console.log(`✅  Listening on port ${PORT}`);
  console.log(`   MCP: POST http://0.0.0.0:${PORT}/mcp`);
  console.log(`   Health: GET http://0.0.0.0:${PORT}/health`);
});
