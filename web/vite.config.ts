import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.API_TARGET ?? 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    // Loopback only - deployments serve the built bundle from the API server.
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true, ws: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
