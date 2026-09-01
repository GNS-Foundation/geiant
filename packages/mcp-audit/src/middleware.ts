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
  AgentEpochSummary,
  ComplianceReport,
  ComplianceViolation,
  ChainVerificationResult,
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
  checkRevocation,
  computeTier,
  computeTrustScore,
  verifyChain,
  merkleRoot,
  buildEpoch,
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
  /** Mirror of delegation_certificates.revoked_at; null when the cert is live. */
  private certRevokedAt: string | null = null;
  /** Mirror of agent_registry.revoked_at; null when the agent is permitted. */
  private agentRevokedAt: string | null = null;
  /** Epoch ms of the last revocation refresh, for the dropBreadcrumb re-check. */
  private revocationCheckedAt: number = 0;

  constructor(config: AuditConfig) {
    this.config = config;
    this.supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);

    // Derive public key from secret key (last 32 bytes of Ed25519 64-byte sk)
    const skBytes = hexToBytes(config.agentSecretKeyHex);
    this.agentSk = skBytes;
    this.agentPk = bytesToHex(skBytes.slice(32));

    this.cert = config.delegationCertificate;
  }

  // Supabase TIMESTAMPTZ returns "+00:00" but blocks were signed with "Z"
  private normalizeTimestamp(ts: string): string {
    return ts.replace('+00:00', 'Z').replace('+00', 'Z');
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

    // ---------------------------------------------------------------
    // Agent denylist — the OUTERMOST gate.
    //
    // Certificate revocation alone cannot contain a leaked agent key:
    // verifyDelegationCert() checks the signature against the principal_pk carried
    // inside the certificate, and no trusted-principal allowlist exists, so a
    // certificate vouches for itself. A holder of the agent secret can mint a new
    // principal, self-sign a fresh certificate for the same agent_pk, and bypass a
    // cert_hash revocation entirely. Bind revocation to the agent.
    //
    // Runs before ANY insert-on-first-sight — certificate or registry — so a
    // revoked agent cannot register a new certificate on its way in.
    // ---------------------------------------------------------------
    const { data: agentRow } = await this.supabase
      .from('agent_registry')
      .select('agent_pk, revoked_at, revocation_reason')
      .eq('agent_pk', this.agentPk)
      .single();

    // A2 (grafomem decision 0006, accepted 2026-09-02): an agent absent from agent_registry is
    // DENIED, not permitted. Previously a zero-row result fell through to allowed — a fail-open that
    // was load-bearing for the insert-on-first-sight bootstrap removed below; rows now come from
    // explicit provisioning BEFORE the first audited op. "unregistered" and "revoked" are DIFFERENT
    // facts — a distinct violation_type + reason so a consumer can tell them apart.
    if (!agentRow) {
      const detail = 'Agent is not registered (no agent_registry row)';
      await this.logViolation({
        type: 'unregistered_agent',
        description: `AUDIT_INIT: ${detail}`,
        severity: 'critical',
      });
      throw new Error(`AUDIT_INIT: ${detail}`);
    }

    this.agentRevokedAt =
      (agentRow as { revoked_at?: string | null } | null)?.revoked_at ?? null;
    const agentRevocation = checkRevocation(this.agentRevokedAt);
    if (!agentRevocation.allowed) {
      const note = (agentRow as { revocation_reason?: string | null } | null)?.revocation_reason;
      const detail = `Agent is revoked — ${agentRevocation.reason}${note ? ` (${note})` : ''}`;
      await this.logViolation({
        type: 'revoked_credential',
        description: `AUDIT_INIT: ${detail}`,
        severity: 'critical',
      });
      throw new Error(`AUDIT_INIT: ${detail}`);
    }

    // Store cert in DB if not present
    const { data: existingCert } = await this.supabase
      .from('delegation_certificates')
      .select('cert_hash, revoked_at')
      .eq('cert_hash', this.certHash)
      .single();

    // Revocation gate — must run BEFORE the insert-on-first-sight path below,
    // otherwise a revoked cert that had been deleted would be silently re-created.
    this.certRevokedAt = (existingCert as { revoked_at?: string | null } | null)?.revoked_at ?? null;
    this.revocationCheckedAt = Date.now();
    const revocation = checkRevocation(this.certRevokedAt);
    if (!revocation.allowed) {
      await this.logViolation({
        type: 'revoked_credential',
        description: `AUDIT_INIT: ${revocation.reason}`,
        severity: 'critical',
      });
      throw new Error(`AUDIT_INIT: ${revocation.reason}`);
    }

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

    // NOTE: the agent_registry insert-on-first-sight ("auto-self-registration") was REMOVED here
    // under A2 (grafomem 0006). It ran after the gate above, so it can no longer be reached for a
    // new agent — the gate now denies a missing row. Agents are registered by explicit provisioning
    // BEFORE their first audited op (the rotation runbook creates the row up front), not by their
    // own first appearance. The revocation gate is the single source of truth for "is this agent
    // known and permitted?".

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

    // 0a. Agent denylisted? Outranks everything — a revoked agent has no
    //     authority under ANY certificate it might present.
    const aCheck = checkRevocation(this.agentRevokedAt);
    if (!aCheck.allowed) {
      errors.push(`Agent is revoked — ${aCheck.reason}`);
    }

    // 0b. Credential revoked? A revoked cert is not merely out of scope,
    //     it carries no authority at all.
    const rCheck = checkRevocation(this.certRevokedAt);
    if (!rCheck.allowed) {
      errors.push(rCheck.reason!);
    }

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
    await this.assertNotRevoked();

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

  /**
   * Re-read revoked_at so a long-lived process honours a revocation without a
   * restart. init() alone would leave an already-running agent authorised until
   * it next boots. Throttled by REVOCATION_TTL_MS to keep this off the hot path.
   */
  private async assertNotRevoked(): Promise<void> {
    const REVOCATION_TTL_MS = 60_000;

    const evaluate = (): { blocked: boolean; detail?: string } => {
      const agent = checkRevocation(this.agentRevokedAt);
      if (!agent.allowed) return { blocked: true, detail: `Agent is revoked — ${agent.reason}` };
      const cert = checkRevocation(this.certRevokedAt);
      if (!cert.allowed) return { blocked: true, detail: cert.reason };
      return { blocked: false };
    };

    if (Date.now() - this.revocationCheckedAt < REVOCATION_TTL_MS) {
      const cached = evaluate();
      if (cached.blocked) throw new Error(`AUDIT_BLOCKED: ${cached.detail}`);
      return;
    }

    // Re-read both levels. Agent revocation outranks certificate revocation:
    // a revoked agent is refused whichever certificate it presents.
    const [certRes, agentRes] = await Promise.all([
      this.supabase
        .from('delegation_certificates')
        .select('revoked_at')
        .eq('cert_hash', this.certHash)
        .single(),
      this.supabase
        .from('agent_registry')
        .select('revoked_at')
        .eq('agent_pk', this.agentPk)
        .single(),
    ]);

    // On a transient read failure keep the last known state rather than
    // failing open or hard-failing a healthy agent.
    let refreshed = false;
    if (!certRes.error) {
      this.certRevokedAt =
        (certRes.data as { revoked_at?: string | null } | null)?.revoked_at ?? null;
      refreshed = true;
    }
    if (!agentRes.error) {
      this.agentRevokedAt =
        (agentRes.data as { revoked_at?: string | null } | null)?.revoked_at ?? null;
      refreshed = true;
    }
    if (refreshed) this.revocationCheckedAt = Date.now();

    const check = evaluate();
    if (check.blocked) {
      await this.logViolation({
        type: 'revoked_credential',
        description: `AUDIT_BLOCKED: ${check.detail}`,
        severity: 'critical',
      });
      throw new Error(`AUDIT_BLOCKED: ${check.detail}`);
    }
  }

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
  // Epoch Rollup (Phase 5.1.3)
  // ===========================================
  // Merkle-rolls all breadcrumbs since last epoch
  // into a signed AgentEpochSummary, stored in agent_epochs.

  async rollEpoch(): Promise<AgentEpochSummary> {
    if (!this.initialized) await this.init();

    // Find last epoch for this agent
    const { data: lastEpoch } = await this.supabase
      .from('agent_epochs')
      .select('epoch_index, end_block_index, epoch_hash')
      .eq('agent_pk', this.agentPk)
      .order('epoch_index', { ascending: false })
      .limit(1)
      .single();

    const epochIndex = lastEpoch ? lastEpoch.epoch_index + 1 : 0;
    const startBlockIndex = lastEpoch ? lastEpoch.end_block_index + 1 : 0;
    const previousEpochHash = lastEpoch ? lastEpoch.epoch_hash : null;

    // Fetch all breadcrumbs since last epoch
    const { data: blocks, error: fetchErr } = await this.supabase
      .from('agent_breadcrumbs')
      .select('*')
      .eq('agent_pk', this.agentPk)
      .gte('block_index', startBlockIndex)
      .order('block_index', { ascending: true });

    if (fetchErr) throw new Error(`EPOCH: failed to fetch blocks: ${fetchErr.message}`);
    if (!blocks || blocks.length === 0) {
      throw new Error(`EPOCH: no blocks to roll since block_index ${startBlockIndex}`);
    }

    // Map DB rows to VirtualBreadcrumbBlock shape
    const vblocks: VirtualBreadcrumbBlock[] = blocks.map(b => ({
      index: b.block_index,
      identity_public_key: b.agent_pk,
      timestamp: this.normalizeTimestamp(b.timestamp),
      location_cell: b.location_cell,
      location_resolution: b.location_resolution,
      context_digest: b.context_digest,
      previous_hash: b.previous_hash,
      meta_flags: b.meta_flags,
      signature: b.signature,
      block_hash: b.block_hash,
      delegation_cert_hash: b.delegation_cert_hash,
      tool_name: b.tool_name,
      facet: b.facet,
    }));

    // Build the epoch
    const epoch = await buildEpoch({
      epochIndex,
      agentPk: this.agentPk,
      agentSk: this.agentSk,
      blocks: vblocks,
      previousEpochHash,
      delegationCertHash: this.certHash,
    });

    // Write to Supabase
    const { error: writeErr } = await this.supabase
      .from('agent_epochs')
      .insert({
        agent_pk: epoch.agent_pk,
        epoch_index: epoch.epoch_index,
        start_time: epoch.start_time,
        end_time: epoch.end_time,
        start_block_index: epoch.start_block_index,
        end_block_index: epoch.end_block_index,
        block_count: epoch.block_count,
        merkle_root: epoch.merkle_root,
        previous_epoch_hash: epoch.previous_epoch_hash,
        delegation_cert_hash: epoch.delegation_cert_hash,
        tools_used: epoch.tools_used,
        jurisdiction_cells: epoch.jurisdiction_cells,
        tier_at_close: epoch.tier_at_close,
        signature: epoch.signature,
        epoch_hash: epoch.epoch_hash,
      });

    if (writeErr) throw new Error(`EPOCH: write failed: ${writeErr.message}`);

    console.log(
      `📦 Epoch #${epoch.epoch_index} rolled: ${epoch.block_count} blocks ` +
      `[${epoch.start_block_index}→${epoch.end_block_index}] ` +
      `merkle=${epoch.merkle_root.substring(0, 12)}... ` +
      `tier=${epoch.tier_at_close}`
    );

    return epoch;
  }

  // ===========================================
  // Compliance Report (Phase 5.1.4)
  // ===========================================
  // Generates a full EU AI Act Art. 12/14 report
  // from Supabase tables: breadcrumbs, epochs, certs, violations.

  async generateComplianceReport(period?: {
    from?: string;
    to?: string;
  }): Promise<ComplianceReport> {
    if (!this.initialized) await this.init();

    const from = period?.from ?? '2020-01-01T00:00:00Z';
    const to = period?.to ?? new Date().toISOString();

    // 1. Fetch breadcrumbs in period
    const { data: blocks } = await this.supabase
      .from('agent_breadcrumbs')
      .select('*')
      .eq('agent_pk', this.agentPk)
      .gte('timestamp', from)
      .lte('timestamp', to)
      .order('block_index', { ascending: true });

    const breadcrumbs = blocks ?? [];

    // 2. Fetch epochs in period
    const { data: epochRows } = await this.supabase
      .from('agent_epochs')
      .select('*')
      .eq('agent_pk', this.agentPk)
      .gte('start_time', from)
      .lte('end_time', to)
      .order('epoch_index', { ascending: true });

    const epochs: AgentEpochSummary[] = (epochRows ?? []).map(e => ({
      epoch_index: e.epoch_index,
      agent_pk: e.agent_pk,
      start_time: e.start_time,
      end_time: e.end_time,
      start_block_index: e.start_block_index,
      end_block_index: e.end_block_index,
      block_count: e.block_count,
      merkle_root: e.merkle_root,
      previous_epoch_hash: e.previous_epoch_hash,
      delegation_cert_hash: e.delegation_cert_hash,
      tools_used: e.tools_used,
      jurisdiction_cells: e.jurisdiction_cells,
      tier_at_close: e.tier_at_close as AgentTier,
      signature: e.signature,
      epoch_hash: e.epoch_hash,
    }));

    // 3. Fetch violations
    const { data: violationRows } = await this.supabase
      .from('compliance_violations')
      .select('*')
      .eq('agent_pk', this.agentPk)
      .gte('created_at', from)
      .lte('created_at', to)
      .order('created_at', { ascending: true });

    const violations: ComplianceViolation[] = (violationRows ?? []).map(v => ({
      block_index: v.block_index ?? 0,
      timestamp: v.created_at,
      type: v.violation_type as ComplianceViolation['type'],
      description: v.description,
      severity: v.severity as 'warning' | 'critical',
    }));

    // 4. Fetch agent registry
    const { data: agent } = await this.supabase
      .from('agent_registry')
      .select('*')
      .eq('agent_pk', this.agentPk)
      .single();

    // 5. Verify chain
    const vblocks: VirtualBreadcrumbBlock[] = breadcrumbs.map(b => ({
      index: b.block_index,
      identity_public_key: b.agent_pk,
      timestamp: this.normalizeTimestamp(b.timestamp),
      location_cell: b.location_cell,
      location_resolution: b.location_resolution,
      context_digest: b.context_digest,
      previous_hash: b.previous_hash,
      meta_flags: b.meta_flags,
      signature: b.signature,
      block_hash: b.block_hash,
      delegation_cert_hash: b.delegation_cert_hash,
      tool_name: b.tool_name,
      facet: b.facet,
    }));

    const chainVerification = await verifyChain(vblocks);

    // 6. Compute operations by tool
    const opsByTool: Record<string, number> = {};
    for (const b of breadcrumbs) {
      opsByTool[b.tool_name] = (opsByTool[b.tool_name] ?? 0) + 1;
    }

    // 7. Compute trust score
    const uniqueCells = new Set(breadcrumbs.map(b => b.location_cell)).size;
    const daysSinceFirst = breadcrumbs.length > 0
      ? (Date.now() - new Date(breadcrumbs[0].timestamp).getTime()) / 86400000
      : 0;

    const trustScore = computeTrustScore({
      opCount: breadcrumbs.length,
      uniqueCells,
      daysSinceFirst,
      chainValid: chainVerification.is_valid,
    });

    // 8. Build report
    const report: ComplianceReport = {
      version: 1,
      generated_at: new Date().toISOString(),
      agent_pk: this.agentPk,
      agent_handle: agent?.handle ?? this.config.defaultFacet,
      principal_pk: this.cert.principal_pk,
      reporting_period: { from, to },

      // Art. 12 — Record-keeping
      total_operations: breadcrumbs.length,
      operations_by_tool: opsByTool,
      jurisdiction_cells: [...new Set(breadcrumbs.map(b => b.location_cell))],
      chain_verification: chainVerification,
      epochs,

      // Art. 14 — Human oversight
      delegation_certificate: this.cert,
      delegation_chain_depth: this.cert.max_depth,
      human_approvals_required: breadcrumbs.filter(
        b => this.cert.constraints?.require_human_approval?.includes(b.tool_name)
      ).length,
      human_approvals_received: 0, // TODO: wire to HITL tracker

      // Trust assessment
      current_tier: computeTier(breadcrumbs.length) as AgentTier,
      trust_score: Math.round(trustScore * 100) / 100,
      violations,
    };

    console.log(
      `📊 Compliance report generated: ${report.total_operations} ops, ` +
      `${report.epochs.length} epochs, ${report.violations.length} violations, ` +
      `tier=${report.current_tier}, score=${report.trust_score}`
    );

    return report;
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
