---
sidebar_position: 6
---

# API Reference

## Unified Compute

The primary Hive API. All compute types go through one endpoint.

### POST /v1/compute

Submit a compute job with one or more steps.

→ [Full documentation](/hive/unified-compute)

```bash
curl -X POST https://gns-browser-production.up.railway.app/v1/compute \
  -H "Content-Type: application/json" \
  -d '{"requester_pk":"YOUR_PK","h3_cell":"871e9a0ecffffff","steps":[{"id":"ask","type":"inference","messages":[{"role":"user","content":"Hello"}]}]}'
```

### GET /v1/compute/:jobId

Retrieve a completed job by ID.

### GET /v1/compute/recent?limit=50

List recent compute jobs.

---

## Tile Rendering

MapLibre GL JS and flutter_map compatible. No API key required.

→ [Full documentation](/hive/tile-rendering)

### GET /v1/tiles/{h3_cell}/{zoom}/{style}.{format}

Serve a map tile. Styles: `osm-bright`, `dark`, `satellite`, `terrain`, `osm-standard`.

```bash
curl -o tile.png https://gns-browser-production.up.railway.app/v1/tiles/871e9a0ecffffff/15/osm-bright.png
```

### GET /v1/tiles/grid/{cell}/{zoom}/{style}?rings=1

JSON grid of tile URLs for a cell and surrounding rings.

### GET /v1/tiles/stats?hours=24

Hourly tile serving statistics.

---

## Satellite Imagery

Sentinel-2 L2A via Element84 Earth Search. Free, no API key.

→ [Full documentation](/hive/satellite-imagery)

### GET /v1/imagery/scenes?cell={h3}&from={date}&to={date}&cloud={%}&limit={n}

Search recent Sentinel-2 scenes.

### GET /v1/imagery/ndvi?cell={h3}&from={date}&to={date}

Calculate NDVI for an H3 cell.

```bash
curl "https://gns-browser-production.up.railway.app/v1/imagery/ndvi?cell=871e9a0ecffffff"
```

### POST /v1/imagery/process

Run a named operation (ndvi, cloud_mask, scene_search, atmospheric_correction).

---

## MobyDB (Proof Layer)

→ [Full documentation](/hive/mobydb)

### POST /mobydb/sync

Workers push local records to central storage.

### POST /mobydb/epochs

Workers push epoch seals.

### GET /mobydb/query?cell={h3}&epoch_start={n}&epoch_end={n}&collection={type}&limit={n}

Query records across all workers.

### GET /mobydb/proof/{record_id}

Verify a record's Merkle proof. Returns record, epoch seal, and verification status.

---

## Inference Audit Trail

### GET /hive/inference/recent?limit=50

Recent inference audit logs.

### GET /hive/inference/stats?hours=24

Hourly aggregated inference statistics.

---

## OpenAI-Compatible (Legacy)

These endpoints remain available for backward compatibility.

### POST /v1/chat/completions

Standard OpenAI-compatible chat completion. Drop-in replacement.

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_HIVE_API_KEY",
    base_url="https://hive.geiant.com/v1",
)

response = client.chat.completions.create(
    model="phi-3-mini",
    messages=[{"role": "user", "content": "Hello"}],
)
```

### GET /v1/models

List available models in the swarm.

---

## Jurisdiction Headers

Optional headers for geographic enforcement on any request:

| Header | Description |
|--------|-------------|
| `x-hive-jurisdiction` | Restrict to workers in this jurisdiction (EU, US, IT) |
| `x-hive-h3-cell` | Target a specific H3 cell |
| `x-hive-min-tier` | Minimum worker trust tier |
| `x-hive-delegation-cert` | Base64 delegation certificate |

---

## Pricing

| Compute Type | Unit | Price (GNS) |
|-------------|------|-------------|
| Inference (Hive) | Per token | 0.00001 |
| Inference (Groq) | Per token | 0 (subsidized) |
| Tile (cache hit) | Per tile | 0.00001 |
| Tile (cache miss) | Per tile | 0.0001 |
| Image processing | Per megapixel | 0.001 |
| Sensor fusion | Per cell-epoch | 0.0005 |
| Merkle proof | Per proof | 0.0001 |

### Subscription tiers

| Tier | Price | Inference | Tiles | Imagery |
|------|-------|-----------|-------|---------|
| **Free** (GCRUMBS) | $0 | 50 msg/day @hai | Shared cache | — |
| **Hive Pro** | $29/mo | Unlimited | Unlimited, custom styles | 100 scenes/mo |
| **Hive Enterprise** | €490–1,490/mo | Private workers, SLA | Private tile server | Unlimited |
| **Hive Maps API** | Usage-based | — | Pay-per-tile | — |

---

## Error codes

| HTTP | Code | Meaning |
|------|------|---------|
| 400 | `invalid_model` | Model not available |
| 400 | `invalid_cell` | Malformed H3 cell |
| 401 | `unauthorized` | Missing or invalid API key |
| 503 | `no_workers` | No eligible workers. Retry or remove jurisdiction constraint |
| 504 | `job_timeout` | Job not completed within timeout |
