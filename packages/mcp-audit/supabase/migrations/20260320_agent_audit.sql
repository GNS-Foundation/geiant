-- ===========================================
-- GEIANT Phase 5.1.0 — Agent Audit Trail
-- Supabase migration: virtual breadcrumb chain
-- Target: kaqwkxfaclyqjlfhxrmt.supabase.co
-- ===========================================

-- Extension for H3 if not already present
CREATE EXTENSION IF NOT EXISTS h3 CASCADE;

-- ===========================================
-- Delegation Certificates
-- ===========================================
-- Stores signed delegation certs from human principals.
-- A cert authorises an agent to operate within specific
-- H3 cells and facets for a bounded time window.

CREATE TABLE IF NOT EXISTS delegation_certificates (
  id            BIGSERIAL PRIMARY KEY,
  cert_hash     TEXT NOT NULL UNIQUE,          -- SHA-256 of canonical cert JSON
  agent_pk      TEXT NOT NULL,                 -- Agent Ed25519 public key (64 hex)
  principal_pk  TEXT NOT NULL,                 -- Human principal Ed25519 PK
  h3_cells      TEXT[] NOT NULL,               -- Allowed jurisdictional H3 cells
  facets        TEXT[] NOT NULL,               -- Allowed capability scopes
  not_before    TIMESTAMPTZ NOT NULL,
  not_after     TIMESTAMPTZ NOT NULL,
  max_depth     INTEGER NOT NULL DEFAULT 0,
  constraints   JSONB,                         -- Rate limits, tool whitelist, etc.
  principal_signature TEXT NOT NULL,            -- Ed25519 sig (128 hex)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ,

  CONSTRAINT chk_cert_validity CHECK (not_after > not_before),
  CONSTRAINT chk_agent_pk_len CHECK (LENGTH(agent_pk) = 64),
  CONSTRAINT chk_principal_pk_len CHECK (LENGTH(principal_pk) = 64),
  CONSTRAINT chk_sig_len CHECK (LENGTH(principal_signature) = 128),
  CONSTRAINT chk_max_depth CHECK (max_depth >= 0 AND max_depth <= 5)
);

CREATE INDEX idx_deleg_cert_agent ON delegation_certificates (agent_pk);
CREATE INDEX idx_deleg_cert_principal ON delegation_certificates (principal_pk);
CREATE INDEX idx_deleg_cert_validity ON delegation_certificates (not_before, not_after)
  WHERE revoked_at IS NULL;

-- ===========================================
-- Agent Breadcrumbs (Virtual)
-- ===========================================
-- One row per MCP tool invocation. Each row chains
-- to the previous via SHA-256 hash link, exactly like
-- the human breadcrumb chain in GCRUMBS Flutter.

CREATE TABLE IF NOT EXISTS agent_breadcrumbs (
  id                  BIGSERIAL PRIMARY KEY,
  agent_pk            TEXT NOT NULL,
  block_index         INTEGER NOT NULL,
  timestamp           TIMESTAMPTZ NOT NULL,
  location_cell       TEXT NOT NULL,            -- H3 cell (jurisdictional binding)
  location_resolution INTEGER NOT NULL DEFAULT 5,
  context_digest      TEXT NOT NULL,            -- SHA-256 of tool input+output
  previous_hash       TEXT,                     -- NULL for genesis block
  meta_flags          JSONB NOT NULL,
  signature           TEXT NOT NULL,            -- Agent Ed25519 sig (128 hex)
  block_hash          TEXT NOT NULL,            -- SHA-256 of (dataToSign + signature)

  -- Agent extensions
  delegation_cert_hash TEXT NOT NULL,
  tool_name           TEXT NOT NULL,
  facet               TEXT NOT NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_ab_agent_pk_len CHECK (LENGTH(agent_pk) = 64),
  CONSTRAINT chk_ab_sig_len CHECK (LENGTH(signature) = 128),
  CONSTRAINT chk_ab_block_hash CHECK (LENGTH(block_hash) = 64),
  CONSTRAINT chk_ab_genesis CHECK (
    (block_index = 0 AND previous_hash IS NULL)
    OR (block_index > 0 AND previous_hash IS NOT NULL)
  ),
  CONSTRAINT chk_ab_resolution CHECK (location_resolution BETWEEN 0 AND 15)
);

-- Unique chain per agent: no duplicate block indices
CREATE UNIQUE INDEX idx_ab_chain ON agent_breadcrumbs (agent_pk, block_index);

-- Fast lookups for chain verification (walk forward)
CREATE INDEX idx_ab_agent_time ON agent_breadcrumbs (agent_pk, timestamp);

-- Jurisdiction queries: "show all ops in this H3 cell"
CREATE INDEX idx_ab_cell ON agent_breadcrumbs (location_cell);

-- Tool analytics: "how many classify_tile calls this week"
CREATE INDEX idx_ab_tool ON agent_breadcrumbs (tool_name, timestamp);

-- Delegation cert join
CREATE INDEX idx_ab_deleg ON agent_breadcrumbs (delegation_cert_hash);

-- ===========================================
-- Agent Epochs (Merkle rollup)
-- ===========================================
-- Periodic summaries of N breadcrumb blocks.
-- The merkle_root covers all block_hashes in the epoch.
-- Mirrors the human epoch system in chain_storage.dart.

CREATE TABLE IF NOT EXISTS agent_epochs (
  id                    BIGSERIAL PRIMARY KEY,
  agent_pk              TEXT NOT NULL,
  epoch_index           INTEGER NOT NULL,
  start_time            TIMESTAMPTZ NOT NULL,
  end_time              TIMESTAMPTZ NOT NULL,
  start_block_index     INTEGER NOT NULL,
  end_block_index       INTEGER NOT NULL,
  block_count           INTEGER NOT NULL,
  merkle_root           TEXT NOT NULL,          -- Merkle root of block hashes
  previous_epoch_hash   TEXT,                   -- Chain of epochs
  delegation_cert_hash  TEXT NOT NULL,
  tools_used            TEXT[] NOT NULL,
  jurisdiction_cells    TEXT[] NOT NULL,
  tier_at_close         TEXT NOT NULL,          -- AgentTier enum value
  signature             TEXT NOT NULL,
  epoch_hash            TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_ae_agent_pk_len CHECK (LENGTH(agent_pk) = 64),
  CONSTRAINT chk_ae_epoch_order CHECK (end_time > start_time),
  CONSTRAINT chk_ae_block_order CHECK (end_block_index >= start_block_index),
  CONSTRAINT chk_ae_block_count CHECK (block_count = end_block_index - start_block_index + 1),
  CONSTRAINT chk_ae_tier CHECK (tier_at_close IN (
    'provisioned', 'observed', 'trusted', 'certified', 'sovereign'
  ))
);

CREATE UNIQUE INDEX idx_ae_chain ON agent_epochs (agent_pk, epoch_index);
CREATE INDEX idx_ae_time ON agent_epochs (agent_pk, start_time, end_time);

-- ===========================================
-- Agent Registry
-- ===========================================
-- Lightweight registry of active agents.
-- Trust score and tier are computed from breadcrumb count.

CREATE TABLE IF NOT EXISTS agent_registry (
  agent_pk        TEXT PRIMARY KEY,
  handle          TEXT NOT NULL UNIQUE,          -- e.g. "energy@italy-geiant"
  display_name    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at  TIMESTAMPTZ,
  breadcrumb_count INTEGER NOT NULL DEFAULT 0,
  trust_score     REAL NOT NULL DEFAULT 0,
  current_tier    TEXT NOT NULL DEFAULT 'provisioned',
  active_cert_hash TEXT,                         -- Currently governing delegation cert
  stellar_address TEXT,

  CONSTRAINT chk_ar_pk_len CHECK (LENGTH(agent_pk) = 64),
  CONSTRAINT chk_ar_tier CHECK (current_tier IN (
    'provisioned', 'observed', 'trusted', 'certified', 'sovereign'
  )),
  CONSTRAINT chk_ar_trust CHECK (trust_score BETWEEN 0 AND 100)
);

-- ===========================================
-- Compliance Violations Log
-- ===========================================
-- Records any jurisdiction breach, facet violation,
-- rate limit hit, cert expiry, or chain integrity issue.

CREATE TABLE IF NOT EXISTS compliance_violations (
  id            BIGSERIAL PRIMARY KEY,
  agent_pk      TEXT NOT NULL,
  block_index   INTEGER,                        -- NULL if not tied to a specific block
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  violation_type TEXT NOT NULL,
  description   TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'warning',
  resolved_at   TIMESTAMPTZ,

  CONSTRAINT chk_cv_type CHECK (violation_type IN (
    'jurisdiction_breach', 'facet_violation', 'rate_limit',
    'cert_expired', 'chain_break'
  )),
  CONSTRAINT chk_cv_severity CHECK (severity IN ('warning', 'critical'))
);

CREATE INDEX idx_cv_agent ON compliance_violations (agent_pk, timestamp);
CREATE INDEX idx_cv_unresolved ON compliance_violations (agent_pk)
  WHERE resolved_at IS NULL;

-- ===========================================
-- RLS Policies
-- ===========================================
-- Service role has full access. Anon role gets read-only
-- on breadcrumbs and epochs for third-party verification.

ALTER TABLE delegation_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_breadcrumbs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_epochs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_violations ENABLE ROW LEVEL SECURITY;

-- Service role: full access
CREATE POLICY "service_full_deleg" ON delegation_certificates
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_full_ab" ON agent_breadcrumbs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_full_ae" ON agent_epochs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_full_ar" ON agent_registry
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_full_cv" ON compliance_violations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Anon role: read-only on audit trail (public verifiability)
CREATE POLICY "anon_read_ab" ON agent_breadcrumbs
  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_ae" ON agent_epochs
  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_ar" ON agent_registry
  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_deleg" ON delegation_certificates
  FOR SELECT TO anon USING (true);

-- ===========================================
-- Helper functions
-- ===========================================

-- Get current tier for an agent based on breadcrumb count
CREATE OR REPLACE FUNCTION compute_agent_tier(op_count INTEGER)
RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE
    WHEN op_count >= 50000 THEN 'sovereign'
    WHEN op_count >= 5000  THEN 'certified'
    WHEN op_count >= 500   THEN 'trusted'
    WHEN op_count >= 50    THEN 'observed'
    ELSE 'provisioned'
  END;
$$;

-- Trigger: update agent_registry on new breadcrumb
CREATE OR REPLACE FUNCTION trg_update_agent_stats()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE agent_registry
  SET breadcrumb_count = breadcrumb_count + 1,
      last_active_at = NEW.timestamp,
      current_tier = compute_agent_tier(breadcrumb_count + 1)
  WHERE agent_pk = NEW.agent_pk;
  RETURN NEW;
END;
$$;

CREATE TRIGGER after_breadcrumb_insert
  AFTER INSERT ON agent_breadcrumbs
  FOR EACH ROW EXECUTE FUNCTION trg_update_agent_stats();
