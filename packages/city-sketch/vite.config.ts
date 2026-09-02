import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@theme': fileURLToPath(new URL('./src/theme', import.meta.url)),
    },
  },
  build: {
    lib: {
      entry: {
        index: 'src/index.ts',
        'core/index': 'src/core/index.ts',
        'theme/index': 'src/theme/index.ts',
        'vue/index': 'src/vue/index.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['vue', /^d3-/, 'roughjs'],
    },
    sourcemap: true,
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    benchmark: { include: ['bench/**/*.bench.ts'] },
  },
});
