---
sidebar_position: 4
title: Worker CLI
---

# Hive Worker CLI

`@gns-foundation/hive-worker` is the Node.js CLI that registers a device in the GEIANT Hive swarm, polls for inference jobs, and settles GNS earnings on Stellar.

## Installation

```bash
# Run directly (no install required)
npx @gns-foundation/hive-worker <command>

# Or install globally
npm install -g @gns-foundation/hive-worker
hive-worker <command>
```

**Requirements:** Node.js ≥ 18.

## Commands

### `join`

Register this device in the swarm and start polling for jobs.

```bash
hive-worker join [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--handle <name>` | — | Your GNS handle (e.g. `@alice`). Optional. |
| `--rpc-port <port>` | `50052` | Port for the llama.cpp rpc-server (pipeline mode). |
| `--skip-rpc` | false | Do not start the rpc-server. Recommended for solo inference. |
| `--no-jobs` | false | Observer mode — register in swarm but do not execute jobs. |

**What join does:**

1. Loads or generates an Ed25519 keypair at `~/.hive/identity.json`
2. Detects hardware: CPU model, core count, GPU, RAM, estimated TFLOPS
3. Resolves location to H3 Res-6 cell via IP geolocation (ipapi.co)
4. Upserts into `swarm_nodes` (Supabase)
5. Starts a 30-second heartbeat to keep the registration alive
6. Polls `hive_jobs` every 5 seconds via `claim_hive_job()` RPC
7. On job claim: executes via `llama-completion`, posts result, credits GNS

Press `Ctrl+C` to disconnect gracefully. The worker marks itself offline in the registry and stops the heartbeat.

**Examples:**

```bash
# Basic join
hive-worker join

# With handle, no rpc-server
hive-worker join --handle @camilo --skip-rpc

# Observer only (no inference, just register in swarm)
hive-worker join --no-jobs
```

---

### `status`

Show the current swarm state and your token balance.

```bash
hive-worker status
```

Output includes:
- Your identity short PK
- Active nodes and total TFLOPS in the swarm
- Your `tokens_earned` balance
- Whether `llama-completion` and `rpc-server` binaries are found

---

### `leave`

Mark this device as offline and disconnect from the swarm.

```bash
hive-worker leave
```

Your identity and token balance are preserved. Run `join` to rejoin.

---

### `whoami`

Print your Hive identity.

```bash
hive-worker whoami
```

Output:

```
  pk:      4d7f2ba9241d6954c8272f044ca7c179f59c6de61d0fea6ee54d5209153ca42a
  short:   4d7f2ba9
  created: 2026-03-28T09:21:16.315Z
  file:    /Users/you/.hive/identity.json
```

---

### `models list`

List models cached locally in `~/.hive/models/`.

```bash
hive-worker models list
```

---

### `models fetch <model-id>`

Download a model from HuggingFace to `~/.hive/models/`.

```bash
hive-worker models fetch <model-id>
```

| Model ID | Size | Description |
|----------|------|-------------|
| `tinyllama` | ~635 MB | TinyLlama 1.1B Chat Q4_K_M. Fast, good for testing. |
| `phi-3-mini` | ~2.3 GB | Microsoft Phi-3-mini 4k instruct Q4. Good quality/speed balance. |
| `gemma-2-2b` | ~1.6 GB | Google Gemma-2 2B IT Q4_K_M. |

**Example:**

```bash
hive-worker models fetch tinyllama
# Downloading... 100% (635 / 638 MB)
# ✓ Saved to /Users/you/.hive/models/tinyllama.gguf
```

## Identity file

The keypair is stored at `~/.hive/identity.json` with file mode 600 (owner read/write only).

```json
{
  "pk": "4d7f2ba9241d6954c8272f044ca7c179f59c6de61d0fea6ee54d5209153ca42a",
  "sk": "...",
  "createdAt": "2026-03-28T09:21:16.315Z"
}
```

The `pk` is your Ed25519 public key (64 hex chars = 32 bytes). This is also your GNS identity and the source address for your Stellar wallet. The `sk` (secret key) never leaves your machine.

## llama-completion binary

The worker uses `llama-completion` (not `llama-cli`) for inference. This binary runs in batch mode — it writes the completion to stdout and exits cleanly without the interactive UI banner.

The worker searches these paths in order:

```
~/llama.cpp/build/bin/llama-completion
~/llama.cpp/build/llama-completion
llama-completion  (in PATH)
~/llama.cpp/build/bin/llama-cli  (fallback)
llama-cli  (fallback)
```

To install llama.cpp with the completion binary:

```bash
git clone --depth 1 https://github.com/ggerganov/llama.cpp
cd llama.cpp
cmake -B build
cmake --build build --config Release -t llama-completion
```

## Dashboard

The live dashboard shows:

```
◆ GEIANT HIVE WORKER v0.1.1
  10c arm64 · 16 GB · ~4.6 TFLOPS · Rome
  Identity: 4d7f2ba9 · @camilo
  ─────────────────────────────────────
● IDLE  10:57:16 AM
⬡ Swarm: 3 nodes · 12.8 TFLOPS
✦ Earned: 0.0720 GNS
› Joined at 2026-03-28T09:57:15Z
› [10:57:16] Job poller started — polling every 5s
♥ Heartbeat #1 · uptime 31s
◉ COMPUTING  10:57:36 AM
› Job claimed: 800ff8e0 · model=tinyllama · 60 tokens
● IDLE  10:57:38 AM
✦ Earned: 0.0780 GNS
```

The dashboard uses a simple line-logger (no ANSI cursor movement) — safe to run over SSH.
