---
sidebar_position: 3
---

# Tile Rendering

Map tile rendering is the second compute type on Hive. The tile service is MapLibre GL JS and flutter_map compatible — swap one URL and any mapping application runs on Hive tiles.

## Tile API

```
GET /v1/tiles/{h3_cell}/{zoom}/{style}.{format}
```

### Examples

```bash
# OSM bright style, Rome, zoom 15
curl -o tile.png https://gns-browser-production.up.railway.app/v1/tiles/871e9a0ecffffff/15/osm-bright.png

# Dark mode
curl -o dark.png https://gns-browser-production.up.railway.app/v1/tiles/871e9a0ecffffff/15/dark.png

# Satellite imagery
curl -o sat.png https://gns-browser-production.up.railway.app/v1/tiles/871e9a0ecffffff/14/satellite.png
```

### Available styles

| Style | Source | API Key Required |
|-------|--------|-----------------|
| `osm-bright` | OpenStreetMap | No |
| `osm-standard` | OpenStreetMap | No |
| `dark` | CartoDB Dark Matter | No |
| `terrain` | Stadia/Stamen | No |
| `satellite` | ESRI World Imagery | No |

### Response headers

Every tile response includes Hive provenance headers:

| Header | Description |
|--------|-------------|
| `X-Hive-Worker` | Worker public key or `tile-proxy` |
| `X-Hive-Cell` | H3 cell of the computation |
| `X-Hive-Epoch` | GNS epoch number |
| `X-Hive-Proof` | SHA-256 hash of the tile data |
| `X-Hive-Cache` | `HIT` or `MISS` |
| `X-Hive-Cost` | Cost in GNS (0.00001 hit, 0.0001 miss) |

## Cache strategy

MobyDB is the cache. The composite key `(H3 Cell, Epoch, Style, Zoom)` IS the cache key.

- **Cache hit:** serve from memory, <1ms, 0.00001 GNS
- **Cache miss:** proxy from upstream, cache locally, serve to requester, 0.0001 GNS
- **Epoch invalidation:** tiles refresh when the epoch advances and source data has changed

## MapLibre GL JS integration

```javascript
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      'hive-tiles': {
        type: 'raster',
        tiles: ['https://gns-browser-production.up.railway.app/v1/tiles/871e9a0ecffffff/{z}/osm-bright.png'],
        tileSize: 256,
      }
    },
    layers: [{
      id: 'hive-layer',
      type: 'raster',
      source: 'hive-tiles',
    }]
  }
});
```

## flutter_map integration

```dart
TileLayer(
  urlTemplate: 'https://gns-browser-production.up.railway.app/v1/tiles/871e9a0ecffffff/{z}/osm-bright.png',
)
```

## Compound jobs with tiles

Tiles can be part of a compound compute job. The inference step finds locations; the tile step renders the map:

```json
{
  "steps": [
    {"id": "think", "type": "inference", "messages": [...]},
    {"id": "show",  "type": "tile_render", "depends_on": "think",
     "center_cell": "871e9a0ecffffff", "zoom": 15, "style": "osm-bright"}
  ]
}
```

The tile step reads `locations` from the inference output and generates annotation metadata.

## Competitive pricing

| Provider | Cost per 1,000 tiles | Provenance | Data Sovereignty |
|----------|---------------------|------------|-----------------|
| Mapbox | $0.60–$5.00 | None | No |
| Google Maps | $7.00 | None | No |
| **Hive Maps** | **$0.10** | Merkle proof per tile | Yes (H3 cell binding) |

## Tile grid endpoint

```
GET /v1/tiles/grid/{cell}/{zoom}/{style}?rings=1
```

Returns a JSON array of tile URLs covering the cell and surrounding rings.

## Tile stats

```
GET /v1/tiles/stats?hours=24
```

Returns hourly aggregated tile serving statistics.
