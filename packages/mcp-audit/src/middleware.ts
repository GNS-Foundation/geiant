// ===========================================
// GEIANT Phase 5.1.1 — Audit Middleware
// Wraps every MCP tool handler to drop virtual
// breadcrumbs with jurisdiction & delegation checks
// Location: packages/mcp-audit/src/middleware.ts
// ===========================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import nacl from 'tweetnacl';
import {
  VirtualBreadcrumbBlock,
  AgentMetaFlags,
  AgentTier,
  DelegationCertificate,
  DbAgentBreadcrumb,
} from './types';
import {
  buildBlock,
  buildContextDigest,
  bytesToHex,
  hexToBytes,
  hashDelegationCert,
  verifyDelegationCert,
  isDelegationCertActive,
  checkJurisdiction,
  checkFacet,
  checkToolAllowed,
  computeTier,
} from './chain';

// ===========================================
// Configuration
// ===========================================

export interface AuditConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  agentSecretKeyHex: string;         // Ed25519 secret key (128 hex = 64 bytes)
  delegationCertificate: DelegationCertificate;
  defaultFacet: string;              // e.g. "energy@italy-geiant"
  defaultLocationCell: string;       // e.g. "851e8053fffffff" (Rome)
  defaultLocationResolution: number; // e.g. 5
}

// ===========================================
// Audit Engine (singleton per runtime)
// ===========================================

export class AuditEngine {
  private supabase: SupabaseClient;
  private agentPk: string;
  private agentSk: Uint8Array;
  private cert: DelegationCertificate;
  private certHash!: string;
  private config: AuditConfig;

  // In-memory chain tip for fast chaining
  private lastBlockHash: string | null = null;
  private nextIndex: number = 0;
  private initialized: boolean = false;

  constructor(config: AuditConfig) {
    this.config = config;
    this.supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);

    // Derive public key from secret key (last 32 bytes of Ed25519 64-byte sk)
    const skBytes = hexToBytes(config.agentSecretKeyHex);
    this.agentSk = skBytes;
    this.agentPk = bytesToHex(skBytes.slice(32));

    this.cert = config.delegationCertificate;
  }

  // ===========================================
  // Initialization — load chain tip from DB
  // ===========================================

  async init(): Promise<void> {
    if (this.initialized) return;

    // Compute and cache cert hash
    this.certHash = await hashDelegationCert(this.cert);

    // Validate delegation certificate
    if (!verifyDelegationCert(this.cert)) {
      throw new Error('AUDIT_INIT: Delegation certificate signature is invalid');
    }
    if (!isDelegationCertActive(this.cert)) {
      throw new Error('AUDIT_INIT: Delegation certificate is not active (check not_before/not_after)');
    }
    if (this.cert.agent_pk !== this.agentPk) {
      throw new Error('AUDIT_INIT: Agent PK does not match delegation certificate');
    }

    // Store cert in DB if not present
    const { data: existingCert } = await this.supabase
      .from('delegation_certificates')
      .select('cert_hash')
      .eq('cert_hash', this.certHash)
      .single();

    if (!existingCert) {
      await this.supabase.from('delegation_certificates').insert({
        cert_hash: this.certHash,
        agent_pk: this.agentPk,
        principal_pk: this.cert.principal_pk,
        h3_cells: this.cert.h3_cells,
        facets: this.cert.facets,
        not_before: this.cert.not_before,
        not_after: this.cert.not_after,
        max_depth: this.cert.max_depth,
        constraints: this.cert.constraints ?? null,
        principal_signature: this.cert.principal_signature,
      });
    }

    // Ensure agent is registered
    const { data: agent } = await this.supabase
      .from('agent_registry')
      .select('agent_pk, breadcrumb_count')
      .eq('agent_pk', this.agentPk)
      .single();

    if (!agent) {
      await this.supabase.from('agent_registry').insert({
        agent_pk: this.agentPk,
        handle: this.config.defaultFacet,
        display_name: `GEIANT Agent ${this.agentPk.substring(0, 8)}`,
        current_tier: 'provisioned',
        active_cert_hash: this.certHash,
        breadcrumb_count: 0,
        trust_score: 0,
      });
    }

    // Load chain tip — get the latest block for this agent
    const { data: latestBlock } = await this.supabase
      .from('agent_breadcrumbs')
      .select('block_index, block_hash')
      .eq('agent_pk', this.agentPk)
      .order('block_index', { ascending: false })
      .limit(1)
      .single();

    if (latestBlock) {
      this.lastBlockHash = latestBlock.block_hash;
      this.nextIndex = latestBlock.block_index + 1;
    } else {
      this.lastBlockHash = null;
      this.nextIndex = 0;
    }

    this.initialized = true;
    console.log(
      `🔗 AuditEngine initialized: agent=${this.agentPk.substring(0, 8)}... ` +
      `chain_tip=${this.nextIndex} cert=${this.certHash.substring(0, 8)}...`
    );
  }

  // ===========================================
  // Pre-flight checks (before tool execution)
  // ===========================================

  preflight(toolName: string, locationCell?: string): {
    ok: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    const cell = locationCell ?? this.config.defaultLocationCell;

    // 1. Cert still active?
    if (!isDelegationCertActive(this.cert)) {
      errors.push('Delegation certificate expired');
    }

    // 2. Jurisdiction check
    const jCheck = checkJurisdiction(cell, this.cert);
    if (!jCheck.allowed) {
      errors.push(jCheck.reason!);
    }

    // 3. Facet check
    const fCheck = checkFacet(this.config.defaultFacet, this.cert);
    if (!fCheck.allowed) {
      errors.push(fCheck.reason!);
    }

    // 4. Tool whitelist
    const tCheck = checkToolAllowed(toolName, this.cert);
    if (!tCheck.allowed) {
      errors.push(tCheck.reason!);
    }

    return { ok: errors.length === 0, errors };
  }

  // ===========================================
  // Drop breadcrumb (after tool execution)
  // ===========================================

  async dropBreadcrumb(params: {
    toolName: string;
    toolInput: unknown;
    toolOutput: unknown;
    durationMs: number;
    locationCell?: string;
    locationResolution?: number;
    facet?: string;
    modelId?: string;
    runpodEndpoint?: string;
    error?: string;
  }): Promise<VirtualBreadcrumbBlock> {
    if (!this.initialized) await this.init();

    const cell = params.locationCell ?? this.config.defaultLocationCell;
    const resolution = params.locationResolution ?? this.config.defaultLocationResolution;
    const facet = params.facet ?? this.config.defaultFacet;

    // Build context digest from tool I/O
    const { contextDigest, inputHash, outputHash } = await buildContextDigest(
      params.toolInput,
      params.toolOutput,
    );

    // Current tier based on chain length
    const tier = computeTier(this.nextIndex);

    // Build meta flags
    const metaFlags: AgentMetaFlags = {
      tool_duration_ms: params.durationMs,
      input_hash: inputHash,
      output_hash: outputHash,
      tier,
      ...(params.modelId && { model_id: params.modelId }),
      ...(params.runpodEndpoint && { runpod_endpoint: params.runpodEndpoint }),
      ...(params.error && { error: params.error }),
    };

    // Build and sign the block
    const block = await buildBlock({
      index: this.nextIndex,
      agentPk: this.agentPk,
      agentSk: this.agentSk,
      timestamp: new Date(),
      locationCell: cell,
      locationResolution: resolution,
      contextDigest,
      previousHash: this.lastBlockHash,
      metaFlags,
      delegationCertHash: this.certHash,
      toolName: params.toolName,
      facet,
    });

    // Write to Supabase
    const { error } = await this.supabase
      .from('agent_breadcrumbs')
      .insert({
        agent_pk: block.identity_public_key,
        block_index: block.index,
        timestamp: block.timestamp,
        location_cell: block.location_cell,
        location_resolution: block.location_resolution,
        context_digest: block.context_digest,
        previous_hash: block.previous_hash,
        meta_flags: block.meta_flags,
        signature: block.signature,
        block_hash: block.block_hash,
        delegation_cert_hash: block.delegation_cert_hash,
        tool_name: block.tool_name,
        facet: block.facet,
      } satisfies Omit<DbAgentBreadcrumb, 'id' | 'created_at'>);

    if (error) {
      console.error(`🚨 Breadcrumb write failed at block ${block.index}:`, error.message);

      await this.logViolation({
        type: 'chain_break',
        description: `Failed to persist block ${block.index}: ${error.message}`,
        severity: 'critical',
        blockIndex: block.index,
      });

      throw new Error(`AUDIT: breadcrumb write failed: ${error.message}`);
    }

    // Advance chain tip
    this.lastBlockHash = block.block_hash;
    this.nextIndex++;

    console.log(
      `🍞 Block #${block.index} dropped: ${block.block_hash.substring(0, 8)}... ` +
      `tool=${block.tool_name} cell=${block.location_cell} ` +
      `duration=${params.durationMs}ms tier=${tier}`
    );

    return block;
  }

  // ===========================================
  // Log compliance violation
  // ===========================================

  private async logViolation(params: {
    type: string;
    description: string;
    severity: 'warning' | 'critical';
    blockIndex?: number;
  }): Promise<void> {
    try {
      await this.supabase.from('compliance_violations').insert({
        agent_pk: this.agentPk,
        block_index: params.blockIndex ?? null,
        violation_type: params.type,
        description: params.description,
        severity: params.severity,
      });
    } catch (e) {
      console.error('Failed to log violation:', e);
    }
  }

  // ===========================================
  // Wrap MCP Tool Handler
  // ===========================================
  // The main integration point. Wraps any async tool
  // handler with preflight checks + breadcrumb drop.

  wrapTool<TInput, TOutput>(
    toolName: string,
    handler: (input: TInput) => Promise<TOutput>,
    options?: {
      locationCell?: string | ((input: TInput) => string);
      modelId?: string;
      runpodEndpoint?: string;
      facet?: string;
    },
  ): (input: TInput) => Promise<TOutput> {
    return async (input: TInput): Promise<TOutput> => {
      if (!this.initialized) await this.init();

      // Resolve location cell (static or dynamic from input)
      const cell = typeof options?.locationCell === 'function'
        ? options.locationCell(input)
        : options?.locationCell ?? this.config.defaultLocationCell;

      // Pre-flight: jurisdiction + delegation checks
      const preflight = this.preflight(toolName, cell);
      if (!preflight.ok) {
        const reason = preflight.errors.join('; ');
        console.error(`🚫 AUDIT PREFLIGHT FAILED [${toolName}]: ${reason}`);

        for (const err of preflight.errors) {
          const vType = err.includes('jurisdiction') || err.includes('Cell')
            ? 'jurisdiction_breach'
            : err.includes('facet') || err.includes('Facet')
            ? 'facet_violation'
            : err.includes('expired')
            ? 'cert_expired'
            : 'facet_violation';

          await this.logViolation({
            type: vType,
            description: `${toolName}: ${err}`,
            severity: 'critical',
          });
        }

        throw new Error(`AUDIT: tool ${toolName} blocked — ${reason}`);
      }

      // Execute the actual tool
      const start = Date.now();
      let output: TOutput;
      let error: string | undefined;

      try {
        output = await handler(input);
      } catch (e: any) {
        error = e.message ?? String(e);
        const duration = Date.now() - start;

        // Still drop a breadcrumb for failed ops (audit trail completeness)
        await this.dropBreadcrumb({
          toolName,
          toolInput: input,
          toolOutput: { error },
          durationMs: duration,
          locationCell: cell,
          facet: options?.facet,
          modelId: options?.modelId,
          runpodEndpoint: options?.runpodEndpoint,
          error,
        });

        throw e;
      }

      const duration = Date.now() - start;

      // Drop breadcrumb for successful op
      await this.dropBreadcrumb({
        toolName,
        toolInput: input,
        toolOutput: output,
        durationMs: duration,
        locationCell: cell,
        facet: options?.facet,
        modelId: options?.modelId,
        runpodEndpoint: options?.runpodEndpoint,
      });

      return output;
    };
  }

  // ===========================================
  // Getters for status / debugging
  // ===========================================

  get chainTip(): { index: number; hash: string | null } {
    return { index: this.nextIndex, hash: this.lastBlockHash };
  }

  get agentPublicKey(): string {
    return this.agentPk;
  }

  get delegationCertificateHash(): string {
    return this.certHash;
  }

  get currentTier(): AgentTier {
    return computeTier(this.nextIndex);
  }
}

// ===========================================
// Factory — create from environment variables
// ===========================================

export function createAuditEngine(overrides?: Partial<AuditConfig>): AuditEngine {
  const config: AuditConfig = {
    supabaseUrl: overrides?.supabaseUrl
      ?? process.env.GEIANT_SUPABASE_URL
      ?? 'https://kaqwkxfaclyqjlfhxrmt.supabase.co',
    supabaseServiceKey: overrides?.supabaseServiceKey
      ?? process.env.GEIANT_SUPABASE_SERVICE_KEY
      ?? '',
    agentSecretKeyHex: overrides?.agentSecretKeyHex
      ?? process.env.GEIANT_AGENT_SK
      ?? '',
    delegationCertificate: overrides?.delegationCertificate
      ?? JSON.parse(process.env.GEIANT_DELEGATION_CERT ?? '{}'),
    defaultFacet: overrides?.defaultFacet
      ?? process.env.GEIANT_DEFAULT_FACET
      ?? 'energy@italy-geiant',
    defaultLocationCell: overrides?.defaultLocationCell
      ?? process.env.GEIANT_DEFAULT_H3_CELL
      ?? '851e8053fffffff',
    defaultLocationResolution: overrides?.defaultLocationResolution
      ?? parseInt(process.env.GEIANT_DEFAULT_H3_RES ?? '5', 10),
  };

  if (!config.supabaseServiceKey) {
    throw new Error('GEIANT_SUPABASE_SERVICE_KEY is required');
  }
  if (!config.agentSecretKeyHex) {
    throw new Error('GEIANT_AGENT_SK is required');
  }

  return new AuditEngine(config);
}
