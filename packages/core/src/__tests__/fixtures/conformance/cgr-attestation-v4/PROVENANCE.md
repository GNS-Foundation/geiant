# Vendored conformance corpus — cgr.attestation.v4

`vectors.json` is a **vendored copy** of the repo-level conformance corpus, the shared
executable contract both v4 consumers (the grafomem reference verifier and @geiant/core)
run against.

| | |
|---|---|
| Source repo | `GNS-Foundation/grafomem` |
| Source path | `conformance/cgr-attestation-v4/vectors.json` |
| Source commit | `71973bc4104c...` (grafomem `docs/domain-conditional`; the domain-gate + 0002 sweep corpus, PR #102) |
| Vectors | 56 (54 enforcing, 2 non-enforcing) |
| Vendored | 2026-09-03 |

> Vendored from an **unmerged** branch (PR #102). Re-sync at the merged `main` SHA once #102 lands.

The only local modification is an added top-level `_provenance` key (this metadata); the
`vectors` array and all corpus keys are byte-for-byte upstream.

## Why vendored (not submodule / package / fetch)

geiant's gating `core` CI job is hermetic — pure TS + crypto + committed fixtures, no network,
no DB. A submodule or CI-fetch would inject repo/network coupling into a job designed without it;
a published package is premature while the corpus is still churning in P1.x. Vendoring matches the
existing pattern (the `cgr_attestation_v*_jcs.golden.json` fixtures are vendored the same way) and
keeps tests hermetic. Drift is made visible by the ported `test_corpus_wellformed` self-check
(cgr_v4_conformance.test.ts) and the sync step below.

## Re-syncing

To adopt a newer corpus (deliberate, reviewable bump):

```bash
node scripts/sync-corpus.mjs   # re-copies from a pinned grafomem checkout, updates source_sha
```

Then re-run `npm test` — the wellformed self-check re-validates the corpus's internal invariants
(signatures verify against the pinned issuer, T2≠T8 distinct lineage_status, both modes present,
count matches `upstream_vector_count`).
