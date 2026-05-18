---
sidebar_position: 10
title: Roadmap
---

# GEIANT Hive Roadmap

This page documents what is shipped and operational at v0.6.0 (the current Hive deployment), what is in flight in the next deployment window, what is on the near-term roadmap, and what is explicitly out of scope. URLs in the *Currently deployed* section are independently verifiable with `curl`.

This page is the canonical roadmap for the Hive layer of the GNS Protocol stack. For the broader GEIANT stack (L0 H3 → L1 GEP → L2 GNS-AIP → L3 GNS → DB MobyDB → L4 Hive), see [docs.geiant.com](https://docs.geiant.com/).

## 12.1 Currently deployed (v0.6.0, May 2026)

### Worker fabric and job execution

- Worker CLI at `@gns-foundation/hive-worker@0.6.0` (see [Worker CLI](/hive/worker-cli))
- Atomic job claiming via the `claim_hive_job()` Postgres RPC with `SELECT FOR UPDATE SKIP LOCKED`
- Inference via `llama.cpp` reference build `b6709`
- **Liquid AI LFM2.5-1.2b-instruct as default model** with three additional models in the registry: `lfm2.5-1.2b-thinking` (Liquid AI), `phi-3-mini` (Microsoft), `tinyllama`
- Pipeline parallelism across multiple workers in the same H3 cell
- Mobile relay workers (GCRUMBS app) routing jobs to compute workers and earning relay fees
- Groq backbone fallback (Llama 3.3 70B) for guaranteed `@ai` uptime

### Desktop client

- Tauri 2 application at v0.5.1
- Signed and notarized binaries for macOS aarch64, macOS x86_64, Windows x64, Linux .deb, Linux AppImage
- Distributed via Cloudflare R2 with manifest at `releases.geiant.com/manifest.json`
- Model selector dropdown wired through to backend

### Agent orchestration primitives (v0.6.0)

The substrate for agent orchestration shipped in v0.6.0, demonstrating that the model marketplace pattern generalizes to a tool marketplace using the same atomic `claim_hive_job()` primitive.

- `hive_tools` registry table with 5 seeded tools (`web-search`, `file-ops`, `python-repl`, `browser-automation`, `code-execution`), each with a `min_trust_tier` capability gate
- Public registry endpoint `GET /v1/tools` and `GET /v1/tools/:tool_id` — workers and clients discover available tools without hard-coding
- Workers advertise executable tools alongside models via the `swarm_nodes.tools` JSONB column (GIN-indexed for capability matching)
- Jobs declare tool requirements via the `hive_jobs.required_tools` JSONB column; both `claim_hive_job()` and `claim_hive_job_pipeline()` enforce `workers.tools @> jobs.required_tools` at claim time, so workers only receive jobs they can execute
- First production tool executor: `web-search` (Brave Search API with DuckDuckGo fallback). First signed tool execution on the swarm: job `b6be2b0f-45dd-43c3-9c80-042973dc52d2`, completed 2026-05-18T12:02:28Z, 369ms claim-to-result, verifiable via `SELECT * FROM hive_jobs WHERE id = 'b6be2b0f-45dd-43c3-9c80-042973dc52d2'`

This is the load-bearing infrastructure for [§12.3 — agent spawning](#agent-spawning-and-orchestration): once tools are claimable, the agent layer becomes a thin orchestrator on top.

### HTTP API surface

All endpoints served from `gns-browser-production.up.railway.app`:

- `POST /v1/chat/completions` — OpenAI-compatible single-step inference (SSE streaming via `stream: true`)
- `GET /v1/tiles/{cell}/{zoom}/{style}.png` — fully live, returns JPEG with audit-chain headers (`x-hive-epoch`, `x-hive-proof`, `x-hive-cell`, `x-hive-worker`, `x-hive-cost`, `x-hive-cache`) exposed via CORS. Five styles configured. Cacheable for one hour.
- `GET /v1/imagery/ndvi?cell=<h3>` — live with input validation. Returns Sentinel-2 NDVI raster via Element84's STAC catalog.
- `POST /v1/compute` — deployed at gate-1 level (signature verification enforced at request entry). Full step DAG executor on the next deployment window (§12.2).
- `GET /hive/status`, `GET /hive/models` — public swarm and model marketplace endpoints

### Audit and identity infrastructure

- Ed25519 keypair identity for all workers and agents
- H3 geographic tagging on every signed action
- Breadcrumb chain accumulated in [MobyDB](/hive/mobydb)
- Internal Merkle-DAG epoch sealing operational — epoch counter currently at 3253 and advancing, observable in the `x-hive-epoch` header of any tile response
- Public audit trail at `hive.geiant.com/audit`
- Public swarm dashboard at `hive.geiant.com/dashboard`
- Stellar settlement at configurable thresholds; first settlement TX `34b02ac18a923bcf...` confirmed March 25, 2026

### Developer ecosystem

- `@gns-aip/sdk` — framework-agnostic SDK for agent identity, delegation, audit
- `langchain-gns-aip` — LangChain extension
- `@gns-foundation/hai-mcp` — MCP server for the `@hai` GCRUMBS/Telegram agent (six tools: `hive_status`, `hive_models`, `hive_run`, `gns_resolve`, `gns_lookup_pk`, `h3_locate`)
- **GEIANT Perception MCP server** (listed at [pulsemcp.com/servers/geiant-agentcore](https://www.pulsemcp.com/servers/geiant-agentcore)) — exposes IBM Prithvi (`Prithvi-EO-2.0-300M-TL-Sen1Floods11`) callable from MCP-aware clients (Claude Desktop, Cursor) for flood classification on Sentinel-2 tiles
- Apache 2.0 benchmark dataset at `huggingface.co/datasets/cayerbe/geiant-benchmark`

### Telegram and GCRUMBS integration

- `@ai` GCRUMBS bot with 100% uptime guarantee (swarm-first with cloud backbone fallback)
- `@hai` Telegram agent on Railway (pk `06e793f6...`)
- AntColony autonomous monitoring runtime: three specialized ants (`@guardian-ant`, `@weather-ant`, `@secretary-ant`) executing on Railway daily at 08:00 CET, with audit records persisted to `hive_colony_runs`

### Standards and IP

- IETF Internet-Draft [`draft-ayerbe-trip-protocol-04`](https://datatracker.ietf.org/doc/draft-ayerbe-trip-protocol/04/) — co-authored with Muhammad Usama Sardar (TU Dresden), submitted to the RATS working group
- USPTO Provisional Patent #63/948,788 (Proof-of-Trajectory). Proof-of-Jurisdiction is a separately patentable claim (#2) covering the four-gate router; see [Overview — The four router gates](/hive/overview#the-four-router-gates)

## 12.2 In flight (Q2/Q3 2026)

Items below are committed scope for the next deployment window. Some are direct dependencies of compliance claims (e.g., Stellar epoch anchoring underpins the EU AI Act Article 12 claim).

### Audit-chain external anchoring

Periodic write of MobyDB epoch Merkle roots to Stellar via `manage_data` operations with `epoch:N` keys. This closes the gap between the internal Merkle-DAG (currently operational) and the externally-verifiable chain. It is the load-bearing prerequisite for the EU AI Act Article 12 compliance claim. See [MobyDB — External anchoring](/hive/mobydb#external-anchoring-to-stellar-v06-roadmap).

### Unified Compute API — full step DAG executor

Extending `/v1/compute` beyond gate-1 verification to full step DAG execution covering inference, tiles, and imagery step types in a single signed request. Each step inherits the request's L2 delegation context; all four router gates fire at the DAG level.

### Model layer maturity

- Cold-start mitigation via pre-warming LFM2.5 (and any registered model) on worker container start (currently only TinyLlama is pre-warmed, producing ~126s cold-start latency on LFM2.5 first requests)
- Proper `hive_models` table replacing the current implicit JSONB representation in `swarm_nodes.models`
- Per-model chat template handling formalized into a table-driven system
- Additional GGUF models on swarm workers: Mistral 7B, Phi-3 Medium, Llama 3.1 8B

### EU AI Act readiness (August 2, 2026 deadline)

- Article 12 compliance report generation as a first-class artifact (the audit chain is the substrate; the report is the regulator-facing surface)
- GNS-AIP delegation certificates enforced per inference session at the request level
- Multi-jurisdiction routing (jobs declaring EEA/GDPR scope are constrained to workers in EEA H3 cells)
- Hive Enterprise private cluster deployment tooling

### Operational hardening

- Settlement-path unification between direct `hive_jobs` settlement and pool-based `hive_settlements`
- Dual-write of structured analytics to `hive_inference_log` for the local `llama-cli` inference path (currently only Groq fallback writes)
- RLS advisory cleanup on five tables (priority on `push_tokens`)
- TypeScript ESM module resolution fix
- Migration of `~/hive-anchor/` to a proper git repository
- Cosmetic fix to `swarm_nodes.worker_version` (currently reports `0.1.7`/`0.1.1` for all workers regardless of actual version)

### Mobile and GCRUMBS

- GCRUMBS iOS App Store release (submitted Q1 2026, awaiting approval)
- Trajectory Badge gamification (5 tiers: Seedling → Explorer → Navigator → Trailblazer → Sovereign)
- Progressive feature unlock tied to trust tier

## 12.3 Near-term (Q3 2026 — agent orchestration)

The next horizon shifts from inference primitives to agent orchestration. The deliverables in this window are what make GEIANT a credible LangChain/CrewAI/AutoGen alternative.

### Trust-tier and identity infrastructure

- Trust tier promotion automation (currently all workers register at `seedling` and stay there)
- Unification of the two trust ladders — TierGate at the GNS-AIP level and the Hive swarm tier
- ASN payout multipliers (deferred from earlier sprints)

### Agent spawning and orchestration

- `@hai` as local orchestrator — decomposes a user goal into sub-tasks and spawns specialized agents on local Hive workers
- GNS-AIP delegation chain for spawned agents (identity, scope, geography, expiry)
- Agent-to-agent messaging via GNS-encrypted envelopes
- Signed breadcrumb audit trail for multi-agent sessions
- GCRUMBS as agent notification surface

### GNS Skills — jurisdiction-enforced tool packages

The tool marketplace primitives are shipped (see [§12.1 — Agent orchestration primitives](#agent-orchestration-primitives-v060)). What remains in this horizon is wrapping tools into delegation-cert-aware capability bundles that enforce GNS-AIP jurisdiction constraints at tool-invocation time. A worker advertising a tool labeled `eu-only` and signed by a sovereign-tier delegation cert can be routed only to jobs originating from EEA H3 cells. This is the bridge between the tool-marketplace primitive and the EU AI Act Article 10(3) data-residency claim.

- Tool capability bundles signed by GNS-AIP delegation certs
- Tool-invocation-time jurisdiction enforcement (the fifth router gate, specific to tool execution)
- Cross-tool audit chain — multi-tool agent sessions produce a single signed breadcrumb sequence

### GCRUMBS Android release

Visual workflow builder in GCRUMBS for non-developer agent chaining.

## 12.4 Q4 2026 and beyond

The final horizon covers the institutional and full-stack governance work that transforms GEIANT Hive from a runtime into a regulated piece of infrastructure.

### Full GEIANT Runtime

- Multi-agent trajectory audit — the audit chain extends from single inference calls to multi-agent task graphs, with cross-agent breadcrumb correlation
- IDUP Stellar settlement integrated with agent sessions (not just per-inference settlement)

### Foundation and governance

- GNS Foundation Swiss Stiftung operational (Canton Zug)
- FINMA pre-assessment for GNS Token utility classification

### Infrastructure partnerships

- FiberCop Azure Local edge cloud integration
- Terna S.p.A. Digital Twin security pilot (Sicilia) — the first sovereign-grade deployment scenario, sub-station-level inference under EU AI Act Article 14 human-oversight requirements

### Perception layer GA

- Microsoft Clay v1.5 embedding generation via the `perception_embed` MCP tool, complementing the already-live Prithvi classification path
- Integration of `flood_classify`, `crop_classify`, and `burn_scar_segmentation` as first-class `image_process` step types in the Unified Compute API

## 12.5 Structurally not in scope

A small number of capabilities are explicitly out of scope for the foreseeable future. Naming them prevents the document from being read as a license for hopeful inference.

### Foundation-model training on consumer hardware

Training LLM weights at meaningful scale on a swarm of consumer devices is structurally bounded by cross-device latency and bandwidth physics. We do not claim and will not attempt this.

### Anything requiring trust in a hyperscale cloud provider for the audit chain

The entire architecture is shaped around the principle that the audit chain's integrity must be verifiable without trusting any single operator — including GEIANT itself, including any hyperscale cloud provider. Choices that violate this principle (e.g., using a managed Merkle-tree service whose root is private to the provider) are out of scope.

## 12.6 Roadmap items pending architectural decision

Three items have architectural fit but no committed implementation:

- **LoRA fine-tuning marketplace.** Workers offer LoRA training capacity on small models; bidirectional payments for training jobs. The architecture fits the existing job-queue primitive; implementation has not started.
- **Federated learning with cryptographic provenance.** Distributed training where each device trains locally and shares gradient updates with cryptographic attribution. The unique value-add over existing federated learning frameworks is the GNS-AIP identity and audit layer.
- **Distillation pipelines.** Train small student models from larger teacher outputs. Teacher inference can run on the swarm; student training fits a single-worker model.

These are roadmap-fit, not roadmap-committed. They will become committed once the v0.6 and v0.7 horizons close out and the operational headroom is available.

---

*This page is the canonical operational roadmap for the GEIANT Hive layer. For the architectural narrative — including the six-layer GEIANT stack, the four router gates, MobyDB internals, IETF TrIP positioning, and EU AI Act mapping — see the GEIANT Hive Swarm Whitepaper v1.1.*
