"""
GEIANT Perception Layer — Prithvi-EO-2.0 RunPod Serverless Worker
Receives 6-band Sentinel-2 COG URLs from mcp-perception,
runs flood classification, returns structured JSON.
"""

import os, io, traceback
import numpy as np
import runpod

MODEL = None
MODEL_ID = "ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL-Sen1Floods11"
MODEL_VERSION = "1.0.0"

def load_model():
    global MODEL
    if MODEL is not None:
        return MODEL
    import torch
    try:
        from terratorch.cli_tools import LightningInferenceModel
        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"Loading {MODEL_ID} via TerraTorch on {device}...")
        MODEL = LightningInferenceModel.from_config(model_name=MODEL_ID, device=device)
        print("Model loaded successfully")
    except Exception as e:
        print(f"TerraTorch failed ({e}), using NDWI fallback")
        MODEL = "ndwi_fallback"
    return MODEL

def fetch_band_chip(url, bbox, chip_size=512):
    import rasterio
    from rasterio.windows import from_bounds
    from rasterio.enums import Resampling
    with rasterio.open(url) as src:
        window = from_bounds(bbox["west"], bbox["south"], bbox["east"], bbox["north"], transform=src.transform)
        data = src.read(1, window=window, out_shape=(chip_size, chip_size), resampling=Resampling.bilinear)
    return data.astype(np.float32)

def fetch_all_bands(bands, bbox, chip_size=512):
    band_order = ["B02", "B03", "B04", "B8A", "B11", "B12"]
    chips = []
    for b in band_order:
        url = bands.get(b)
        if not url: raise ValueError(f"Missing band URL for {b}")
        print(f"  Fetching {b}...")
        chips.append(fetch_band_chip(url, bbox, chip_size))
    return np.stack(chips, axis=0)

def ndwi_classification(band_stack, confidence_threshold):
    green, nir = band_stack[1], band_stack[3]
    denom = green + nir
    ndwi = np.where(denom > 0, (green - nir) / denom, 0)
    flood_mask = (ndwi > 0.3).astype(np.int32)
    h, w = band_stack.shape[1], band_stack.shape[2]
    total = h * w
    flood_count = int(np.sum(flood_mask == 1))
    no_flood_count = total - flood_count
    flood_pct = (flood_count / total * 100) if total > 0 else 0.0
    confidence = float(np.mean(np.abs(ndwi)))
    dominant = "flood" if flood_pct > 5.0 else "no_flood"
    return {
        "dominant_class": dominant,
        "flood_pixel_pct": round(flood_pct, 2),
        "confidence": round(min(confidence * 2, 1.0), 4),
        "mask_shape": [h, w],
        "class_counts": {"no_flood": no_flood_count, "flood": flood_count, "cloud_nodata": 0},
        "model_id": MODEL_ID + " (NDWI-fallback)",
        "model_version": MODEL_VERSION,
    }

def run_inference(band_stack, confidence_threshold=0.5):
    import torch
    if MODEL == "ndwi_fallback" or MODEL is None:
        return ndwi_classification(band_stack / 10000.0, confidence_threshold)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    h, w = band_stack.shape[1], band_stack.shape[2]
    normalized = np.clip(band_stack / 10000.0, 0, 1)
    tensor = torch.from_numpy(normalized).unsqueeze(0).unsqueeze(0).float().to(device)
    with torch.no_grad():
        output = MODEL.predict(tensor)
    logits = output.get("output", output.get("logits", list(output.values())[0])) if isinstance(output, dict) else output
    if isinstance(logits, torch.Tensor):
        probs = torch.softmax(logits, dim=1).cpu().numpy()[0]
    else:
        probs = np.array(logits)
    mask = np.argmax(probs, axis=0)
    max_probs = np.max(probs, axis=0)
    confidence = float(np.mean(max_probs))
    no_flood_count = int(np.sum(mask == 0))
    flood_count = int(np.sum(mask == 1))
    cloud_count = int(np.sum(mask >= 2)) if probs.shape[0] > 2 else 0
    total = h * w
    flood_pct = (flood_count / total * 100) if total > 0 else 0.0
    counts = {"no_flood": no_flood_count, "flood": flood_count, "cloud_nodata": cloud_count}
    dominant = max(counts, key=counts.get)
    return {
        "dominant_class": dominant, "flood_pixel_pct": round(flood_pct, 2),
        "confidence": round(confidence, 4), "mask_shape": [h, w],
        "class_counts": counts, "model_id": MODEL_ID, "model_version": MODEL_VERSION,
    }

def handler(job):
    try:
        inp = job.get("input", {})
        bands, bbox = inp.get("bands"), inp.get("bbox")
        chip_size = inp.get("chip_size", 512)
        conf = inp.get("confidence_threshold", 0.5)
        if not bands or not bbox:
            return {"error": "Missing 'bands' and 'bbox'", "dominant_class": "no_flood",
                    "flood_pixel_pct": 0, "confidence": 0, "mask_shape": [0,0],
                    "class_counts": {"no_flood":0,"flood":0,"cloud_nodata":0},
                    "model_id": MODEL_ID, "model_version": MODEL_VERSION}
        load_model()
        print(f"Fetching 6 bands, chip_size={chip_size}...")
        stack = fetch_all_bands(bands, bbox, chip_size)
        print(f"  Stack shape: {stack.shape}")
        result = run_inference(stack, conf)
        print(f"  Result: {result['dominant_class']} (flood {result['flood_pixel_pct']}%)")
        return result
    except Exception as e:
        traceback.print_exc()
        return {"error": str(e), "dominant_class": "no_flood", "flood_pixel_pct": 0,
                "confidence": 0, "mask_shape": [0,0],
                "class_counts": {"no_flood":0,"flood":0,"cloud_nodata":0},
                "model_id": MODEL_ID, "model_version": MODEL_VERSION}

runpod.serverless.start({"handler": handler})
