import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { D1Repository } from "../worker/src/index.js";
import { setup, valid } from "./helpers/rsvp-fixtures.js";

// Real local D1 binding and batch semantics. No wrangler config, persistence,
// remote database, guest CSV, or Cloudflare credentials are used.
let runtime, db;
before(async () => {
  runtime = new Miniflare({ cf: false, telemetry: { enabled: false }, workers: [{
    config: { name: "rsvp-local-test", type: "worker", compatibilityDate: "2026-09-01",
      manifest: { mainModule: "test.js", modules: { "test.js": { type: "esm", contents: "export default { fetch() { return new Response('local test'); } }" } } },
      env: { DB: { type: "d1", id: "synthetic-local-only", dev: { remote: false } } } },
    dev: { unsafeRegisterWorker: false, outboundService: { type: "fetcher", handler: () => { throw new Error("External network disabled in D1 tests"); } } }
  }] });
  db = await runtime.getD1Database("DB");
  const schema = await readFile(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
  for (const sql of schema.split(";").filter(sql => sql.trim())) await db.prepare(sql).run();
});
after(async () => { await runtime?.dispose(); });
beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM guest_rsvps"), db.prepare("DELETE FROM party_rsvps"), db.prepare("DELETE FROM guests"), db.prepare("DELETE FROM parties"),
    db.prepare("INSERT INTO parties(id,public_id,party_number,party_name,created_at) VALUES(1,?,1,'Synthetic household','2026-01-01')").bind(valid().partyId),
    db.prepare("INSERT INTO guests(id,party_id,full_name,normalized_name,display_order,created_at) VALUES(10,1,'Luca Example','luca example',0,'2026-01-01'),(11,1,'Taylor Example','taylor example',1,'2026-01-01')")
  ]);
});
test("D1 suggestions and lookup use existing schema", async () => {
  const repo = new D1Repository(db);
  assert.deepEqual(await repo.suggest("luc ex"), { names: ["Luca Example"], hasMore: false });
  const party = await repo.lookup("luca example"); assert.equal(party.submitted, false); assert.equal(party.guests.length, 2);
});
test("D1 duplicate normalized identities cannot open an invitation", async () => {
  await db.prepare("INSERT INTO guests(id,party_id,full_name,normalized_name,display_order,created_at) VALUES(12,1,'Luca Example','luca example',2,'2026-01-01')").run();
  assert.equal(await new D1Repository(db).lookup("luca example"), null);
});
test("D1 races have one winner, 409 loser, and no guest overwrite", async () => {
  const repo = new D1Repository(db), read = repo.byPublicId.bind(repo);
  let arrivals = 0, release; const barrier = new Promise(resolve => { release = resolve; });
  repo.byPublicId = async id => {
    const party = await read(id); if (++arrivals === 2) release(); await barrier; return party;
  };
  const { call } = setup({ repo }), first = valid(), second = valid();
  second.contactEmail = "competitor@example.test"; second.guests[0].dinnerChoice = "beef";
  const responses = await Promise.all([call("submit", first), call("submit", second)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const winner = responses[0].status === 200 ? first : second;
  assert.equal((await db.prepare("SELECT contact_email FROM party_rsvps").first()).contact_email, winner.contactEmail);
  assert.equal((await db.prepare("SELECT dinner_choice FROM guest_rsvps WHERE guest_id=10").first()).dinner_choice, winner.guests[0].dinnerChoice);
  assert.equal((await db.prepare("SELECT count(*) total FROM guest_rsvps").first()).total, 2);
  assert.deepEqual(await (await call("lookup", { name: "Luca Example", turnstileToken: "ok" })).json(), { state: "already_submitted" });
  repo.byPublicId = read;
  assert.equal((await call("submit", second)).status, 409);
});
test("D1 failure after party insert rolls back the entire batch", async () => {
  const repo = new D1Repository(db), party = await repo.lookup("luca example");
  await assert.rejects(repo.save(party, { email: "test@example.test", line1: "1 Test", line2: "", city: "Test", region: "Test", postal: "Test", country: "Test", message: "",
    guests: [{ id: 10, attending: "yes", dinner: "chicken", dietary: "" }, { id: 999, attending: "no", dinner: null, dietary: "" }] }, "2026-01-01"));
  assert.equal((await db.prepare("SELECT count(*) total FROM party_rsvps").first()).total, 0);
  assert.equal((await db.prepare("SELECT count(*) total FROM guest_rsvps").first()).total, 0);
});
