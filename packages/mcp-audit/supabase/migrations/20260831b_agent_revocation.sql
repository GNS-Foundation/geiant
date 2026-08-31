-- ===========================================
-- GEIANT — agent-level revocation (denylist)
--
-- Companion to 20260831_revocation_enforcement.sql, which added certificate-level
-- revocation. Certificate revocation alone is NOT sufficient to contain a leaked
-- agent secret key:
--
--   verifyDelegationCert() checks principal_signature against the principal_pk
--   carried INSIDE the certificate, and no trusted-principal allowlist exists.
--   A certificate therefore vouches for itself. Anyone holding an agent secret can
--   mint a fresh principal, self-sign a new certificate for the same agent_pk at any
--   scope and expiry, and pass verification — bypassing a cert_hash revocation.
--
-- This is not hypothetical. Production already carried two distinct certificates for
-- agent c14094ea: the revoked 960151d5 (7 tools) on packages/mcp-perception, and an
-- unrevoked 0b2796c1 (11 tools, second ephemeral principal 39545553) on the geiant and
-- geiant-agentcore services. See docs decision record 0003 (grafomem).
--
-- Revocation must therefore bind to the AGENT, not only to a certificate.
--
-- DEPLOY ORDER: apply before (or with) the code that reads agent_registry.revoked_at.
-- Applying early is safe — no code reads the column until the enforcement ships.
-- ===========================================

ALTER TABLE public.agent_registry
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

ALTER TABLE public.agent_registry
  ADD COLUMN IF NOT EXISTS revocation_reason TEXT;

-- Denylist lookups run on every agent init and on the dropBreadcrumb re-check.
CREATE INDEX IF NOT EXISTS idx_agent_registry_revoked
  ON public.agent_registry (agent_pk)
  WHERE revoked_at IS NOT NULL;

COMMENT ON COLUMN public.agent_registry.revoked_at IS
  'Agent-level denylist. NULL = permitted. Enforced by AuditEngine.init() before ANY '
  'insert-on-first-sight (certificate or registry), by preflight(), and by '
  'dropBreadcrumb() via a 60s-TTL re-read. Outranks certificate-level revocation: a '
  'revoked agent is refused regardless of which certificate it presents. Rows are '
  'never deleted on revocation — the audit trail is the point.';

COMMENT ON COLUMN public.agent_registry.revocation_reason IS
  'Free-text operator note recorded alongside revoked_at.';
