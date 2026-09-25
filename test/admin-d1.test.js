import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { createHandler } from "../worker/src/index.js";

let runtime, db, handler;
const call = (path, method = "GET", data, authenticated = true) => handler(new Request(`https://synthetic.test/api/admin/${path}`, {
  method, headers: { ...(data ? { "content-type": "application/json" } : {}), ...(authenticated ? { "x-test-admin": "yes" } : {}) }, body: data ? JSON.stringify(data) : undefined
}), { DB: db });
before(async () => {
  runtime = new Miniflare({ cf: false, telemetry: { enabled: false }, workers: [{ config: { name: "admin-local-test", type: "worker", compatibilityDate: "2026-09-01", manifest: { mainModule: "test.js", modules: { "test.js": { type: "esm", contents: "export default { fetch() { return new Response('test'); } }" } } }, env: { DB: { type: "d1", id: "admin-local", dev: { remote: false } } } } }] });
  db = await runtime.getD1Database("DB");
  const schema = await readFile(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
  for (const sql of schema.split(";").filter(value => value.trim())) await db.prepare(sql).run();
  handler = createHandler({ adminAuthenticated: request => request.headers.get("x-test-admin") === "yes" });
});
after(async () => runtime?.dispose());
beforeEach(async () => db.batch([db.prepare("DELETE FROM guest_rsvps"), db.prepare("DELETE FROM party_rsvps"), db.prepare("DELETE FROM guests"), db.prepare("DELETE FROM parties")]));

test("all roster endpoints require an admin session", async () => {
  for (const [path, method, data] of [["parties", "GET"], ["export", "GET"], ["parties", "POST", { name: "Test", guests: ["One"] }], ["parties/1", "PATCH", { name: "New" }], ["parties/1", "DELETE"], ["parties/1/guests", "POST", { name: "Two" }], ["guests/1", "PATCH", { name: "New" }], ["guests/1", "DELETE"], ["parties/1/guest-order", "PATCH", { guestIds: [1] }]]) assert.equal((await call(path, method, data, false)).status, 401);
});
test("party and guest roster lifecycle preserves and removes responses correctly", async () => {
  const created = await call("parties", "POST", { name: "Example Party", guests: ["Alpha Example", "Beta Example"] });
  assert.equal(created.status, 201); const party = (await created.json()).party;
  assert.match(party.publicId, /^[A-Za-z0-9_-]{32}$/);
  await call(`parties/${party.id}`, "PATCH", { name: "Renamed Party" });
  let rows = (await (await call("parties")).json()).parties; assert.equal(rows[0].name, "Renamed Party");
  const originalId = rows[0].guests[0].id;
  await db.prepare("INSERT INTO party_rsvps VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(party.id,"x@example.test","1 Way",null,"City","ON","A1A","Canada","hello","2026","2026").run();
  await db.prepare("INSERT INTO guest_rsvps VALUES(?,?,?,?,?)").bind(originalId,"yes","beef","none","2026").run();
  await call(`guests/${originalId}`, "PATCH", { name: "Gamma Example" });
  assert.equal((await db.prepare("SELECT normalized_name FROM guests WHERE id=?").bind(originalId).first()).normalized_name, "gamma example");
  assert.equal((await db.prepare("SELECT dinner_choice FROM guest_rsvps WHERE guest_id=?").bind(originalId).first()).dinner_choice, "beef");
  await call(`parties/${party.id}/guests`, "POST", { name: "Delta Example" });
  rows = (await (await call("parties")).json()).parties; const ids = rows[0].guests.map(guest => guest.id);
  assert.equal(rows[0].guests.at(-1).response, null);
  const reordered = await call(`parties/${party.id}/guest-order`, "PATCH", { guestIds: ids.toReversed() });
  assert.equal(reordered.status, 200, await reordered.text());
  assert.deepEqual((await (await call("parties")).json()).parties[0].guests.map(guest => guest.id), ids.toReversed());
  const exported = await call("export"); assert.equal(exported.status, 200); assert.match(await exported.text(), /Renamed Party.*Gamma Example/);
  assert.equal((await call(`guests/${originalId}`, "DELETE")).status, 200);
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM guest_rsvps").first()).count, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM party_rsvps").first()).count, 1);
  assert.equal((await call(`parties/${party.id}`, "DELETE")).status, 200);
  for (const table of ["parties", "guests", "party_rsvps", "guest_rsvps"]) assert.equal((await db.prepare(`SELECT COUNT(*) count FROM ${table}`).first()).count, 0);
});
test("last guest removal and ambiguous normalized names are blocked", async () => {
  const party = (await (await call("parties", "POST", { name: "Solo", guests: ["Solo Person"] })).json()).party;
  const guest = (await (await call("parties")).json()).parties[0].guests[0];
  assert.equal((await call(`guests/${guest.id}`, "DELETE")).status, 409);
  assert.equal((await call(`parties/${party.id}/guests`, "POST", { name: "Sóló Person" })).status, 409);
});
