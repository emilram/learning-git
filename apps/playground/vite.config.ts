import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // Consumir el paquete desde su fuente para HMR sin build previo.
      '@empresa/city-sketch/vue': fileURLToPath(new URL('../../packages/city-sketch/src/vue/index.ts', import.meta.url)),
      '@empresa/city-sketch/theme': fileURLToPath(new URL('../../packages/city-sketch/src/theme/index.ts', import.meta.url)),
      '@empresa/city-sketch': fileURLToPath(new URL('../../packages/city-sketch/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5173, host: '127.0.0.1' },
});
