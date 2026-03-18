FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgdal-dev gdal-bin git && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download Prithvi weights
RUN python -c "\
from huggingface_hub import snapshot_download; \
snapshot_download('ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL-Sen1Floods11', cache_dir='/app/hf_cache'); \
snapshot_download('ibm-nasa-geospatial/Prithvi-EO-2.0-300M-TL', cache_dir='/app/hf_cache', \
  allow_patterns=['prithvi_mae.py','config.json']); \
print('Prithvi cached')"

# Pre-download Clay v1.5 weights
RUN python -c "\
from huggingface_hub import hf_hub_download; \
hf_hub_download(repo_id='made-with-clay/Clay', \
  filename='v1.5/clay-v1.5.ckpt', local_dir='/app/hf_cache'); \
print('Clay v1.5 cached')"

ENV HF_HOME=/app/hf_cache
ENV TRANSFORMERS_CACHE=/app/hf_cache

COPY handler.py .
CMD ["python", "-u", "handler.py"]
