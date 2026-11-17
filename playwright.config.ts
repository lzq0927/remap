import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 1440, height: 1000 },
    // 既有回归脚本验证经典工作台（专家模式）；四步工作台的脚本自行清除此设置。
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://127.0.0.1:5174",
          localStorage: [{ name: "remap.ui", value: "classic" }],
        },
      ],
    },
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
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
