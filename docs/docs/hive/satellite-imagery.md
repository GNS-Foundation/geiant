---
sidebar_position: 5
---

# Satellite Imagery Processing

Satellite imagery processing is the third compute type on Hive. It integrates with Element84 Earth Search (STAC API) for Sentinel-2 L2A scene discovery — free, anonymous, no API key required — and exposes IBM's Prithvi Earth Observation foundation model as a callable MCP tool for higher-order analysis.

## Endpoints

### Search scenes

```
GET /v1/imagery/scenes?cell={h3_cell}&from={date}&to={date}&cloud={max%}&limit={n}
```

```bash
curl "https://gns-browser-production.up.railway.app/v1/imagery/scenes?cell=871e9a0ecffffff"
```

Returns recent Sentinel-2 scenes with cloud cover, thumbnails, and band URLs.

### NDVI calculation

```
GET /v1/imagery/ndvi?cell={h3_cell}&from={date}&to={date}
```

```bash
curl "https://gns-browser-production.up.railway.app/v1/imagery/ndvi?cell=871e9a0ecffffff"
```

**Response:**

```json
{
  "sceneId": "S2A_33TTG_20260406_0_L2A",
  "datetime": "2026-04-06T10:09:32.136000Z",
  "h3Cell": "871e9a0ecffffff",
  "meanNdvi": 0.46,
  "minNdvi": 0.31,
  "maxNdvi": 0.61,
  "healthStatus": "moderate",
  "cloudCover": 13.49,
  "description": "Moderate vegetation health. Some areas may need attention.",
  "processingMs": 336
}
```

A request without the `cell` parameter returns input validation:

```bash
$ curl https://gns-browser-production.up.railway.app/v1/imagery/ndvi
{"error":"cell parameter required"}
```

### Generic processing

```
POST /v1/imagery/process
```

```json
{
  "operation": "ndvi",
  "h3_cell": "871e9a0ecffffff",
  "date_from": "2026-03-01",
  "date_to": "2026-04-08"
}
```

## Earth Observation foundation models

The MCP-callable Earth Observation surface is exposed via the **GEIANT Perception MCP server**, listed in the public PulseMCP directory at [pulsemcp.com/servers/geiant-agentcore](https://www.pulsemcp.com/servers/geiant-agentcore). MCP-aware clients (Claude Desktop, Cursor, …) can invoke the tools directly.

| Model | Tool | Status |
|-------|------|--------|
| **IBM Prithvi-EO-2.0** (`Prithvi-EO-2.0-300M-TL-Sen1Floods11`) | `perception_classify` | **Live** — callable from Claude Desktop today |
| **Microsoft Clay v1.5** | `perception_embed` | Roadmap (see [Roadmap §12.4](/hive/roadmap)) |

Prithvi-EO-2.0 is a transformer-based geospatial foundation model trained on harmonized Sentinel-2 and Landsat data, fine-tuned for downstream tasks including flood mapping. Microsoft Clay v1.5 will provide embeddings for downstream classification, regression, and similarity-search workflows over Sentinel-2 tiles.

## Operations

| Operation | Description | Current (v0.5.x) | Future (v0.6+) |
|-----------|-------------|-------------------|-------------------|
| `ndvi` | Vegetation health index | Metadata-based estimate from STAC | Pixel-level B04/B08 bands via Prithvi |
| `cloud_mask` | Cloud cover assessment | Scene metadata % | SCL band classification |
| `scene_search` | Find recent clear scenes | STAC API query | Same + local scene cache |
| `atmospheric_correction` | Remove atmospheric effects | L2A pre-corrected | Custom processing |
| `flood_classify` | Flood mask from Sentinel-2 | Prithvi via MCP (live) | Integrated step type |

The `flood_classify` operation is currently callable as an MCP tool today; integration as a first-class `image_process` step type in the Unified Compute API is on the v0.6 roadmap.

## NDVI health classification

| NDVI Range | Status | Description |
|------------|--------|-------------|
| ≥ 0.6 | **Healthy** | Dense, healthy vegetation. Strong canopy vigor. |
| 0.4–0.6 | **Moderate** | Moderate health. Some areas may need attention. |
| 0.2–0.4 | **Stressed** | Vegetation stress. Possible water deficit or disease. |
| < 0.2 | **Bare** | Minimal vegetation. Urban area or bare soil. |

## Compound jobs with imagery

The most powerful pattern combines satellite data with AI analysis and map visualization:

```json
{
  "steps": [
    {"id": "scan", "type": "image_process", "operation": "ndvi",
     "context": {"h3_cell": "871e9a0ecffffff"}},
    {"id": "analyze", "type": "inference", "depends_on": "scan",
     "messages": [{"role": "user", "content": "Analyze this NDVI data for olive grove health"}]},
    {"id": "map", "type": "tile_render", "depends_on": "analyze",
     "center_cell": "871e9a0ecffffff", "zoom": 14, "style": "satellite"}
  ]
}
```

**Tested result:** 1.9 seconds total, 0.0011 GNS, one cryptographic proof.

## Data source

Sentinel-2 L2A scenes via [Element84 Earth Search](https://earth-search.aws.element84.com/v1) STAC API. Free access, no API key required. Scenes updated every 5 days per location, 10m resolution.

For pixel-level downstream tasks (flood mapping, burn-scar segmentation, crop classification), Prithvi-EO-2.0 provides the foundation model layer above the raw STAC scenes.
