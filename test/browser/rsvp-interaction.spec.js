import { test, expect } from "@playwright/test";

const suggestions = ["Luca Example", "Luis Sample", "Luanne Fiction"];

async function install(page) {
  const calls = [];
  await page.addInitScript(() => {
    window.turnstile = {
      render(_container, options) { window.challenge = options; return "synthetic-widget"; },
      execute() { setTimeout(() => window.challenge.callback("synthetic-token"), 0); },
      remove() {},
    };
  });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://localhost:4173") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname.split("/").pop();
    const body = route.request().postDataJSON();
    calls.push({ path, body });
    if (path === "suggest") return route.fulfill({ json: { names: suggestions, hasMore: false } });
    if (path === "lookup") return route.fulfill({ json: {
      state: "unanswered",
      party: { publicId: "synthetic-public-id-0123456789abcdef", guests: [{ id: 10, name: body.name }] },
    } });
    return route.fulfill({ status: 404, json: { message: "Unexpected request" } });
  });
  await page.goto("/rsvp");
  return calls;
}

async function showSuggestions(page) {
  const input = page.getByRole("combobox");
  await input.fill("lu");
  await expect(page.getByRole("option")).toHaveCount(3);
  return input;
}

test("mouse selection retains focus until click and performs one lookup", async ({ page }) => {
  const calls = await install(page);
  await showSuggestions(page);
  const option = page.getByRole("option", { name: "Luca Example", exact: true });
  await page.evaluate(() => {
    window.selectionEvents = [];
    document.querySelector("#guest-search").addEventListener("blur", () => window.selectionEvents.push("blur"));
    document.querySelector("#suggestion-0").addEventListener("click", () => window.selectionEvents.push("click"));
  });

  await option.click();

  await expect(page.locator("#confirm-title")).toBeVisible();
  expect(await page.evaluate(() => window.selectionEvents.slice(0, 2))).toEqual(["click", "blur"]);
  expect(calls.filter(call => call.path === "lookup")).toHaveLength(1);
});

test("a real tap performs exactly one lookup on touch-capable browsers", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.use.hasTouch, "Touch regression runs in the mobile Safari project");
  const calls = await install(page);
  await showSuggestions(page);

  await page.getByRole("option", { name: "Luca Example", exact: true }).tap();

  await expect(page.locator("#confirm-title")).toBeVisible();
  expect(calls.filter(call => call.path === "lookup")).toHaveLength(1);
});

test("pointer contact alone neither selects nor closes suggestions", async ({ page }) => {
  const calls = await install(page);
  const input = await showSuggestions(page);
  const option = page.getByRole("option", { name: "Luca Example", exact: true });

  await option.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });

  await expect(input).toBeFocused();
  await expect(option).toBeVisible();
  expect(calls.filter(call => call.path === "lookup")).toHaveLength(0);
});

test("keyboard selection performs one lookup", async ({ page }) => {
  const calls = await install(page);
  const input = await showSuggestions(page);

  await input.press("ArrowDown");
  await input.press("Enter");

  await expect(page.locator("#confirm-title")).toBeVisible();
  expect(calls.filter(call => call.path === "lookup")).toHaveLength(1);
});

test("blurring to an unrelated control still dismisses suggestions", async ({ page }) => {
  const calls = await install(page);
  await showSuggestions(page);

  await page.locator(".menu-toggle").focus();

  await expect(page.getByRole("listbox")).toBeHidden();
  expect(calls.filter(call => call.path === "lookup")).toHaveLength(0);
});
