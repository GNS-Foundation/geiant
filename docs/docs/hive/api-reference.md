---
sidebar_position: 5
title: API Reference
---

# Hive API Reference

The GEIANT Hive API is OpenAI-compatible. Any application using the OpenAI SDK can switch to Hive by changing the base URL and adding optional jurisdiction headers.

**Base URL:** `https://hive.geiant.com/v1`

**Authentication:** `Authorization: Bearer YOUR_API_KEY`

Get an API key from the [Hive Console](https://hive.geiant.com/console).

## OpenAI-compatible endpoints

### POST /v1/chat/completions

Standard chat completion. Drop-in replacement for `openai.chat.completions.create`.

**Request:**

```json
{
  "model": "tinyllama",
  "messages": [
    {"role": "user", "content": "Explain H3 geospatial indexing in one paragraph."}
  ],
  "max_tokens": 150,
  "temperature": 0.7,
  "stream": false
}
```

**Response:**

```json
{
  "id": "hive-800ff8e0",
  "object": "chat.completion",
  "model": "tinyllama",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "H3 is a hierarchical hexagonal geospatial indexing system..."
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 18,
    "completion_tokens": 47,
    "total_tokens": 65
  }
}
```

**Available models:**

| Model ID | Parameters | Size | Notes |
|----------|-----------|------|-------|
| `tinyllama` | 1.1B | 635 MB | Fast. Good for testing and simple tasks. |
| `phi-3-mini` | 3.8B | 2.3 GB | Good quality/speed balance. |
| `gemma-2-2b` | 2B | 1.6 GB | Google Gemma-2 instruction-tuned. |

### GET /v1/models

List available models in the swarm.

```bash
curl https://hive.geiant.com/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## Jurisdiction headers {#jurisdiction-headers}

These are Hive-specific headers that add geographic enforcement to any inference call. They are optional — without them, the scheduler selects the nearest available worker.

| Header | Type | Description |
|--------|------|-------------|
| `x-hive-jurisdiction` | string | Restrict inference to workers in this jurisdiction. E.g. `EU`, `US`, `IT`. |
| `x-hive-h3-cell` | string | Target a specific H3 cell (e.g. `861e8050fffffff`). Overrides jurisdiction. |
| `x-hive-min-tier` | string | Minimum worker trust tier: `seedling`, `explorer`, `navigator`, `trailblazer`, `sovereign`. |
| `x-hive-delegation-cert` | string | Base64-encoded delegation certificate for agent-authenticated requests. |

**Example — GDPR-compliant EU inference:**

```bash
curl -X POST https://hive.geiant.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "x-hive-jurisdiction: EU" \
  -H "x-hive-min-tier: trusted" \
  -d '{
    "model": "phi-3-mini",
    "messages": [{"role": "user", "content": "Summarise this patient record: ..."}],
    "max_tokens": 200
  }'
```

The scheduler will only route this job to workers registered in EEA H3 cells with trust tier ≥ `trusted`. If no eligible workers are available, the request returns HTTP 503.

**Example — OpenAI Python SDK, one line change:**

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_HIVE_API_KEY",
    base_url="https://hive.geiant.com/v1",  # ← only change
)

response = client.chat.completions.create(
    model="phi-3-mini",
    messages=[{"role": "user", "content": "Hello"}],
    extra_headers={
        "x-hive-jurisdiction": "EU",  # optional
    }
)
```

---

## Hive-specific endpoints

### POST /hive/jobs

Submit an inference job directly to the job queue. Useful for batch workloads or when you want more control over routing than the chat completions endpoint provides.

**Request:**

```json
{
  "h3_cell": "861e8050fffffff",
  "model_id": "tinyllama",
  "prompt": "What is decentralized AI inference?",
  "max_tokens": 60,
  "temperature": 0.7,
  "gns_reward": 0.01,
  "jurisdiction": "EU",
  "min_trust_tier": "observed"
}
```

**Response:**

```json
{
  "job_id": "800ff8e0-19dc-4072-9a85-daf7d003e5c6",
  "status": "pending",
  "h3_cell": "861e8050fffffff",
  "created_at": "2026-03-28T10:57:36.000Z"
}
```

### GET /hive/jobs/:id

Poll for job completion.

```bash
curl https://hive.geiant.com/hive/jobs/800ff8e0-19dc-4072-9a85-daf7d003e5c6 \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Response when completed:**

```json
{
  "id": "800ff8e0-19dc-4072-9a85-daf7d003e5c6",
  "status": "completed",
  "result_text": "Decentralized AI inference is a type of AI that uses multiple, decentralized servers...",
  "tokens_generated": 47,
  "tokens_per_second": 244.3,
  "worker_pk": "4d7f2ba9...",
  "settled": true,
  "stellar_tx_hash": "34b02ac18a923bcf050e4177b8c5accc87abbb0674ba6cc3a6b4b6807dff56dd",
  "completed_at": "2026-03-28T10:57:38.000Z"
}
```

Job `status` values: `pending` → `assigned` → `computing` → `completed` / `failed` / `timed_out`.

### GET /hive/status

Live swarm status. No authentication required.

```bash
curl https://hive.geiant.com/hive/status
```

**Response:**

```json
{
  "active_nodes": 3,
  "total_tflops": 12.8,
  "computing_nodes": 1,
  "avg_ram_gb": 16.0,
  "active_h3_cells": 2,
  "total_tokens_distributed": 0.42
}
```

---

## Error codes

| HTTP | Code | Meaning |
|------|------|---------|
| 400 | `invalid_model` | Model not available in the swarm. |
| 400 | `invalid_cell` | H3 cell string is malformed. |
| 401 | `unauthorized` | Missing or invalid API key. |
| 503 | `no_workers` | No eligible workers in the target cell/jurisdiction. Retry with a wider H3 resolution or remove jurisdiction constraint. |
| 504 | `job_timeout` | Job was claimed but not completed within the timeout (5 minutes default). |

---

## Rate limits

| Plan | Requests/min | Concurrent jobs |
|------|-------------|-----------------|
| Free (GCRUMBS) | 50 messages/day | 1 |
| Hive Pro ($29/mo) | 120 req/min | 10 |
| Enterprise | Custom SLA | Unlimited |
