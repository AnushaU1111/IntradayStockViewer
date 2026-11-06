import { defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve @isv/shared to its TypeScript source in tests, so no build step is needed first.
  ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
