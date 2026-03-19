FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgdal-dev gdal-bin git && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Clone Clay repo — provides configs/metadata.yaml
RUN git clone --depth 1 https://github.com/Clay-foundation/model.git /app/clay_repo

# Pre-download model weights into clay_repo/hf_cache
# (run from clay_repo so relative paths resolve correctly)
WORKDIR /app/clay_repo
RUN python -c "\
from huggingface_hub import hf_hub_download; \
hf_hub_download(repo_id='made-with-clay/Clay', \
  filename='v1.5/clay-v1.5.ckpt', local_dir='hf_cache'); \
print('Clay v1.5 cached')"

ENV HF_HOME=/app/clay_repo/hf_cache
ENV TRANSFORMERS_CACHE=/app/clay_repo/hf_cache

COPY handler.py /app/clay_repo/handler.py
CMD ["python", "-u", "handler.py"]
