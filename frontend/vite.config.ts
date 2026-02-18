import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  envDir: "../",
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": "http://localhost:8787",
      "/webhook": "http://localhost:8787",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
