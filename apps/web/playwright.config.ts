import { defineConfig } from "@playwright/test";
import { TOURS_ENABLED_KEY } from "./src/lib/constants";

const port = Number(process.env.E2E_PORT ?? 3300);
const externalServer = process.env.E2E_BASE_URL;
const baseURL = externalServer ?? `http://localhost:${port}`;
/** The read-only production smoke run (`yarn smoke`, T082) runs only e2e/smoke; the normal run skips that folder. */
const smoke = Boolean(process.env.E2E_SMOKE);

/**
 * End-to-end checks at phone width. CI builds the app with mock recommendations against a fresh local Supabase
 * (migrations only, no catalog) and runs these on the production server. Locally, point E2E_BASE_URL at a running
 * server (uses the installed Chrome); add E2E_LOCAL_DATA=1 when its database has the synced catalog and deck corpus,
 * which enables the checks that need real cards.
 */
export default defineConfig({
  testDir: smoke ? "./e2e/smoke" : "./e2e",
  testIgnore: smoke ? undefined : "smoke/**",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL,
    // Tours off, so no test meets one; tours.spec.ts turns them on with its own storage state.
    storageState: { cookies: [], origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: TOURS_ENABLED_KEY, value: "0" }] }] },
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    channel: process.env.CI ? undefined : "chrome",
    trace: "retain-on-failure",
  },
  webServer: externalServer
    ? undefined
    : { command: `yarn start --port ${port}`, url: `http://localhost:${port}/deck`, timeout: 120_000, reuseExistingServer: false },
});
