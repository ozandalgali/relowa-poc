import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 60000,
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
