import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

const existingImage = resolve("Arwen.png");

async function useManifest(page, images, moments = []) {
  await page.route("**/assets/data/images.generated.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `window.WEDDING_IMAGE_MANIFEST=${JSON.stringify({ schemaVersion: 1, collections: { "home/hero": images, "home/moments": moments }, warnings: [] })};`,
  }));
  await page.route("**/assets/images/home/hero/*", (route) => route.fulfill({ path: existingImage }));
  await page.route("**/assets/images/home/moments/*", (route) => route.fulfill({ path: existingImage }));
}

test("keeps the legacy hero for an empty managed collection", async ({ page }) => {
  await useManifest(page, []);
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

test("renders all 50 managed Moments We Love photos and opens them in the lightbox", async ({ page }) => {
  const moments = Array.from({ length: 50 }, (_, index) => ({
    src: `assets/images/home/moments/${String(index + 1).padStart(2, "0")}.webp`,
    position: index === 49 ? "center 30%" : "center",
    alt: `Favourite moment ${index + 1}`,
  }));
  await useManifest(page, [], moments);
  await page.goto("/index.html");

  const gallery = page.locator("[data-gallery]");
  await expect(gallery).toHaveAttribute("data-gallery-mode", "managed");
  await expect(gallery.locator(".managed-gallery-item")).toHaveCount(50);
  await expect(gallery.locator(".managed-gallery-item").last()).toHaveCSS("background-position", "50% 30%");

  await gallery.locator(".managed-gallery-item").last().click();
  await expect(page.locator("[data-gallery-lightbox]")).toBeVisible();
  await expect(page.locator("[data-gallery-caption]")).toHaveText("50 / 50");
  await expect(page.locator(".gallery-lightbox__image")).toHaveAttribute("aria-label", "Favourite moment 50");
});
