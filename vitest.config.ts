import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/expert/**/*.test.ts",
    ],
    testTimeout: 30000,
    pool: "forks",
    maxWorkers: 2,
    // Real native smoke tests share one installed service and dispose project instances.
    fileParallelism: !process.env.TEST_OPENCODE_URL,
  },
});
