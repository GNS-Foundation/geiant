-- ===========================================
-- GEIANT — revocation enforcement
-- Adds the 'revoked_credential' compliance violation type.
--
-- Context: delegation_certificates.revoked_at and the partial index
--   idx_delegation_certificates_active ... WHERE revoked_at IS NULL
-- have existed since 20260320_agent_audit.sql, but no code path ever read the
-- column. AuditEngine now gates on it (chain.ts checkRevocation), and records a
-- distinct violation type so revoked-credential attempts are separable from
-- jurisdiction_breach in compliance reporting.
--
-- DEPLOY ORDER: this migration MUST be applied before (or with) the code that
-- emits 'revoked_credential'. chk_cv_type would otherwise reject the insert and
-- logViolation swallows the error — revoked-key attempts would go unrecorded.
-- ===========================================

ALTER TABLE public.compliance_violations
  DROP CONSTRAINT IF EXISTS chk_cv_type;

ALTER TABLE public.compliance_violations
  ADD CONSTRAINT chk_cv_type CHECK (
    violation_type = ANY (ARRAY[
      'jurisdiction_breach'::text,
      'facet_violation'::text,
      'rate_limit'::text,
      'cert_expired'::text,
      'chain_break'::text,
      'revoked_credential'::text
    ])
  );

-- Revoked certs are read on every agent init and on the dropBreadcrumb
-- re-check; the existing index is partial on revoked_at IS NULL and so does
-- not serve lookups for revoked rows.
CREATE INDEX IF NOT EXISTS idx_delegation_certificates_revoked
  ON public.delegation_certificates (cert_hash)
  WHERE revoked_at IS NOT NULL;

COMMENT ON COLUMN public.delegation_certificates.revoked_at IS
  'Revocation timestamp. NULL = live. Enforced by AuditEngine.init() before the '
  'insert-on-first-sight path, by preflight(), and by dropBreadcrumb() via a '
  '60s-TTL re-read. Rows are never deleted on revocation — the audit trail is '
  'the point.';
