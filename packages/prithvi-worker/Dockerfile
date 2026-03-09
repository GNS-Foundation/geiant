FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgdal-dev gdal-bin && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL-Sen1Floods11', cache_dir='/app/hf_cache'); snapshot_download('ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL', cache_dir='/app/hf_cache', allow_patterns=['prithvi_mae.py','config.json']); print('Models cached')"
ENV HF_HOME=/app/hf_cache
ENV TRANSFORMERS_CACHE=/app/hf_cache
COPY handler.py .
CMD ["python", "-u", "handler.py"]
