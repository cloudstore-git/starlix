import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // amazon-cognito-identity-js expects a Node-style global
  define: { global: 'globalThis' },
  build: { outDir: 'dist', sourcemap: true },
  // Shared domain types live in ../services/shared
  // npm run dev:local takes config.json from the local API (npm run local in the repo root)
  server: {
    fs: { allow: ['..'] },
    proxy: process.env.STARLIX_LOCAL ? { '/config.json': 'http://localhost:4000' } : undefined,
  },
});
