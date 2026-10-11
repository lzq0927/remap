import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node --import tsx scripts/dev.ts",
    url: "http://127.0.0.1:5174/api/defaults",
    env: {
      PORT: "4188",
      WEB_PORT: "5174",
      VITE_API_TARGET: "http://127.0.0.1:4188",
      DATA_DIR: "data/e2e",
    },
    reuseExistingServer: true,
    timeout: 30000,
  },
});
