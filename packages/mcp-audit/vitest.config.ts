import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.js', '.json'],
  },
  plugins: [
    {
      name: 'resolve-ts-from-js',
      enforce: 'pre',
      resolveId(source, importer) {
        // Only rewrite .js → .ts for our own src/ imports
        if (source.endsWith('.js') && importer && !importer.includes('node_modules')) {
          const tsPath = source.replace(/\.js$/, '.ts');
          return this.resolve(tsPath, importer, { skipSelf: true });
        }
        return null;
      },
    },
  ],
  test: {
    include: ['test/**/*.test.ts'],
    globals: false,
    testTimeout: 10000,
  },
});
