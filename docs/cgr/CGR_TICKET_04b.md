# Claude Code Ticket #4b — CGR Consumption in GEIANT TierGate (geiant repo)

**Repo:** `~/geiant` (TS monorepo, pnpm)  ·  **Owner (architect):** Camilo + Cowork-chat (spec)  ·  **You:** implementer
**Base:** new branch `cgr/tiergate-consumption` off `main`.
**Depends on:** grafomem #4a (merged) — GEIANT consumes the Foundation-signed `CGRAttestation` it emits. **This is the first ticket in the `geiant` repo; the Claude Code loop now spans two repos.**
**Scope:** Make GEIANT's TierGate **consume** a Foundation-issued CGR attestation as the earned-quality axis on top of the existing volume-based tier. **GEIANT never computes CGR — it verifies + displays a score issued elsewhere.**

> **Context (why):** Today `AntTier` is `computeTier(operationCount)` — pure volume (50k ops ⇒ "sovereign"), and the manifest is self-signed. CGR upgrades this: the AntTier ladder + complianceScore stay as the **verifiable eligibility axis** (necessary gating), and the Foundation-issued CGR band (`unproven→bronze→silver→gold`) becomes the **earned judgment-quality axis**. Effective trust = `eligibility ⊓ CGR band`. Design: `docs/cgr/cgr-tiergate-wiring.md` + `reputation-score-design.md` (architect will paste; they live in the grafomem project). The attestation schema + the pure verify logic to mirror are in grafomem `src/aml/cgr/attestation.py` (`cgr.attestation.v1`).

## The attestation you consume (from grafomem #4a)
```
{ agent_handle, dimension, tier(=band), cgr_score, confidence, n_resolved,
  capability_tier, as_of, rationale, schema:"cgr.attestation.v1",
  issuer:"gns-foundation", issuer_key_id:<foundation pubkey hex>,
  signature:<hex>,            // Ed25519 over canonical SIGNED BODY
  evidence_ref:<gcrumbs id|null> }   // envelope, NOT signed
```
The **signed body** = everything except `signature` and `evidence_ref`. Signature is Ed25519 (64-byte / 128-hex) over `canon(signed_body)`.

## ⚠️ The #1 correctness risk — canonicalization byte-parity (read this twice)
grafomem signs `canon(body)` = Python `json.dumps(body, sort_keys=True, separators=(",",":"), default=str)`. Your TS verify MUST reproduce **byte-identical** canonical bytes or every signature fails. Sorted keys + no whitespace is the easy part; **number formatting is the trap** (`cgr_score`, `confidence`, `capability_tier` are floats). Do NOT hand-roll and hope.
- Mandatory: build a **golden cross-language fixture** — with grafomem checked out, run `build_attestation` with a **fixed** `FOUNDATION_SIGNING_SEED` on a known `to_tiergate` dict, dump the exact attestation JSON + signature, and commit it to `geiant` tests. `verifyCGRAttestation` must return true on it and false on a one-byte tamper. This fixture is the contract; if it fails, the fix is to align number/string canonicalization across the two languages (flag to architect) — never to loosen verify.
- Recommended: verify over the exact received bytes where possible. If your JSON lib can't guarantee parity on floats, flag it — we may pin a shared canonicalization (e.g. serialize floats via a fixed format on both sides) as a small follow-up rather than guess.

## Trust root — pin the Foundation key (security)
GEIANT must **pin** the Foundation public key via config (env `CGR_FOUNDATION_PUBKEY`, hex), NOT blindly trust whatever `GET /v1/cgr/issuer` returns (a swapped issuer endpoint would otherwise forge trust). Optionally cross-check the pinned key against `/v1/cgr/issuer` and warn on mismatch, but the **pinned config key is the trust anchor**.

## Read these first (real files)
- `packages/core/src/crypto/ed25519.ts` — `verifyMessage(msg, sigHex, pubHex)` (@noble/ed25519). Reuse this for the signature check.
- `packages/core/src/types/index.ts` — `AntIdentity`, `AntManifest`, `AntTier`, `ANT_TIER_MIN_OPS`.
- `packages/core/src/agent/identity.ts` — `computeTier`, `tierSatisfies`, `scoreAntFitness` (the volume-based scorer to upgrade), `validateManifestStructure`.
- `packages/core/src/registry/supabase_registry.ts` — `rowToManifest` / `manifestToRow` (the DB column mapping; note there is **no `supabase/migrations/` dir** — see Task E).

## Task A — types (`packages/core/src/types/index.ts`)
- Add `CGRAttestation` interface (fields above). Add `CGRBand = 'unproven'|'bronze'|'silver'|'gold'`.
- Add optional `cgr?: CGRAttestation` to `AntManifest` (absent ⇒ legacy/unproven → fully backward-compatible).

## Task B — verify (`packages/core/src/agent/cgr.ts`, new)
- `canonCGRBody(att): string` — reproduce grafomem's canonical signed body (sorted keys, tight separators, envelope keys excluded). Shared by verify + any fingerprinting.
- `verifyCGRAttestation(att, foundationPubKeyHex, opts?): { valid: boolean; reason?: string }` — signature via `verifyMessage(canonCGRBody(att), att.signature, foundationPubKeyHex)`; plus checks: `schema==="cgr.attestation.v1"`, `issuer==="gns-foundation"`, `issuer_key_id===foundationPubKeyHex` (pinned), optional freshness (`as_of` within a max-age), and (when used on a manifest) `att.agent_handle===manifest.identity.handle`.
- Pure, dependency-light (crypto + stdlib) so it can lift into an SDK later.

## Task C — tier exposure (`identity.ts`)
- Keep `computeTier(operationCount)` unchanged (the eligibility ladder).
- Add `cgrBand(manifest): CGRBand` — the verified band if a valid attestation is present, else `'unproven'`.
- Add `effectiveTrust(manifest)` → `{ tier: AntTier, cgrBand: CGRBand }` — expose BOTH, never collapse. This is the surface for the dashboard/website later.

## Task D — facet-aware routing (`scoreAntFitness` in `identity.ts`)
- Add a **CGR term**. For **unverifiable facets** (`finance`, `legal`) the CGR band×confidence term should **dominate** the raw `experienceBonus` (which today rewards volume and is exactly what CGR corrects). For verifiable/ops-heavy facets, keep more of today's behavior.
- No attestation / `unproven` ⇒ fall back to today's `scoreAntFitness` exactly (backward-compatible; no ranking change for legacy agents).
- Keep territory + `tierSatisfies` as hard gates (eligibility unchanged).

## Task E — persistence + migration (confirm mechanism FIRST)
`scoreAntFitness` needs the band at routing time, so the manifest row must carry CGR.
- **STOP and confirm with the architect how the GEIANT registry schema is managed** — there is no `supabase/migrations/` dir, so the live table was created another way (dashboard / manual / elsewhere). Do not guess-apply a migration into a mechanism that isn't used.
- Once confirmed: add `cgr_attestation jsonb` (full attestation) + optionally `cgr_band text` / `cgr_score numeric` for querying; wire `rowToManifest` / `manifestToRow`; provide the migration in whatever form the repo actually uses. Absent column ⇒ `cgr: undefined` (backward-compatible).
- **Do NOT** verify-on-write-then-trust-forever silently: store the attestation, but `cgrBand()`/routing should verify (or trust a verified-at-read flag) so a tampered row can't grant trust.

## Task F — optional capability ceiling at the GEIANT layer
Gate high tiers on CGR: `certified`/`sovereign` (financial autonomy) require a minimum CGR band, not ops alone — financial-autonomy trust can't be reached on volume. Implement as an advisory check or a hard gate — flag which you chose. (Optional; land A–E first.)

## Tests (`packages/core/**/*.test.ts`, match repo style)
- **Golden cross-language fixture** (the contract): a real grafomem-emitted attestation+signature verifies true; one-byte tamper (score/band/handle) verifies false.
- Wrong key (a non-Foundation pubkey) → false; wrong `issuer`/`schema`/`issuer_key_id` → false; stale `as_of` beyond max-age → false (if freshness enabled).
- `effectiveTrust` exposes both axes; `cgrBand` = `unproven` when no/invalid attestation.
- `scoreAntFitness`: for a `finance` facet, a `gold`+high-confidence agent outranks a high-ops/`unproven` agent (CGR dominates volume); a legacy no-attestation agent scores exactly as before.
- Persistence round-trip once the schema mechanism is confirmed.
- Existing suite green.

## Acceptance / definition of done
1. `verifyCGRAttestation` verifies a real #4a attestation against the pinned Foundation key (golden fixture), rejects tamper/wrong-key/wrong-issuer.
2. `effectiveTrust` exposes `tier` (eligibility) + `cgrBand` (earned); both persisted + read back.
3. `scoreAntFitness` is facet-aware; unverifiable facets let CGR dominate volume; legacy agents unaffected.
4. Foundation key is pinned via config (not blindly trusted from the issuer endpoint).
5. Migration applied via the repo's actual schema mechanism (confirmed first); new + existing tests green.

## Non-goals
- No change to grafomem issuance (#4a is done); no writing back to grafomem.
- Don't remove/alter the self-signed manifest path — CGR is additive.
- No UI/dashboard (later); no new brand/routing beyond the CGR term.

## Hand-off
Produce: diff summary, the golden-fixture test + its provenance (which grafomem seed/input generated it), test output, the migration (and how it's applied), and a 3-line note on: the canonicalization approach + whether byte-parity held first try, the pinned-key config, and the Task F choice. Camilo brings the diff to the Cowork chat for review against `docs/cgr/cgr-tiergate-wiring.md`.
