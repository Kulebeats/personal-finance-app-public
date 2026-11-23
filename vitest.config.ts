import { defineConfig } from "vitest/config";
import path from "path";
import { prepareTestEnvironment } from "./server/testing/test-target.mjs";

prepareTestEnvironment();

export default defineConfig({
  test: {
    globalSetup: [path.resolve(__dirname, "server/testing/global-setup.ts")],
    setupFiles: [path.resolve(__dirname, "server/testing/test-setup.ts")],
    environment: "node",
    include: [
      "server/**/*.{test,spec}.{ts,tsx}",
      "server/**/__tests__/**/*.{test,spec}.{ts,tsx}",
    ],
    globals: true,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
});
