import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

/**
 * E2E runs the production build in DEMO mode (in-process store, no external
 * services). Supabase-specific behaviour (auth, RLS) is covered by
 * `npm run test:db` against real PostgreSQL.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
  projects: [
    // Full scenarios on Android-sized Chromium.
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] }, testIgnore: /smoke\.spec\.ts/ },
    // Layout smoke on iPhone and desktop viewports (Chromium engine with device metrics).
    { name: "iphone", use: { ...devices["iPhone 14"], browserName: "chromium" }, testMatch: /smoke\.spec\.ts/ },
    { name: "android", use: { ...devices["Pixel 7"] }, testMatch: /smoke\.spec\.ts/ },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testMatch: /smoke\.spec\.ts/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      MRO_DEMO_MODE: "true",
      CONNECTOR_MOCK_MODE: "true",
      // Explicit test-deployment opt-in: `next start` is a production build.
      ENABLE_MOCK_CONNECTORS: "true",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
  },
});
