/**
 * @geiant/mcp-client-sql
 *
 * GEIANT governance wrapper for Microsoft SQL MCP Server.
 * Connects to any Data API builder MCP endpoint over SSE,
 * enforces delegation + jurisdiction pre-flight before every
 * SQL tool call, and drops a signed SHA-256-chained breadcrumb
 * after execution.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Tool } from '@langchain/core/tools';
import {
  createVirtualBreadcrumb,
  verifyDelegationCert,
  isDelegationActive,
  isDelegationAuthorizedForCell,
  isDelegationAuthorizedForFacet,
  isValidH3Cell,                          // from h3.js via SDK
  type AgentIdentity,
  type DelegationCert,
  type VirtualBreadcrumb,
} from '@gns-aip/sdk';

// ─────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────

export interface SqlMcpClientOptions {
  /** Full SSE URL of the Microsoft SQL MCP Server (Data API builder) */
  endpoint: string;
  /** GEIANT agent Ed25519 identity */
  agentIdentity: AgentIdentity;
  /** Signed delegation certificate from a human principal */
  delegationCert: DelegationCert;
  /**
   * H3 cell representing where this SQL client operates.
   * Must be within the cells declared in the delegation cert.
   */
  operationCell: string;
  /**
   * Facet permission required for SQL operations.
   * Must be declared in delegationCert.facetPermissions.
   * e.g. 'energy', 'telecom', 'finance'
   */
  facet: string;
  /**
   * Optional Azure bearer token for the Data API builder endpoint.
   */
  authToken?: string;
  /**
   * Supabase REST URL + key for persisting breadcrumbs.
   * If omitted, breadcrumbs are returned but not persisted.
   */
  supabaseUrl?: string;
  supabaseKey?: string;
}

export interface PreflightResult {
  allowed: boolean;
  reason?: string;
}

export interface BreadcrumbRecord {
  breadcrumb: VirtualBreadcrumb;
  toolName: string;
  latencyMs: number;
}

// ─────────────────────────────────────────────
// Pre-flight governance check
// Uses SDK helpers so logic stays in sync with protocol
// ─────────────────────────────────────────────

export function preflight(
  cert: DelegationCert,
  operationCell: string,
  facet: string,
): PreflightResult {
  // 1. H3 cell format
  if (!isValidH3Cell(operationCell)) {
    return { allowed: false, reason: `Invalid H3 cell: ${operationCell}` };
  }

  // 2. Certificate temporal validity  (validFrom / validUntil)
  if (!isDelegationActive(cert)) {
    const now = new Date().toISOString();
    return {
      allowed: false,
      reason: `Certificate not active (validFrom: ${cert.validFrom}, validUntil: ${cert.validUntil}, now: ${now})`,
    };
  }

  // 3. H3 jurisdiction check
  if (!isDelegationAuthorizedForCell(cert, operationCell)) {
    return {
      allowed: false,
      reason: `H3 cell ${operationCell} is outside authorised territory [${cert.territoryCells.join(', ')}]`,
    };
  }

  // 4. Facet permission check
  if (!isDelegationAuthorizedForFacet(cert, facet)) {
    return {
      allowed: false,
      reason: `Facet '${facet}' not in authorised set [${cert.facetPermissions.join(', ')}]`,
    };
  }

  return { allowed: true };
}

// ─────────────────────────────────────────────
// Supabase breadcrumb persistence
// ─────────────────────────────────────────────

async function persistBreadcrumb(
  crumb: VirtualBreadcrumb,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<void> {
  const res = await fetch(`${supabaseUrl}/rest/v1/agent_breadcrumbs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      index:          crumb.index,          // VirtualBreadcrumb.index
      block_hash:     crumb.blockHash,
      previous_hash:  crumb.previousHash,
      identity_pk:    crumb.agentIdentity,
      operation_cell: crumb.operationCell,
      cell_resolution: crumb.cellResolution,
      timestamp:      crumb.timestamp,
      meta:           crumb.meta,
      signature:      crumb.signature,
      context_digest: crumb.contextDigest,
    }),
  });

  if (!res.ok) {
    console.warn('[geiant/mcp-client-sql] breadcrumb persist failed:', res.status, await res.text());
  }
}

// ─────────────────────────────────────────────
// LangChain Tool wrapper
// ─────────────────────────────────────────────

class GovernedSqlTool extends Tool {
  name: string;
  description: string;

  private mcpClient: Client;
  private opts: SqlMcpClientOptions;
  private getChainTip: () => VirtualBreadcrumb | null;
  private setChainTip: (crumb: VirtualBreadcrumb) => void;
  private onBreadcrumb?: (record: BreadcrumbRecord) => void;

  constructor(
    toolName: string,
    toolDescription: string,
    mcpClient: Client,
    opts: SqlMcpClientOptions,
    getChainTip: () => VirtualBreadcrumb | null,
    setChainTip: (crumb: VirtualBreadcrumb) => void,
    onBreadcrumb?: (record: BreadcrumbRecord) => void,
  ) {
    super();
    this.name         = `sql_${toolName}`;
    this.description  = `[GEIANT governed] ${toolDescription}`;
    this.mcpClient    = mcpClient;
    this.opts         = opts;
    this.getChainTip  = getChainTip;
    this.setChainTip  = setChainTip;
    this.onBreadcrumb = onBreadcrumb;
  }

  async _call(input: string): Promise<string> {
    const { agentIdentity, delegationCert, operationCell, facet, supabaseUrl, supabaseKey } = this.opts;
    const mcpToolName = this.name.replace(/^sql_/, '');

    // ── Pre-flight ──────────────────────────────
    const check = preflight(delegationCert, operationCell, facet);
    if (!check.allowed) {
      console.error('[GEIANT] PRE-FLIGHT BLOCKED —', check.reason);
      return JSON.stringify({ error: 'governance_violation', detail: check.reason });
    }

    // ── Parse tool arguments ────────────────────
    let toolArgs: Record<string, unknown>;
    try {
      toolArgs = JSON.parse(input);
    } catch {
      toolArgs = { query: input };
    }

    // ── Execute SQL MCP tool ────────────────────
    const t0 = Date.now();
    const result = await this.mcpClient.callTool({ name: mcpToolName, arguments: toolArgs });
    const latencyMs = Date.now() - t0;

    const content = result.content as Array<{ type: string; text?: string }>;
    const rawOutput = content
      .filter(c => c.type === 'text')
      .map(c => c.text ?? '')
      .join('\n');

    // ── Drop breadcrumb ─────────────────────────
    const crumb = await createVirtualBreadcrumb(
      {
        agentIdentity: agentIdentity.publicKey,
        operationCell,
        meta: {
          operationType:      `sql_tool_call:${mcpToolName}`,  // baked into operationType
          delegationCertHash: delegationCert.certHash,
          facet,
          withinTerritory:    true,
          latencyMs,                                            // correct field name
          // modelId omitted — not applicable to SQL calls
        },
      },
      agentIdentity.secretKey,
      this.getChainTip(),
    );

    this.setChainTip(crumb);

    if (supabaseUrl && supabaseKey) {
      await persistBreadcrumb(crumb, supabaseUrl, supabaseKey).catch(() => {});
    }

    this.onBreadcrumb?.({ breadcrumb: crumb, toolName: this.name, latencyMs });

    return rawOutput;
  }
}

// ─────────────────────────────────────────────
// Main client
// ─────────────────────────────────────────────

export class SqlMcpClient {
  private mcpClient: Client;
  private opts: SqlMcpClientOptions;
  private chainTip: VirtualBreadcrumb | null = null;
  private onBreadcrumb?: (record: BreadcrumbRecord) => void;

  private constructor(mcpClient: Client, opts: SqlMcpClientOptions) {
    this.mcpClient = mcpClient;
    this.opts      = opts;
  }

  /**
   * Connect to a Microsoft SQL MCP Server endpoint.
   * Verifies the delegation certificate signature before connecting.
   */
  static async connect(
    opts: SqlMcpClientOptions,
    onBreadcrumb?: (record: BreadcrumbRecord) => void,
  ): Promise<SqlMcpClient> {
    const certValid = await verifyDelegationCert(opts.delegationCert);
    if (!certValid) {
      throw new Error('[geiant/mcp-client-sql] Delegation certificate signature is invalid.');
    }

    const headers: Record<string, string> = {
      'User-Agent': 'geiant-mcp-client-sql/0.1.0',
    };
    if (opts.authToken) headers['Authorization'] = `Bearer ${opts.authToken}`;

    const transport = new SSEClientTransport(new URL(opts.endpoint), { requestInit: { headers } });
    const mcp = new Client({ name: 'geiant-sql-client', version: '0.1.0' });
    await mcp.connect(transport);

    console.log(`[geiant/mcp-client-sql] Connected → ${opts.endpoint}`);

    const instance = new SqlMcpClient(mcp, opts);
    instance.onBreadcrumb = onBreadcrumb;
    return instance;
  }

  /** List all SQL tools exposed by the Microsoft MCP endpoint. */
  async listTools(): Promise<{ name: string; description: string }[]> {
    const { tools } = await this.mcpClient.listTools();
    return tools.map(t => ({ name: t.name, description: t.description ?? '' }));
  }

  /**
   * Return governed LangChain Tool instances — one per SQL MCP tool.
   * Every tool call is pre-flight checked and breadcrumb-trailed.
   */
  async asLangChainTools(): Promise<GovernedSqlTool[]> {
    const { tools } = await this.mcpClient.listTools();
    return tools.map(t =>
      new GovernedSqlTool(
        t.name,
        t.description ?? `Microsoft SQL MCP tool: ${t.name}`,
        this.mcpClient,
        this.opts,
        () => this.chainTip,
        crumb => { this.chainTip = crumb; },
        this.onBreadcrumb,
      ),
    );
  }

  /** Current chain tip — the most recent breadcrumb dropped. */
  get tip(): VirtualBreadcrumb | null { return this.chainTip; }

  /** Disconnect from the MCP server. */
  async close(): Promise<void> { await this.mcpClient.close(); }
}
