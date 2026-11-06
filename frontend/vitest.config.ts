import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// Resolve @isv/shared to its TypeScript source, as the Vite build will.
// Vitest's default "node" environment resolves through the ssr conditions; the
// jsdom environment added in Phase 6 uses the client ones, so both are set.
export default defineConfig({
  resolve: { conditions: ["source", ...defaultClientConditions] },
  ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
