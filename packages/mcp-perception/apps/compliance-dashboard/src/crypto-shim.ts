// Browser replacement for Node's `crypto`, aliased in vite.config.ts. @geiant/core's
// ed25519.ts does `import { createHash, randomBytes } from 'crypto'` and, at module
// load, sets @noble/ed25519's `sha512Sync` to `createHash('sha512')…`. In the browser
// there is no node `crypto`, so we back createHash with @noble/hashes (already a
// @geiant/core dependency — same primitive, sync) and randomBytes with WebCrypto.
// Only the surface the verify path needs is implemented.

import { sha256, sha512 } from '@noble/hashes/sha2';

type Algo = 'sha256' | 'sha512' | string;

class Hasher {
  private algo: Algo;
  private chunks: Uint8Array[] = [];
  constructor(algo: Algo) {
    this.algo = algo;
  }
  update(data: Uint8Array | string): this {
    this.chunks.push(typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data));
    return this;
  }
  digest(): Uint8Array {
    let len = 0;
    for (const c of this.chunks) len += c.length;
    const all = new Uint8Array(len);
    let o = 0;
    for (const c of this.chunks) { all.set(c, o); o += c.length; }
    if (this.algo === 'sha256') return sha256(all);
    return sha512(all); // default/sha512 — the only two the verifier uses
  }
}

export function createHash(algo: Algo): Hasher {
  return new Hasher(algo);
}

export function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  (globalThis.crypto as Crypto | undefined)?.getRandomValues(a);
  return a;
}

export default { createHash, randomBytes };
