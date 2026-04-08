---
sidebar_position: 2
---

# Unified Compute API

Every Hive job goes through one endpoint. The `steps` array defines what needs to happen. Steps can reference outputs of previous steps via `depends_on`.

**Endpoint:** `POST /v1/compute`

## Request format

```json
{
  "requester_pk": "<Ed25519 public key>",
  "h3_cell": "871e9a0ecffffff",
  "steps": [
    {
      "id": "ask",
      "type": "inference",
      "model": "llama-3.3-70b-versatile",
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
| `signature` | string | No | Ed25519 signature for authenticated requests |

### Step fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique step identifier |
| `type` | string | Yes | `inference`, `tile_render`, `image_process`, `sensor_fusion` |
| `depends_on` | string | No | ID of a step whose output feeds into this one |
| `model` | string | No | Model for inference (default: `llama-3.3-70b-versatile`) |
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
  "epoch": 2337,
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
    "verify_url": "https://mobydb.com/proof/871e9a0ecffffff/2337/groq-backbone"
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
| Inference (Hive worker) | Per token | 0.00001 |
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
