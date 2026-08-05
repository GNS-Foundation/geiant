import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// Single-file bundle entry. Resolve to an ABSOLUTE path next to this config so the
// build depends on neither cwd nor an env var: `mcp-app.html` is the unconditional
// default; INPUT can still override it.
//
// Previous config placed rollupOptions.input ONLY inside `...(process.env.INPUT && {…})`,
// so any invocation that reached vite without INPUT set (notably CI's non-gating
// `workspace` job running `pnpm -r build`) fell back to vite's default entry
// `index.html`, which does not exist → "Could not resolve entry module index.html".
// Defaulting the entry here removes that failure mode entirely.
const entry = fileURLToPath(new URL(`./${process.env.INPUT ?? 'mcp-app.html'}`, import.meta.url));

// @geiant/core's ed25519.ts imports Node's `crypto`; in the browser bundle we map it
// to a WebCrypto/@noble-backed shim so the real CGR verifier runs client-side.
const cryptoShim = fileURLToPath(new URL('./src/crypto-shim.ts', import.meta.url));
// The shim's own `@noble/hashes/sha2` import is resolved from @geiant/core's nested
// copy (this app declares no deps of its own); version-independent path.
const nobleSha2 = fileURLToPath(new URL('../../../core/node_modules/@noble/hashes/sha2.js', import.meta.url));

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: [
      { find: /^crypto$/, replacement: cryptoShim },
      { find: /^@noble\/hashes\/sha2$/, replacement: nobleSha2 },
    ],
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    rollupOptions: {
      input: entry,
    },
  },
});
