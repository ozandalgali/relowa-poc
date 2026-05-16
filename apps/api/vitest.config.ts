import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 15000,
    setupFiles: ["./src/__tests__/setup.ts"],
    hookTimeout: 30000,
  },
});
