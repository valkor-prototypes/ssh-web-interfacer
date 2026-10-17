import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const backend = `http://127.0.0.1:${process.env.PORT || 8022}`;

export default defineConfig({
  root: 'web',
  plugins: [vue()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/ws': { target: backend.replace('http', 'ws'), ws: true },
    },
  },
});
