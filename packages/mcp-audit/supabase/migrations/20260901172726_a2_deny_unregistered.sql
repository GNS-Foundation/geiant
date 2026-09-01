-- ===========================================
-- GEIANT — A2: deny agents absent from agent_registry (grafomem decision 0006, 2026-09-02)
--
-- 0006 Question A resolved to A2: an agent with no agent_registry row is DENIED, not permitted.
-- The old permit behaviour was a fail-open (AUDIT_INIT discarded the zero-row .single() result) that
-- was load-bearing for the agent_registry insert-on-first-sight bootstrap — now removed in
-- middleware.ts. Rows are created by explicit provisioning BEFORE the first audited op.
--
-- Two schema changes:
--   1. A distinct 'unregistered_agent' compliance-violation type, so an unregistered attempt is
--      separable from 'revoked_credential' — they are different facts.
--   2. trg_update_agent_stats now RAISES on a zero-row update instead of silently no-op'ing. Under A2
--      a breadcrumb whose agent has no registry row is an integrity violation (the gate should have
--      refused it); this is defence in depth BEHIND the gate — a missing row signals, never vanishes.
--
-- DEPLOY ORDER: apply before (or with) the code that emits 'unregistered_agent' and that relies on
-- the trigger raising. chk_cv_type would otherwise reject the insert (and logViolation swallows the
-- error — unregistered attempts would go unrecorded).
-- ===========================================

-- 1. Add the 'unregistered_agent' violation type.
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
      'revoked_credential'::text,
      'unregistered_agent'::text
    ])
  );

-- 2. Make the stats trigger fail loud on a missing agent_registry row.
-- Previously the UPDATE hit zero rows and the trigger returned NEW — the breadcrumb was written and
-- the stats update silently vanished (the same fail-silent shape as the pre-A2 gate). Under A2 that
-- state should not exist; if it does, raise so it is caught rather than swallowed.
CREATE OR REPLACE FUNCTION trg_update_agent_stats()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE agent_registry
  SET breadcrumb_count = breadcrumb_count + 1,
      last_active_at = NEW.timestamp,
      current_tier = compute_agent_tier(breadcrumb_count + 1)
  WHERE agent_pk = NEW.agent_pk;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unregistered agent %: breadcrumb inserted with no agent_registry row (A2 integrity violation)',
      NEW.agent_pk
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger binding is unchanged (after_breadcrumb_insert, from 20260320_agent_audit.sql); CREATE OR
-- REPLACE FUNCTION above updates the body in place.
