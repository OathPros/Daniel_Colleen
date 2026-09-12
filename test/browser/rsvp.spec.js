import { test, expect } from "@playwright/test";
import { suggestNames } from "../../assets/js/rsvp-search.js";

const guests = [{ id: 10, name: "Luca Example" }, { id: 11, name: "Taylor Example" }];
const allNames = ["Luca Example", "Luis Sample", "Luanne Fiction"];
const invitation = { state: "unanswered", party: { publicId: "synthetic-public-id-0123456789abcdef", guests } };

async function install(page, overrides = {}) {
  const calls = [];
  await page.addInitScript(() => {
    window.verifications = 0; window.verificationMode = "success";
    window.turnstile = {
      render(_container, options) { window.challenge = options; return "synthetic-widget"; },
      execute() {
        window.verifications++;
        const options = window.challenge;
        if (window.verificationMode === "manual") { options["before-interactive-callback"](); return; }
        setTimeout(() => window.verificationMode === "expired" ? options["expired-callback"]() : options.callback("synthetic-token"), 10);
      },
      remove() {}
    };
  });
  // Deny all non-local traffic, including real Turnstile and Google Fonts.
  // The local server is static-only: even an unmocked API call cannot reach D1.
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://localhost:4173") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const path = url.pathname.split("/").pop(), body = route.request().postDataJSON();
    calls.push({ path, body });
    if (overrides[path]) return overrides[path](route, body);
    const json = path === "suggest" ? suggestNames(allNames, body.name) : path === "lookup" ? invitation : { state: "submitted" };
    return route.fulfill({ json });
  });
  await page.goto("/rsvp.html");
  return calls;
}
async function find(page) {
  await page.getByRole("combobox").fill("lu");
  await page.getByRole("option", { name: "Luca Example", exact: true }).click();
  await expect(page.locator("#confirm-title")).toBeVisible();
}
async function answer(page) {
  await page.getByRole("button", { name: "Yes, continue" }).click();
  await page.locator("#attendance-10").check(); await page.locator("#dinner-10").selectOption("chicken");
  await page.locator("#dietary-10").fill("Synthetic allergy note"); await page.locator("#attendance-11-no").check();
  await page.locator("#guests-continue").click();
}
async function contact(page) {
  for (const [key, value] of Object.entries({ contactEmail: "rsvp@example.test", addressLine1: "1 Synthetic Way", city: "Ottawa",
    provinceState: "ON", postalCode: "A1A 1A1", country: "Canada", message: "A synthetic warm note" })) await page.locator(`#${key}`).fill(value);
  await page.locator("#contact-continue").click(); await expect(page.locator("#review-title")).toBeVisible();
}

test("autocomplete narrows locally; explicit keyboard selection and focus", async ({ page }) => {
  const calls = await install(page), input = page.getByRole("combobox");
  await input.fill("lu"); await expect(page.getByRole("option")).toHaveCount(3);
  await expect(input).toBeFocused(); expect(await page.evaluate(() => window.verifications)).toBe(0);
  await input.press("Enter"); expect(calls.filter(c => c.path === "lookup")).toHaveLength(0);
  await input.fill("luc"); await expect(page.getByRole("option")).toHaveCount(1);
  expect(calls.filter(c => c.path === "suggest")).toHaveLength(1);
  await input.press("Escape"); await expect(page.getByRole("listbox")).toBeHidden();
  await input.press("ArrowDown"); await expect(page.getByRole("listbox")).toBeVisible();
  await input.fill("lu"); await input.press("ArrowUp"); await expect(input).toHaveAttribute("aria-activedescendant", "suggestion-2");
  await input.press("ArrowDown"); await input.press("ArrowDown"); await input.press("Enter");
  await expect(page.locator("#confirm-title")).toBeFocused();
  expect(await page.evaluate(() => document.getElementById("confirm-title").getBoundingClientRect().top >= document.querySelector(".topbar").getBoundingClientRect().bottom)).toBe(true);
  expect(calls.find(c => c.path === "lookup").body).toEqual({ name: "Luca Example", turnstileToken: "synthetic-token", website: "" });
});

test("full mobile flow validates, preserves draft, reviews and ends without editable data", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const calls = await install(page); await find(page);
  await page.getByRole("button", { name: "Yes, continue" }).click();
  await page.locator("#guests-continue").click(); await expect(page.locator("#rsvp-errors")).toBeFocused();
  await page.locator('#rsvp-error-list a[href="#attendance-10"]').click(); await expect(page.locator("#attendance-10")).toBeFocused();
  await page.locator("#attendance-10").check(); await page.locator("#guests-continue").click();
  await expect(page.locator("#error-dinner-10")).toBeVisible();
  await page.locator("#dinner-10").selectOption("vegetarian"); await page.locator("#dietary-10").fill("Synthetic allergy");
  await page.locator("#attendance-10-no").check(); await expect(page.locator("#dinner-10")).toBeHidden();
  await page.locator("#attendance-10").check(); await expect(page.locator("#dinner-10")).toHaveValue("vegetarian");
  await expect(page.locator("#dietary-10")).toHaveValue("Synthetic allergy");
  await page.locator("#attendance-11-no").check(); await page.locator("#guests-continue").click();
  await page.locator("#contact-continue").click(); await expect(page.locator("#error-contactEmail")).toBeVisible();
  await contact(page);
  await page.getByRole("button", { name: "Edit contact details" }).click(); await expect(page.locator("#contactEmail")).toHaveValue("rsvp@example.test");
  await page.locator("#contact-continue").click();
  await expect(page.locator("#review-guests")).toContainText("Vegetarian");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "node_modules/.cache/rsvp-review-mobile.png", fullPage: true });
  await page.locator("#rsvp-submit").click(); await expect(page.locator("#success-title")).toBeFocused();
  await expect(page.locator("#rsvp-submit")).toBeHidden(); await expect(page.locator("#contactEmail")).toHaveValue("");
  expect(calls.find(c => c.path === "submit").body.guests[1]).toEqual({ id: 11, attending: "no" });
  expect(await page.evaluate(() => window.verifications)).toBe(2);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test("already submitted has no form, saved details, or submit action", async ({ page }) => {
  const calls = await install(page, { lookup: route => route.fulfill({ json: { state: "already_submitted" } }) });
  await page.getByRole("combobox").fill("lu"); await page.getByRole("option", { name: "Luca Example", exact: true }).click();
  await expect(page.locator("#closed-title")).toBeFocused();
  await expect(page.getByText("This party has already RSVPed.", { exact: false })).toBeVisible();
  await expect(page.locator("#rsvp-submit")).toBeHidden(); expect(calls.some(c => c.path === "submit")).toBe(false);
});

test("search again and a failed lookup cannot retain an old party", async ({ page }) => {
  let lookups = 0;
  const calls = await install(page, { lookup: route => ++lookups === 1 ? route.fulfill({ json: invitation }) : route.fulfill({ status: 404, json: { message: "Try the name on your invitation." } }) });
  await find(page); await page.getByRole("button", { name: "Search again", exact: true }).click();
  await expect(page.locator("#invitation-names")).toBeEmpty();
  await page.getByRole("combobox").fill("lu"); await page.getByRole("option", { name: "Luca Example", exact: true }).click();
  await expect(page.locator("#rsvp-status")).toHaveText("Try the name on your invitation.");
  await expect(page.locator("#rsvp-submit")).toBeHidden();
  await page.locator("#rsvp-form").evaluate(form => form.requestSubmit()); expect(calls.some(c => c.path === "submit")).toBe(false);
});

test("out-of-order suggestion results never replace a newer query", async ({ page }) => {
  let release, requested; const started = new Promise(resolve => { requested = resolve; });
  const slow = new Promise(resolve => { release = resolve; });
  await install(page, { suggest: async (route, body) => {
    if (body.name === "lu") { requested(); await slow; }
    await route.fulfill({ json: suggestNames(allNames, body.name) }).catch(() => {});
  } });
  await page.getByRole("combobox").fill("lu"); await started;
  await page.getByRole("combobox").fill("unknown"); await expect(page.locator("#search-help")).toContainText("No names found");
  release(); await expect(page.getByRole("option")).toHaveCount(0); await expect(page.getByRole("combobox")).toHaveValue("unknown");
});

test("challenge resumes lookup automatically and blocks overlapping selection", async ({ page }) => {
  const calls = await install(page); await page.evaluate(() => { window.verificationMode = "manual"; });
  await page.getByRole("combobox").fill("lu"); await page.getByRole("option", { name: "Luca Example", exact: true }).click();
  await expect(page.getByRole("combobox")).toBeDisabled(); await expect(page.locator("#rsvp-status")).toContainText("continue automatically");
  await expect(page.locator("#rsvp-form")).not.toHaveAttribute("aria-busy", "true");
  expect(calls.filter(c => c.path === "lookup")).toHaveLength(0);
  await page.evaluate(() => window.challenge.callback("synthetic-token"));
  await expect(page.locator("#confirm-title")).toBeVisible(); expect(calls.filter(c => c.path === "lookup")).toHaveLength(1);
});

test("expired verification can be retried without submitting", async ({ page }) => {
  const calls = await install(page); await page.evaluate(() => { window.verificationMode = "expired"; });
  await page.getByRole("combobox").fill("lu"); await page.getByRole("option", { name: "Luca Example", exact: true }).click();
  await expect(page.locator("#rsvp-status")).toContainText("expired"); expect(calls.filter(c => c.path === "lookup")).toHaveLength(0);
  await page.evaluate(() => { window.verificationMode = "success"; });
  await page.getByRole("option", { name: "Luca Example", exact: true }).click(); await expect(page.locator("#confirm-title")).toBeVisible();
});

test("network failure preserves review; retry cannot double submit", async ({ page }) => {
  let attempts = 0;
  const calls = await install(page, { submit: async route => {
    if (++attempts === 1) return route.abort();
    await new Promise(resolve => setTimeout(resolve, 150)); return route.fulfill({ json: { state: "submitted" } });
  } });
  await find(page); await answer(page); await contact(page);
  await page.locator("#rsvp-submit").click(); await expect(page.locator("#rsvp-status")).toHaveAttribute("data-state", "error");
  await expect(page.locator("#review-contact")).toContainText("rsvp@example.test");
  await page.locator("#rsvp-submit").evaluate(button => { button.click(); button.click(); });
  await expect(page.locator("#success-title")).toBeVisible(); expect(calls.filter(c => c.path === "submit")).toHaveLength(2);
});

test("409 becomes terminal; server validation routes to its linked field", async ({ page }) => {
  let attempts = 0;
  await install(page, { submit: route => ++attempts === 1 ? route.fulfill({ status: 400, json: {
    code: "validation_error", fields: { contactEmail: "Please check this email." }
  } }) : route.fulfill({ status: 409, json: { code: "already_submitted", state: "already_submitted" } }) });
  await find(page); await answer(page); await contact(page); await page.locator("#rsvp-submit").click();
  await expect(page.locator("#contact-title")).toBeVisible(); await expect(page.locator("#rsvp-errors")).toBeFocused();
  await page.locator("#rsvp-error-list a").click(); await expect(page.locator("#contactEmail")).toBeFocused();
  await page.locator("#contact-continue").click(); await page.locator("#rsvp-submit").click(); await expect(page.locator("#closed-title")).toBeVisible();
});

test("rate limiting gives a retry state without automatic request loops", async ({ page }) => {
  const calls = await install(page, { suggest: route => route.fulfill({ status: 429, json: { code: "rate_limited", message: "Please wait a minute before trying again." } }) });
  await page.getByRole("combobox").fill("lu"); await expect(page.locator("#retry-search")).toBeVisible();
  await page.locator("#retry-search").click(); expect(calls).toHaveLength(1);
  await expect(page.locator("#rsvp-status")).toContainText("wait a minute");
});

async function expectBalancedLayout(page) {
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('#rsvp .section-panel').getBoundingClientRect();
    const footer = document.querySelector('.footer').getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth > window.innerWidth, footerGap: footer.top - panel.bottom };
  });
  expect(layout.overflow).toBe(false);
  expect(layout.footerGap).toBeGreaterThanOrEqual(48);
}

async function expectGuestCards(page) {
  for (const card of await page.locator('.invitee-response').all()) {
    await expect(card).toHaveAccessibleName(await card.locator('.invitee-name').textContent());
    await expect(card.getByRole('group', { name: 'Are you able to attend our wedding?', exact: true })).toBeVisible();
    const layout = await card.evaluate(element => {
      const card = element.getBoundingClientRect(), name = element.querySelector('.invitee-name').getBoundingClientRect();
      const question = element.querySelector('.attendance-question').getBoundingClientRect();
      return {
        topPadding: name.top - card.top, leftPadding: name.left - card.left,
        rightPadding: card.right - name.right, nameGap: question.top - name.bottom,
        touchHeights: [...element.querySelectorAll('.attendance-options label')].map(label => label.getBoundingClientRect().height),
      };
    });
    expect(layout.topPadding).toBeGreaterThanOrEqual(16);
    expect(layout.leftPadding).toBeGreaterThanOrEqual(16);
    expect(layout.rightPadding).toBeGreaterThanOrEqual(16);
    expect(layout.nameGap).toBeGreaterThanOrEqual(12);
    for (const height of layout.touchHeights) expect(height).toBeGreaterThanOrEqual(48);
  }
}

for (const width of [320, 375, 390, 768, 1280]) test(`RSVP presentation through every step at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await install(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('RSVP');
  await expectBalancedLayout(page);
  await find(page);
  await expect(page.locator('#confirm-title')).toHaveText('Is this your party?');
  await expect(page.locator('#rsvp-progress')).toHaveText('Step 1 of 4 · Your invitation');
  expect(await page.locator('#confirm-title').evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
  await expectBalancedLayout(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: `node_modules/.cache/rsvp-confirm-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Yes, continue' }).click();
  await expect(page.locator('#rsvp-progress')).toHaveText('Step 2 of 4 · Your guests');
  await expectGuestCards(page);
  await expect(page.locator('#guests-title')).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.locator('#attendance-10')).toBeFocused();
  expect(await page.locator('#attendance-10').evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.keyboard.press('ArrowRight'); await expect(page.locator('#attendance-10-no')).toBeChecked();
  await page.keyboard.press('ArrowLeft'); await expect(page.locator('#attendance-10')).toBeChecked();
  await page.getByLabel('Select your meal preference', { exact: true }).first().selectOption('chicken');
  await expect(page.getByLabel('Any dietary restrictions or allergies? (optional)', { exact: true }).first()).toBeVisible();
  await page.locator('#attendance-11-no').check();
  await expectBalancedLayout(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: `node_modules/.cache/rsvp-guests-${width}.png`, fullPage: true });
  await page.locator('#guests-continue').click();
  await expect(page.getByRole('heading', { name: 'Where can we reach you?' })).toBeFocused();
  await expect(page.getByRole('group', { name: 'Where should we send mail for your party?' })).toBeVisible();
  for (const [id, label] of Object.entries({ contactEmail: 'What’s the best email to reach you?', addressLine1: 'Address',
    addressLine2: 'Apartment, suite or unit (optional)', city: 'City', provinceState: 'Province or state',
    postalCode: 'Postal or ZIP code', country: 'Country', message: 'Anything else you’d like us to know? (optional)' })) {
    await expect(page.locator(`#${id}`)).toHaveAccessibleName(label);
    expect(await page.locator(`#${id}`).evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  }
  await expectBalancedLayout(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: `node_modules/.cache/rsvp-contact-${width}.png`, fullPage: true });
  await contact(page);
  await expect(page.getByRole('heading', { name: 'Review your RSVP', exact: true })).toBeFocused();
  await expectBalancedLayout(page);
  await page.locator('#rsvp-submit').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('RSVP Received');
  await expect(page.locator('#success-title')).toBeFocused();
  await expect(page.locator('.rsvp-intro')).toBeHidden();
  await expect(page.locator('#rsvp-progress')).toBeHidden();
  await expect(page.locator('[data-step="success"] > p')).toHaveText([
    'Thank you for your RSVP.',
    'If you need any changes made, please contact Daniel or Colleen.',
  ]);
  expect(await page.locator('#success-title').evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
  const successLayout = await page.locator('[data-step="success"]').evaluate(element => {
    const heading = element.querySelector('h1').getBoundingClientRect();
    return { height: element.getBoundingClientRect().height, headingHeight: heading.height, headingWidth: heading.width };
  });
  expect(successLayout.height).toBeLessThan(320);
  if (width === 1280) expect(successLayout.headingHeight).toBeLessThan(70);
  await expectBalancedLayout(page);
  await page.screenshot({ path: `node_modules/.cache/rsvp-success-${width}.png`, fullPage: true });
});

test('single guest card renders with its complete hierarchy inside the border', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const single = [{ id: 10, name: 'Sam Czmielewski' }];
  await install(page, { lookup: route => route.fulfill({ json: { ...invitation, party: { ...invitation.party, guests: single } } }) });
  await find(page); await page.getByRole('button', { name: 'Yes, continue' }).click();
  await page.locator('#attendance-10').check();
  await expectGuestCards(page);
  await expect(page.locator('.invitee-response')).toContainText('Sam Czmielewski');
  await expect(page.getByLabel('Select your meal preference')).toBeVisible();
  await expect(page.getByLabel('Any dietary restrictions or allergies? (optional)')).toBeVisible();
  await expectBalancedLayout(page);
  await page.screenshot({ path: 'node_modules/.cache/rsvp-single-guest-390.png', fullPage: true });
});

for (const width of [320, 375, 390, 768, 1280]) test(`long invitation fits ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const family = Array.from({ length: 9 }, (_, i) => ({ id: 100 + i, name: `Synthetic Family Member ${i + 1} With A Long Surname` }));
  await install(page, { lookup: route => route.fulfill({ json: { ...invitation, party: { ...invitation.party, guests: family } } }) });
  await find(page); await page.getByRole("button", { name: "Yes, continue" }).click();
  await expect(page.locator(".invitee-response")).toHaveCount(9);
  await expectGuestCards(page);
  await expectBalancedLayout(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (width === 1280) await page.screenshot({ path: "node_modules/.cache/rsvp-guests-desktop.png", fullPage: true });
});
