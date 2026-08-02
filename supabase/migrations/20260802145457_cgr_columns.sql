-- GEIANT #4b — CGR consumption: additive, nullable columns on the agents registry.
--
-- Stores the Foundation-signed CGRAttestation (grafomem #4a, schema
-- cgr.attestation.v1) alongside each agent. Backward-compatible: existing rows get
-- NULLs, and readers treat NULL/absent as `unproven`. Trust decisions RE-VERIFY the
-- signature against the pinned Foundation key — cgr_band / cgr_score are
-- denormalized for querying only and are never authority on their own.
alter table public.agents
  add column if not exists cgr_attestation jsonb,
  add column if not exists cgr_band        text,
  add column if not exists cgr_score        numeric;

comment on column public.agents.cgr_attestation is
  'Foundation-signed CGRAttestation (cgr.attestation.v1). Re-verified against the pinned Foundation key at read time; not authority on its own.';
comment on column public.agents.cgr_band is
  'Denormalized CGR band (unproven|bronze|silver|gold) — querying only.';
comment on column public.agents.cgr_score is
  'Denormalized CGR score — querying only.';
