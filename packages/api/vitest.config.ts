import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "integration-tests/**/*.test.ts"],
    setupFiles: ["src/routers/hub/vitest.setup.ts"], // hub-seam: stand-in databases skip the private-board guard
  },
  resolve: {
    alias: {
      "@kan/db": resolve(__dirname, "../db/src"),
    },
  },
});
