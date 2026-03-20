// ===========================================
// GEIANT Phase 5.1.0 — Agent Audit Trail Types
// Virtual breadcrumb chain for MCP agent workflows
// ===========================================
// Mirror of BreadcrumbBlock (Flutter/Dart) ported to TypeScript
// with agent-specific extensions for delegation + jurisdiction

// ===========================================
// Core Block — Virtual Breadcrumb
// ===========================================

export interface VirtualBreadcrumbBlock {
  // --- Fields shared with human BreadcrumbBlock ---
  index: number;
  identity_public_key: string;       // Agent Ed25519 PK (64 hex chars)
  timestamp: string;                 // ISO 8601 UTC
  location_cell: string;             // H3 cell — jurisdictional binding, not GPS
  location_resolution: number;       // H3 resolution (typically 5 for jurisdiction)
  context_digest: string;            // SHA-256 of tool input+output
  previous_hash: string | null;      // null for genesis block
  meta_flags: AgentMetaFlags;
  signature: string;                 // Ed25519 signature (128 hex chars)
  block_hash: string;                // SHA-256 of (dataToSign + signature)

  // --- Agent-specific extensions ---
  delegation_cert_hash: string;      // SHA-256 of the governing DelegationCertificate
  tool_name: string;                 // MCP tool that fired (e.g. "classify_tile")
  facet: string;                     // Capability scope (e.g. "energy@italy-agent")
}

// ===========================================
// Agent Meta Flags
// ===========================================

export interface AgentMetaFlags {
  tool_duration_ms: number;          // Wall-clock execution time
  input_hash: string;                // SHA-256 of canonical tool input
  output_hash: string;               // SHA-256 of canonical tool output
  tier: AgentTier;                   // Current trust tier at time of execution
  model_id?: string;                 // ML model used (e.g. "prithvi-eo-2.0")
  runpod_endpoint?: string;          // RunPod endpoint ID if GPU was used
  error?: string;                    // Error message if tool failed
}

// ===========================================
// Trust Tiers — from GNS-AIP TierGate
// ===========================================

export enum AgentTier {
  PROVISIONED = 'provisioned',       // 0 ops, 0% trust, read-only sandboxed
  OBSERVED    = 'observed',          // 50+ ops, 25% trust, basic processing
  TRUSTED     = 'trusted',           // 500+ ops, 60% trust, data processing
  CERTIFIED   = 'certified',        // 5000+ ops, 85% trust, financial txns
  SOVEREIGN   = 'sovereign',        // 50000+ ops, 99% trust, full autonomy
}

export const TIER_THRESHOLDS: Record<AgentTier, { min_ops: number; trust_pct: number }> = {
  [AgentTier.PROVISIONED]: { min_ops: 0, trust_pct: 0 },
  [AgentTier.OBSERVED]:    { min_ops: 50, trust_pct: 25 },
  [AgentTier.TRUSTED]:     { min_ops: 500, trust_pct: 60 },
  [AgentTier.CERTIFIED]:   { min_ops: 5000, trust_pct: 85 },
  [AgentTier.SOVEREIGN]:   { min_ops: 50000, trust_pct: 99 },
};

// ===========================================
// Delegation Certificate
// ===========================================

export interface DelegationCertificate {
  version: 1;
  agent_pk: string;                  // Agent's Ed25519 public key
  principal_pk: string;              // Human principal's Ed25519 public key
  h3_cells: string[];                // Allowed jurisdictional H3 cells
  facets: string[];                  // Allowed capability scopes
  not_before: string;                // ISO 8601 — validity start
  not_after: string;                 // ISO 8601 — validity end
  max_depth: number;                 // Max sub-delegation depth (0 = no sub-delegation)
  constraints?: DelegationConstraints;
  principal_signature: string;       // Human signs the cert with their Ed25519 key
}

export interface DelegationConstraints {
  max_ops_per_hour?: number;         // Rate limit
  allowed_tools?: string[];          // Whitelist of MCP tools
  denied_tools?: string[];           // Blacklist of MCP tools
  require_human_approval?: string[]; // Tools that need human-in-the-loop
  max_cost_per_op_xlm?: number;      // Stellar cost ceiling per operation
}

// ===========================================
// Agent Identity
// ===========================================

export interface AgentIdentity {
  public_key: string;                // Ed25519 public key (64 hex chars)
  handle: string;                    // e.g. "energy@italy-geiant"
  delegation_cert: DelegationCertificate;
  created_at: string;                // ISO 8601
  stellar_address?: string;          // Derived from PK for IDUP settlement
}

// ===========================================
// Chain Verification
// ===========================================

export interface ChainVerificationResult {
  is_valid: boolean;
  block_count: number;
  issues: string[];
  first_block_at?: string;
  last_block_at?: string;
  delegation_cert_hash?: string;
}

// ===========================================
// Epoch Summary (periodic Merkle rollup)
// ===========================================

export interface AgentEpochSummary {
  epoch_index: number;
  agent_pk: string;
  start_time: string;
  end_time: string;
  start_block_index: number;
  end_block_index: number;
  block_count: number;
  merkle_root: string;               // Merkle root of all block hashes in epoch
  previous_epoch_hash: string | null;
  delegation_cert_hash: string;
  tools_used: string[];              // Distinct tool names in this epoch
  jurisdiction_cells: string[];      // Distinct H3 cells operated in
  tier_at_close: AgentTier;
  signature: string;                 // Agent signs the epoch
  epoch_hash: string;
}

// ===========================================
// Compliance Report (EU AI Act output)
// ===========================================

export interface ComplianceReport {
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
  trust_score: number;               // 0-100
  violations: ComplianceViolation[];
}

export interface ComplianceViolation {
  block_index: number;
  timestamp: string;
  type: 'jurisdiction_breach' | 'facet_violation' | 'rate_limit' | 'cert_expired' | 'chain_break';
  description: string;
  severity: 'warning' | 'critical';
}

// ===========================================
// Jurisdiction Gate
// ===========================================

export interface JurisdictionCheck {
  allowed: boolean;
  target_cell: string;
  allowed_cells: string[];
  reason?: string;                   // Set when allowed=false
}

// ===========================================
// Block Builder — data-to-sign contract
// ===========================================

export interface BlockDataToSign {
  index: number;
  identity: string;
  timestamp: string;
  loc_cell: string;
  loc_res: number;
  context: string;
  prev_hash: string;                 // "genesis" for index 0
  meta: AgentMetaFlags;
  delegation_cert_hash: string;
  tool_name: string;
  facet: string;
}

// ===========================================
// Supabase Row Types (DB ↔ App mapping)
// ===========================================

export interface DbAgentBreadcrumb {
  id: number;                        // bigint auto-increment
  agent_pk: string;
  block_index: number;
  timestamp: string;
  location_cell: string;
  location_resolution: number;
  context_digest: string;
  previous_hash: string | null;
  meta_flags: AgentMetaFlags;
  signature: string;
  block_hash: string;
  delegation_cert_hash: string;
  tool_name: string;
  facet: string;
  created_at: string;                // Supabase default
}

export interface DbAgentEpoch {
  id: number;
  agent_pk: string;
  epoch_index: number;
  start_time: string;
  end_time: string;
  start_block_index: number;
  end_block_index: number;
  block_count: number;
  merkle_root: string;
  previous_epoch_hash: string | null;
  delegation_cert_hash: string;
  tools_used: string[];
  jurisdiction_cells: string[];
  tier_at_close: AgentTier;
  signature: string;
  epoch_hash: string;
  created_at: string;
}

export interface DbDelegationCertificate {
  id: number;
  cert_hash: string;                 // SHA-256 of canonical cert JSON
  agent_pk: string;
  principal_pk: string;
  h3_cells: string[];
  facets: string[];
  not_before: string;
  not_after: string;
  max_depth: number;
  constraints: DelegationConstraints | null;
  principal_signature: string;
  created_at: string;
  revoked_at: string | null;
}
