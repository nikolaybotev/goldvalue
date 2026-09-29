import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const ORIGIN = `http://127.0.0.1:${PORT}`;

// BASE_URL points the suite at an already deployed site instead of the local preview build,
// e.g. BASE_URL=https://nikolaybotev.github.io/goldvalue/ pnpm test:e2e (a trailing slash is added).
// Data and LBMA are still stubbed with page.route/context.route, so the run needs no data
// files of its own and never reaches the real LBMA; only the deployed shell is under test.
const remote = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/*$/, "/") : null;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: remote ?? `${ORIGIN}/`,
    // Tests stub data with page.route, which cannot see requests a service worker handles.
    // e2e/offline.spec.ts opts back in.
    serviceWorkers: "block",
    timezoneId: "UTC",
    locale: "en-US",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // offline.spec.ts asserts against the synthetic files of the local e2e build.
  testIgnore: remote ? ["**/offline.spec.ts"] : [],
  webServer: remote
    ? undefined
    : {
        command: `node ../../scripts/build-e2e.mjs && exec vite preview --outDir dist-e2e --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: ORIGIN,
        reuseExistingServer: false,
        timeout: 120_000,
        gracefulShutdown: { signal: "SIGTERM", timeout: 2000 },
      },
});
