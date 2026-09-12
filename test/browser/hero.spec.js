import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

const existingImage = resolve("Arwen.png");

async function useManifest(page, images) {
  await page.route("**/assets/data/images.generated.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `window.WEDDING_IMAGE_MANIFEST=${JSON.stringify({ schemaVersion: 1, collections: { "home/hero": images }, warnings: [] })};`,
  }));
  await page.route("**/assets/images/home/hero/*", (route) => route.fulfill({ path: existingImage }));
}

test("keeps the legacy hero for an empty managed collection", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("[data-hero]")).toHaveAttribute("data-hero-mode", "legacy");
  await expect(page.locator("[data-hero] > .slide")).toHaveCount(5);
});

test("renders one managed image without a slideshow timer UI", async ({ page }) => {
  await useManifest(page, [{ src: "assets/images/home/hero/01.webp", position: "center 30%" }]);
  await page.goto("/index.html");
  const hero = page.locator("[data-hero]");
  await expect(hero).toHaveAttribute("data-hero-mode", "managed");
  await expect(hero.locator(".managed-slide")).toHaveCount(1);
  await expect(hero.locator(".photo-progress")).toHaveCount(0);
  await expect(hero.locator(".managed-slide")).toHaveCSS("background-position", "50% 30%");
});

test("derives the slide and progress counts from the managed collection", async ({ page }) => {
  const images = Array.from({ length: 12 }, (_, index) => ({
    src: `assets/images/home/hero/${String(index + 1).padStart(2, "0")}.webp`,
    position: "center",
  }));
  await useManifest(page, images);
  await page.goto("/index.html");
  const hero = page.locator("[data-hero]");
  await expect(hero).toHaveAttribute("data-hero-mode", "managed");
  await expect(hero.locator(".managed-slide")).toHaveCount(12);
  await expect(hero.locator(".photo-progress span")).toHaveCount(12);
});
