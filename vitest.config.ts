import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
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
