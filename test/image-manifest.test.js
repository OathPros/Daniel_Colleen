import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { buildImageManifest, createImageManifest, serializeManifest } from "../scripts/build-image-manifest.mjs";

async function fixture(files) {
  const root = await mkdtemp(resolve(tmpdir(), "wedding-images-"));
  for (const [name, contents = "test fixture"] of Object.entries(files)) {
    const path = resolve(root, name);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, contents);
  }
  return root;
}

async function withFixture(files, callback) {
  const root = await fixture(files);
  try { await callback(root); } finally { await rm(root, { recursive: true, force: true }); }
}

const names = (manifest, collection = "home/hero") => manifest.collections[collection].map(({ src }) => src.split("/").pop());

test("discovers supported formats, ignores unrelated files, and generates web paths", async () => {
  await withFixture({
    "home/hero/01.webp": "", "home/hero/02.JPG": "", "home/hero/03.jpeg": "",
    "home/hero/04.png": "", "home/hero/05.avif": "", "home/hero/.hidden.jpg": "",
    "home/hero/README.md": "", "home/hero/Thumbs.db": "", "home/hero/movie.gif": "",
  }, async (root) => {
    const manifest = await createImageManifest({ imagesRoot: root });
    assert.deepEqual(names(manifest), ["01.webp", "02.JPG", "03.jpeg", "04.png", "05.avif"]);
    assert.equal(manifest.collections["home/hero"][0].src, "assets/images/home/hero/01.webp");
  });
});

test("naturally orders one, multiple, 10+, and all 99 supported hero images", async () => {
  const files = {};
  for (let index = 99; index >= 1; index--) files[`home/hero/${index}.webp`] = "";
  await withFixture(files, async (root) => {
    const manifest = await createImageManifest({ imagesRoot: root });
    assert.equal(names(manifest).length, 99);
    assert.deepEqual(names(manifest).slice(0, 12), Array.from({ length: 12 }, (_, index) => `${index + 1}.webp`));
    assert.equal(names(manifest).at(-1), "99.webp");
  });
  await withFixture({ "home/hero/01.webp": "" }, async (root) => {
    assert.deepEqual(names(await createImageManifest({ imagesRoot: root })), ["01.webp"]);
  });
});

test("applies optional metadata defaults and warns about stale metadata", async () => {
  const config = JSON.stringify({ "01.webp": { position: "center 30%", alt: "A useful description" }, "deleted.webp": { position: "left" } });
  await withFixture({ "home/hero/01.webp": "", "home/hero/02.webp": "", "home/hero/hero.config.json": config }, async (root) => {
    const manifest = await createImageManifest({ imagesRoot: root });
    assert.deepEqual(manifest.collections["home/hero"][0], { src: "assets/images/home/hero/01.webp", position: "center 30%", alt: "A useful description" });
    assert.equal(manifest.collections["home/hero"][1].position, "center");
    assert.match(manifest.warnings.join("\n"), /deleted\.webp/);
  });
});

test("represents configured empty collections and output is deterministic", async () => {
  await withFixture({ "home/hero/hero.config.json": "{}" }, async (root) => {
    const first = await createImageManifest({ imagesRoot: root });
    const second = await createImageManifest({ imagesRoot: root });
    assert.deepEqual(first.collections["home/hero"], []);
    assert.match(first.warnings[0], /empty/);
    assert.equal(serializeManifest(first), serializeManifest(second));
  });
});

test("check mode detects stale output and accepts regenerated output", async () => {
  await withFixture({ "home/hero/01.webp": "" }, async (root) => {
    const output = resolve(root, "manifest.js");
    await assert.rejects(buildImageManifest({ imagesRoot: root, output, check: true }), /stale/);
    await buildImageManifest({ imagesRoot: root, output });
    const generated = await readFile(output, "utf8");
    assert.match(generated, /AUTO-GENERATED/);
    await buildImageManifest({ imagesRoot: root, output, check: true });
  });
});
