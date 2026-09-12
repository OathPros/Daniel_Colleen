import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pages = ["index", "schedule", "travel", "venue", "story", "faq", "registry", "rsvp"];

test("every page uses the shared favicon and clean internal links", async () => {
  for (const page of pages) {
    const html = await readFile(new URL(`../${page}.html`, import.meta.url), "utf8");
    assert.match(html, /<link rel="icon" type="image\/png" href="assets\/favicon\.png" \/>/);
    assert.doesNotMatch(html, /href="(?:index|schedule|travel|venue|story|faq|registry|rsvp)\.html(?:[?#"])/);
  }
});
