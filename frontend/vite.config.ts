import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { execSync } from 'child_process';

function getGitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer'],
      globals: { Buffer: true },
    }),
  ],
  envDir: '../',
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:8787',
      '/webhook': 'http://localhost:8787',
      '/r2': 'http://localhost:8787',
      '/admin': 'http://localhost:8787',
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(getGitHash()),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
