import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // cli.ts is the thin process entry point (its logic lives in options.ts);
      // index.ts and types.ts contain no runtime code.
      exclude: [
        "src/**/*.test.ts",
        "src/cli.ts",
        "src/index.ts",
        "src/types.ts",
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
