-- GEIANT #7 (7b) — CGR identity continuity: additive, nullable columns on the
-- agents registry so a rotated agent stays ONE identity.
--
-- identity_anchor = the genesis (anchor) public key an identity's reputation
-- aggregates over; stable across key rotation. The operational key (public_key)
-- may rotate while identity_anchor does not, so the registry resolves an agent by
-- its anchor (falling back to public_key for legacy rows with NULL anchor).
-- Backward-compatible: existing rows get NULLs and still resolve by public_key.
-- Applied to prod (project kaqwkxfaclyqjlfhxrmt) via Supabase MCP; recorded as
-- migration 20260803173755.
alter table public.agents
  add column if not exists identity_anchor text,
  add column if not exists key_history     jsonb;

comment on column public.agents.identity_anchor is
  'CGR #7: genesis (anchor) public key hex the identity aggregates over; stable across key rotation. NULL for legacy rows (resolve by public_key).';
comment on column public.agents.key_history is
  'CGR #7: optional ordered [anchor..current] key-history for audit/display.';

-- Lookup index: registry resolves a rotated agent by its stable anchor.
create index if not exists agents_identity_anchor_idx on public.agents (identity_anchor);
