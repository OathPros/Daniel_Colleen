import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createPreviewServer, previewOrigin } from "../scripts/preview-server.mjs";

const upstream = "https://daniel-colleen-rsvp-preview.synthetic-account.workers.dev";
async function serverFor(t, options = {}) {
  const server = createPreviewServer(options); server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
test("upstream is restricted to preview Worker HTTPS origins", () => {
  assert.equal(previewOrigin(upstream), upstream);
  for (const url of [undefined, "http://daniel-colleen-rsvp-preview.a.workers.dev", "https://www.daniel-and-colleen.com",
    "https://daniel-colleen-rsvp-prod.a.workers.dev", "https://daniel-colleen-rsvp-preview.a.workers.dev.attacker.test",
    `${upstream}/api`, `${upstream}?q=1`, `${upstream}:444`, "https://user:secret@daniel-colleen-rsvp-preview.a.workers.dev"]) {
    assert.throws(() => previewOrigin(url));
  }
});
test("serves only explicit public files; private paths cannot be read", async t => {
  const origin = await serverFor(t);
  for (const path of ["/rsvp.html", "/assets/js/rsvp.js", "/assets/css/rsvp.css"]) assert.equal((await fetch(origin + path)).status, 200);
  // Only requests a nonexistent synthetic private path; never reads real CSV data.
  for (const path of ["/private/synthetic.private.csv", "/.env", "/.git/config", "/wrangler.jsonc", "/worker/src/index.js", "/scripts/import-guests.mjs", "/assets/"]) {
    assert.equal((await fetch(origin + path)).status, 404);
  }
});
test("proxies exact RSVP POST paths only, dropping credentials and forwarding headers", async t => {
  const calls = [], origin = await serverFor(t, { upstream, fetchImpl: async (...args) => {
    calls.push(args); return new Response('{"names":[],"hasMore":false}', { headers: { "content-type": "application/json" } });
  } });
  const init = { method: "POST", headers: { origin, "content-type": "application/json", cookie: "private=must-not-forward", "cf-connecting-ip": "1.2.3.4" }, body: '{"name":"Synthetic"}' };
  assert.equal((await fetch(`${origin}/api/rsvp/suggest`, init)).status, 200);
  assert.equal(calls[0][0], `${upstream}/api/rsvp/suggest`);
  assert.deepEqual(calls[0][1].headers, { "content-type": "application/json" });
  assert.equal(calls[0][1].redirect, "manual");
  assert.equal((await fetch(`${origin}/api/rsvp/export`, init)).status, 404);
  assert.equal((await fetch(`${origin}/api/rsvp/suggest`)).status, 405);
  assert.equal((await fetch(`${origin}/api/rsvp/suggest?upstream=production`, init)).status, 400);
  assert.equal((await fetch(`${origin}/api/rsvp/suggest`, { ...init, headers: { ...init.headers, origin: "https://foreign.test" } })).status, 403);
  assert.equal(calls.length, 1);
});
test("redirects, missing upstream, and oversized requests fail closed", async t => {
  let calls = 0;
  const origin = await serverFor(t, { upstream, fetchImpl: async () => {
    calls++; return new Response(null, { status: 302, headers: { location: "https://production.invalid" } });
  } });
  const init = { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" };
  assert.equal((await fetch(`${origin}/api/rsvp/lookup`, init)).status, 502);
  assert.equal((await fetch(`${origin}/api/rsvp/submit`, { ...init, body: "x".repeat(33000) })).status, 413);
  assert.equal(calls, 1);
  const offline = await serverFor(t);
  assert.equal((await fetch(`${offline}/api/rsvp/suggest`, { ...init, headers: { ...init.headers, origin: offline } })).status, 503);
});
