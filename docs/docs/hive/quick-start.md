---
sidebar_position: 2
title: Quick Start
---

# Hive Quick Start

Join the GEIANT Hive swarm and execute your first inference job in under 5 minutes.

## Prerequisites

- Node.js 18+
- macOS or Linux (Windows: WSL2)
- `llama-completion` binary for inference participation (optional — you can join as observer without it)

## 1. Join the swarm

```bash
npx @gns-foundation/hive-worker join
```

On first run this:
1. Generates an Ed25519 keypair and stores it at `~/.hive/identity.json` (mode 600)
2. Detects your hardware: CPU, GPU, RAM, estimated TFLOPS
3. Resolves your location to an H3 Resolution-6 cell via IP geolocation
4. Registers your device in the swarm registry (Supabase)
5. Starts a heartbeat every 30 seconds
6. Polls for inference jobs every 5 seconds

You'll see a live status dashboard in your terminal.

## 2. Set your GNS handle (optional)

```bash
npx @gns-foundation/hive-worker join --handle @yourname
```

The handle is your public identity in the swarm. It must match a registered GNS handle.

## 3. Skip the RPC server (recommended for first run)

```bash
npx @gns-foundation/hive-worker join --skip-rpc
```

The RPC server enables future pipeline/shard mode across multiple devices. For solo inference jobs it is not needed.

## 4. Fetch a model

To execute inference jobs (and earn GNS), you need at least one model cached locally:

```bash
# TinyLlama — 635 MB, good for testing
npx @gns-foundation/hive-worker models fetch tinyllama

# Phi-3-mini — 2.3 GB, better quality
npx @gns-foundation/hive-worker models fetch phi-3-mini
```

Models are stored at `~/.hive/models/`.

## 5. Submit a test job

While your worker is running, submit a job from another terminal or directly via the Supabase SQL editor:

```sql
INSERT INTO hive_jobs (h3_cell, model_id, prompt, max_tokens, gns_reward, submitter_pk)
VALUES (
  '861e8050fffffff',       -- your H3 cell (shown in worker dashboard)
  'tinyllama',
  'What is decentralized AI inference? Answer in one sentence.',
  60,
  0.01,
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
);
```

Within 5 seconds your worker will claim it, execute it, and post the result back. The dashboard log will show:

```
◉ COMPUTING
› Job claimed: xxxxxxxx · model=tinyllama · 60 tokens
● IDLE
✦ Earned: 0.0060 GNS
```

## 6. Check your balance

```bash
npx @gns-foundation/hive-worker status
```

## Verify the result

```sql
SELECT id, status, result_text, tokens_per_second, settled
FROM hive_jobs
ORDER BY created_at DESC
LIMIT 1;
```

`status = completed`, `result_text` contains the model's response, `settled = true` means GNS was credited.

## Using the API instead

If you want to submit jobs programmatically rather than via SQL:

```bash
curl -X POST https://hive.geiant.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "tinyllama",
    "messages": [{"role": "user", "content": "What is H3?"}],
    "max_tokens": 60
  }'
```

See the [API Reference](./api-reference) for the full endpoint documentation.

## Next steps

- [Worker CLI reference](./worker-cli) — all commands and flags
- [H3 Resolution reference](./h3-resolution) — understand cell sizing and latency budgets
- [API reference](./api-reference) — submit jobs programmatically
