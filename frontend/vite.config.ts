import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

// Dev and preview both proxy the API, mirroring nginx in Docker, so the bundle
// only ever calls relative URLs (spec 5.5).
const proxy = {
  "/api": "http://localhost:3001",
  "/health": "http://localhost:3001",
};

export default defineConfig({
  plugins: [react()],
  // Bundle @isv/shared from its TypeScript source, so the build never needs its dist.
  resolve: { conditions: ["source", ...defaultClientConditions] },
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: { target: "es2023", sourcemap: true },
});
