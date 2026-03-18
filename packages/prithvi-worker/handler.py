"""
GEIANT Perception Layer — RunPod Serverless Worker v3
Tasks:
  classify  -> Prithvi-EO-2.0 flood classification (NDWI fallback)
  embed     -> Clay v1.5 spatial embeddings (1024-dim)
"""

import os, traceback
import numpy as np
import runpod

PRITHVI_MODEL = None
CLAY_MODEL    = None

PRITHVI_ID = "ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL-Sen1Floods11"
CLAY_ID    = "made-with-clay/Clay"

def load_prithvi():
    global PRITHVI_MODEL
    if PRITHVI_MODEL is not None:
        return PRITHVI_MODEL
    import torch
    try:
        from terratorch.cli_tools import LightningInferenceModel
        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"Loading Prithvi via TerraTorch on {device}...")
        PRITHVI_MODEL = LightningInferenceModel.from_config(model_name=PRITHVI_ID, device=device)
        print("Prithvi loaded")
    except Exception as e:
        print(f"TerraTorch failed ({e}), using NDWI fallback")
        PRITHVI_MODEL = "ndwi_fallback"
    return PRITHVI_MODEL

def load_clay():
    global CLAY_MODEL
    if CLAY_MODEL is not None:
        return CLAY_MODEL
    import torch
    import os as _os; _os.chdir("/app/clay_repo")
    from claymodel.module import ClayMAEModule
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loading Clay v1.5 on {device}...")
    ckpt_path = "/app/hf_cache/v1.5/clay-v1.5.ckpt"
    if not os.path.exists(ckpt_path):
        from huggingface_hub import hf_hub_download
        ckpt_path = hf_hub_download(
            repo_id="made-with-clay/Clay",
            filename="v1.5/clay-v1.5.ckpt",
            cache_dir="/app/hf_cache"
        )
    CLAY_MODEL = ClayMAEModule.load_from_checkpoint(ckpt_path, map_location=device, strict=False)
    CLAY_MODEL.eval()
    CLAY_MODEL.to(device)
    print("Clay v1.5 loaded")
    return CLAY_MODEL

def fetch_band_chip(url, bbox, chip_size=256):
    import rasterio
    from rasterio.windows import from_bounds
    from rasterio.enums import Resampling
    from rasterio.crs import CRS
    from rasterio.warp import transform_bounds
    with rasterio.open(url) as src:
        # Reproject bbox from WGS84 to tile native CRS
        src_crs = CRS.from_epsg(4326)
        if src.crs and src.crs != src_crs:
            west, south, east, north = transform_bounds(
                src_crs, src.crs,
                bbox["west"], bbox["south"], bbox["east"], bbox["north"]
            )
        else:
            west, south, east, north = bbox["west"], bbox["south"], bbox["east"], bbox["north"]
        window = from_bounds(west, south, east, north, transform=src.transform)
        data = src.read(1, window=window, out_shape=(chip_size, chip_size), resampling=Resampling.bilinear)
    return data.astype(np.float32)

def fetch_all_bands(bands, bbox, chip_size):
    band_order = ["B02", "B03", "B04", "B8A", "B11", "B12"]
    chips = []
    for b in band_order:
        url = bands.get(b)
        if not url:
            raise ValueError(f"Missing band URL for {b}")
        print(f"  Fetching {b}...")
        chips.append(fetch_band_chip(url, bbox, chip_size))
    return np.stack(chips, axis=0)

def ndwi_classification(band_stack):
    green, nir = band_stack[1], band_stack[3]
    denom = green + nir
    ndwi = np.where(denom > 0, (green - nir) / denom, 0)
    flood_mask = (ndwi > 0.3).astype(np.int32)
    h, w = band_stack.shape[1], band_stack.shape[2]
    total = h * w
    flood_count    = int(np.sum(flood_mask == 1))
    no_flood_count = total - flood_count
    flood_pct      = (flood_count / total * 100) if total > 0 else 0.0
    confidence     = float(np.mean(np.abs(ndwi)))
    dominant       = "flood" if flood_pct > 5.0 else "no_flood"
    return {
        "dominant_class":  dominant,
        "flood_pixel_pct": round(flood_pct, 2),
        "confidence":      round(min(confidence * 2, 1.0), 4),
        "mask_shape":      [h, w],
        "class_counts":    {"no_flood": no_flood_count, "flood": flood_count, "cloud_nodata": 0},
        "model_id":        PRITHVI_ID + " (NDWI-fallback)",
        "model_version":   "1.0.0",
    }

def run_classify(band_stack, conf_threshold=0.5):
    import torch
    model = load_prithvi()
    if model == "ndwi_fallback" or model is None:
        return ndwi_classification(band_stack / 10000.0)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    h, w = band_stack.shape[1], band_stack.shape[2]
    normalized = np.clip(band_stack / 10000.0, 0, 1)
    tensor = torch.from_numpy(normalized).unsqueeze(0).unsqueeze(0).float().to(device)
    with torch.no_grad():
        output = model.predict(tensor)
    logits = (output.get("output", output.get("logits", list(output.values())[0]))
              if isinstance(output, dict) else output)
    if isinstance(logits, torch.Tensor):
        probs = torch.softmax(logits, dim=1).cpu().numpy()[0]
    else:
        probs = np.array(logits)
    mask       = np.argmax(probs, axis=0)
    confidence = float(np.mean(np.max(probs, axis=0)))
    no_flood   = int(np.sum(mask == 0))
    flood      = int(np.sum(mask == 1))
    cloud      = int(np.sum(mask >= 2)) if probs.shape[0] > 2 else 0
    total      = h * w
    flood_pct  = (flood / total * 100) if total > 0 else 0.0
    counts     = {"no_flood": no_flood, "flood": flood, "cloud_nodata": cloud}
    dominant   = max(counts, key=counts.get)
    return {
        "dominant_class":  dominant,
        "flood_pixel_pct": round(flood_pct, 2),
        "confidence":      round(confidence, 4),
        "mask_shape":      [h, w],
        "class_counts":    counts,
        "model_id":        PRITHVI_ID,
        "model_version":   "1.0.0",
    }

def run_embed(band_stack, metadata_in):
    import torch, yaml
    model = load_clay()
    device = next(model.parameters()).device

    lat  = float(metadata_in.get("lat", 0.0))
    lon  = float(metadata_in.get("lon", 0.0))
    timestamp = metadata_in.get("timestamp", "2026-01-01T00:00:00Z")

    # Load Clay sensor metadata for normalization + wavelengths
    with open("/app/clay_repo/configs/metadata.yaml") as f:
        meta = yaml.safe_load(f)
    sensor = "sentinel-2-l2a"
    # Clay sentinel-2-l2a uses 10 bands — we only have 6 (B02,B03,B04,B8A,B11,B12)
    # Use only the 6 bands we have, get their wavelengths + norm stats
    our_bands = ["blue", "green", "red", "nir08", "swir16", "swir22"]
    smeta = meta[sensor]["bands"]
    means = np.array([smeta["mean"][b] for b in our_bands], dtype=np.float32)
    stds  = np.array([smeta["std"][b]  for b in our_bands], dtype=np.float32)
    waves = np.array([smeta["wavelength"][b] * 1000 for b in our_bands], dtype=np.float32)

    # Normalize using Clay stats
    norm = (band_stack - means[:,None,None]) / stds[:,None,None]
    chips = torch.from_numpy(norm).unsqueeze(0).float().to(device)  # (1,6,H,W)

    from datetime import datetime
    try:
        dt   = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        week = dt.isocalendar()[1]
        hour = dt.hour
    except Exception:
        week, hour = 1, 0

    # timestamps: [week, hour, lat, lon]
    timestamps  = torch.tensor([[week, hour, lat, lon]], dtype=torch.float32).to(device)
    wavelengths = torch.tensor([waves.tolist()], dtype=torch.float32).to(device)

    with torch.no_grad():
        embedding = model.encoder(chips, timestamps, wavelengths)
    emb = embedding.squeeze(0).cpu().numpy()
    return {
        "embedding":      emb.tolist(),
        "embedding_dim":  int(emb.shape[0]),
        "embedding_norm": float(np.linalg.norm(emb)),
        "model_id":       CLAY_ID,
        "model_version":  "1.5.0",
        "input_shape":    list(band_stack.shape),
        "lat":            lat,
        "lon":            lon,
        "timestamp":      timestamp,
    }

def handler(job):
    inp = {}
    try:
        inp       = job.get("input", {})
        task      = inp.get("task", "classify")
        bands     = inp.get("bands")
        bbox      = inp.get("bbox")
        chip_size = inp.get("chip_size", 512 if task == "classify" else 256)
        conf      = inp.get("confidence_threshold", 0.5)
        meta      = inp.get("metadata", {})
        if not bands or not bbox:
            return {"error": "Missing 'bands' and 'bbox'"}
        print(f"Task: {task}, chip_size={chip_size}")
        stack = fetch_all_bands(bands, bbox, chip_size)
        print(f"Stack shape: {stack.shape}")
        if task == "embed":
            result = run_embed(stack, meta)
            print(f"Embedding: dim={result['embedding_dim']}, norm={result['embedding_norm']:.4f}")
        else:
            result = run_classify(stack, conf)
            print(f"Classify: {result['dominant_class']} ({result['flood_pixel_pct']}% flood)")
        return result
    except Exception as e:
        traceback.print_exc()
        return {"error": str(e), "task": inp.get("task", "classify")}

runpod.serverless.start({"handler": handler})
