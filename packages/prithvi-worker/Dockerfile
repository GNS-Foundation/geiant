FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgdal-dev gdal-bin git && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Clone Clay repo for configs/metadata.yaml (small — just source code)
RUN git clone --depth 1 https://github.com/Clay-foundation/model.git /app/clay_repo

# Models are downloaded at runtime on first job (NOT baked in)
# This keeps the image small (~3GB vs ~10GB)

ENV HF_HOME=/app/hf_cache
ENV TRANSFORMERS_CACHE=/app/hf_cache

COPY handler.py .
CMD ["python", "-u", "handler.py"]
