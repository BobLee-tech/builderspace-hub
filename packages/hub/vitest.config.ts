import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Integration tests boot an in-memory Postgres and apply every migration.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // cli/main.ts and the dev/check-*.ts scripts are process entry points;
      // index.ts files only re-export; db.ts holds types only.
      exclude: [
        "src/**/*.test.ts",
        "src/**/index.ts",
        "src/cli/main.ts",
        "src/dev/check-seams.ts",
        "src/dev/check-web-types.ts",
        "src/db.ts",
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
