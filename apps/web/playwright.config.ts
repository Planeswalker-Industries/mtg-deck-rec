import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3300);
const externalServer = process.env.E2E_BASE_URL;

/**
 * End-to-end checks at phone width. CI builds the app with mock recommendations against a fresh local Supabase
 * (migrations only, no catalog) and runs these on the production server. Locally, point E2E_BASE_URL at a running
 * server (uses the installed Chrome); add E2E_LOCAL_DATA=1 when its database has the synced catalog and deck corpus,
 * which enables the checks that need real cards.
 */
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: externalServer ?? `http://localhost:${port}`,
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    channel: process.env.CI ? undefined : "chrome",
    trace: "retain-on-failure",
  },
  webServer: externalServer
    ? undefined
    : { command: `yarn start --port ${port}`, url: `http://localhost:${port}/deck`, timeout: 120_000, reuseExistingServer: false },
});
