---
sidebar_position: 3
---

# Unified Compute API

Every Hive job goes through one endpoint. The `steps` array defines what needs to happen. Steps can reference outputs of previous steps via `depends_on`.

**Endpoint:** `POST /v1/compute`

## The four router gates

Every request to `/v1/compute` passes through four enforcement gates at the GNS-AIP layer before any step is dispatched. The gates are sequential — a request that fails any one is rejected without invoking the next:

1. **Signature verification** — Ed25519 signature over canonical request JSON (currently live in production; verifiable with `curl`)
2. **Jurisdiction resolution** — request's H3 cell resolved to country and applicable regulatory framework
3. **Delegation chain validation** — agent's delegation cert traced to a human principal at L3 GNS
4. **Geometry pre-flight** — GEOS-backed validation for any geometric primitives

```bash
# Gate 1 firing in production:
$ curl -X POST https://gns-browser-production.up.railway.app/v1/compute -d '{...}'
{"error":"signature_required","detail":"X-GNS-Signature header is required"}
```

The full multi-step DAG executor — composing inference, tiles, and imagery in a single signed request with end-to-end delegation propagation — is on the v0.6 roadmap. Gates 2–4 fire at the DAG level rather than per-step. See [Roadmap §12.2](/hive/roadmap) for the deployment window.

## Request format

```json
{
  "requester_pk": "<Ed25519 public key>",
  "h3_cell": "871e9a0ecffffff",
  "steps": [
    {
      "id": "ask",
      "type": "inference",
      "model": "lfm2.5-1.2b-instruct",
      "messages": [
        {"role": "user", "content": "What are the best restaurants near me?"}
      ],
      "context": {
        "h3_cell": "871e9a0ecffffff"
      }
    }
  ],
  "budget_gns": 0.01,
  "signature": "<Ed25519 signature of canonical JSON>"
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `requester_pk` | string | Yes | Ed25519 public key of the requester |
| `h3_cell` | string | No | H3 cell for job routing (default: Rome) |
| `steps` | array | Yes | Array of compute steps |
| `budget_gns` | number | No | Maximum GNS to spend (default: 0.1) |
| `signature` | string | Yes | Ed25519 signature for authenticated requests (required by Gate 1) |

### Step fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique step identifier |
| `type` | string | Yes | `inference`, `tile_render`, `image_process`, `sensor_fusion` |
| `depends_on` | string | No | ID of a step whose output feeds into this one |
| `model` | string | No | Model for inference (default: `lfm2.5-1.2b-instruct` for swarm workers; `llama-3.3-70b-versatile` for Groq backbone fallback) |
| `messages` | array | No | Chat messages for inference steps |
| `operation` | string | No | Operation for image_process (e.g. `ndvi`) |
| `center_cell` | string | No | H3 cell for tile_render center |
| `zoom` | number | No | Zoom level for tile_render (0-20) |
| `style` | string | No | Tile style: `osm-bright`, `dark`, `satellite`, `terrain` |
| `context` | object | No | Additional context (h3_cell, epoch, date_from, date_to) |

## Response format

```json
{
  "job_id": "596f5a7c-ed12-4061-ad8c-8893f811dddc",
  "worker_pk": "groq-backbone",
  "h3_cell": "871e9a0ecffffff",
  "epoch": 3253,
  "steps": [
    {
      "id": "ask",
      "type": "inference",
      "status": "complete",
      "output": {
        "text": "Here are 3 great restaurants...",
        "locations": [
          {"name": "Da Enzo", "address": "Via dei Vascellari, 29"}
        ],
        "model": "groq/llama-3.3-70b-versatile",
        "provider": "groq",
        "tokens_in": 42,
        "tokens_out": 187,
        "latency_ms": 340,
        "proof_job_id": "f50c0e8a-..."
      },
      "latency_ms": 340
    }
  ],
  "settlement": {
    "stellar_tx": null,
    "total_gns": 0.0043,
    "breakdown": {
      "ask": 0.0043
    }
  },
  "proof": {
    "job_hash": "d3ae5772bca226fa...",
    "verify_url": "https://mobydb.com/proof/871e9a0ecffffff/3253/groq-backbone"
  }
}
```

## Step dependencies (DAG)

Steps execute in dependency order. A step can reference the output of a previous step via `depends_on`. The executor performs a topological sort to resolve the correct execution order.

```
step "scan" (image_process) ──→ step "analyze" (inference)
                                       │
                                       ▼
                                step "map" (tile_render)
```

Circular dependencies are rejected with an error.

## Common patterns

### Inference only (current @hai behavior)

```json
{
  "steps": [{"id": "ask", "type": "inference", "messages": [...]}]
}
```

### AI + Map (the killer combo)

```json
{
  "steps": [
    {"id": "think", "type": "inference", "messages": [...]},
    {"id": "show",  "type": "tile_render", "depends_on": "think",
     "center_cell": "871e9a0ecffffff", "zoom": 15, "style": "osm-bright"}
  ]
}
```

### Satellite + AI + Map (agricultural monitoring)

```json
{
  "steps": [
    {"id": "scan",    "type": "image_process", "operation": "ndvi",
     "context": {"h3_cell": "871e9a0ecffffff"}},
    {"id": "analyze", "type": "inference", "depends_on": "scan",
     "messages": [{"role": "user", "content": "Analyze this NDVI data"}]},
    {"id": "map",     "type": "tile_render", "depends_on": "analyze",
     "center_cell": "871e9a0ecffffff", "zoom": 14, "style": "satellite"}
  ]
}
```

**Tested result:** 1.9 seconds, 0.0011 GNS, one Merkle proof covering all three steps.

## Pricing

| Step Type | Unit | Price (GNS) |
|-----------|------|-------------|
| Inference (Hive worker, LFM2.5) | Per token | 0.00001 |
| Inference (Groq backbone) | Per token | 0 (subsidized) |
| Tile render (cache hit) | Per tile | 0.00001 |
| Tile render (cache miss) | Per tile | 0.0001 |
| Image processing | Per megapixel | 0.001 |
| Sensor fusion | Per cell-epoch | 0.0005 |

Compound job cost = sum of step costs. One Stellar settlement per job.

## Other endpoints

### GET /v1/compute/:jobId

Retrieve a completed job by ID.

### GET /v1/compute/recent?limit=50

List recent compute jobs (for dashboard).
