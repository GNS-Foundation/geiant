// Browser shims so @geiant/core's verifier (ed25519.ts / rotation.ts) runs in the
// single-file bundle. Those modules were written for Node: they use a global
// `Buffer` for hex<->bytes. Import this module FIRST (before any @geiant/core
// import) so the global exists before any verify call. The `crypto` module import
// (createHash/randomBytes) is handled separately by a vite resolve.alias -> crypto-shim.
//
// Minimal on purpose: only the surface the CGR verify path touches
// (Buffer.from(hex,'hex'), Buffer.from(bytes), .toString('hex')).

class BufferPolyfill extends Uint8Array {
  static from(input: ArrayLike<number> | string | Uint8Array, enc?: string): BufferPolyfill {
    if (typeof input === 'string') {
      if (enc === 'hex') {
        const n = Math.floor(input.length / 2);
        const out = new BufferPolyfill(n);
        for (let i = 0; i < n; i++) out[i] = parseInt(input.substr(i * 2, 2), 16);
        return out;
      }
      const enc8 = new TextEncoder().encode(input);
      const out = new BufferPolyfill(enc8.length);
      out.set(enc8);
      return out;
    }
    const src = input as ArrayLike<number>;
    const out = new BufferPolyfill(src.length);
    out.set(src as Uint8Array);
    return out;
  }

  toString(enc?: string): string {
    if (enc === 'hex') {
      let s = '';
      for (let i = 0; i < this.length; i++) s += this[i].toString(16).padStart(2, '0');
      return s;
    }
    return new TextDecoder().decode(this);
  }
}

const g = globalThis as unknown as { Buffer?: unknown };
if (typeof g.Buffer === 'undefined') {
  g.Buffer = BufferPolyfill as unknown;
}

export {};
