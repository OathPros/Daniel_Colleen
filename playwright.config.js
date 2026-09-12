import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  outputDir: "node_modules/.cache/rsvp-browser-results",
  use: {
    baseURL: "http://localhost:4173",
    browserName: "chromium",
    channel: process.env.RSVP_TEST_BROWSER || "chrome",
    trace: "off",
  },
  webServer: {
    command: "node scripts/preview-server.mjs --static-only",
    url: "http://localhost:4173/rsvp.html",
    reuseExistingServer: false,
    timeout: 15000,
  },
});
