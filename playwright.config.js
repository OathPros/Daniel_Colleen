import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  outputDir: "node_modules/.cache/rsvp-browser-results",
  use: {
    baseURL: "http://localhost:4173",
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        ...(process.env.RSVP_TEST_BROWSER ? { channel: process.env.RSVP_TEST_BROWSER } : {}),
      },
    },
    {
      name: "mobile-safari",
      testMatch: /rsvp-interaction\.spec\.js/,
      use: {
        ...devices["iPhone 13"],
        browserName: "webkit",
      },
    },
  ],
  webServer: {
    command: "node scripts/preview-server.mjs --static-only",
    url: "http://localhost:4173/rsvp",
    reuseExistingServer: false,
    timeout: 15000,
  },
});
