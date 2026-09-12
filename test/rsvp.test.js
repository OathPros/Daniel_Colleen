import test from "node:test";
import assert from "node:assert/strict";
import { normalizeName } from "../worker/src/normalize.js";
import { meaningfulQuery, matchesName, suggestNames, narrowsQuery } from "../assets/js/rsvp-search.js";
import { memoryRepo, setup, valid } from "./helpers/rsvp-fixtures.js";

test("authoritative import normalization remains unchanged", () => assert.equal(normalizeName("  Àlex—O’Neil "), "alex o'neil"));
for (const query of ["lu", "LU", "  lú  ", "luc", "exa", "luc exa", "exa luc"]) {
  test(`predictable prefix: ${query}`, () => assert.ok(matchesName("Luca Example", query)));
}
for (const [name, query] of [["Anne-Marie O’Neill", "anne mar o'ne"], ["Anne-Marie O’Neill", "annemarie one"],
  ["Anne Marie O'Neill", "anne-marie o’ne"], ["Luca Example", "  luc   exa  "], ["Zoë Fiction", "zoe fic"]]) {
  test(`search punctuation/spacing: ${query}`, () => assert.ok(matchesName(name, query)));
}
test("no fuzzy, substring, nickname guessing, or repeated token reuse", () => {
  for (const query of ["lcu", "uca", "luke", "luc lu"]) assert.equal(matchesName("Luca Example", query), false);
});
test("two meaningful characters required", () => {
  for (const query of ["", " ' - ", "l", " l -- "]) assert.equal(meaningfulQuery(query), false);
  assert.deepEqual(suggestNames(["Luca Example"], " l - "), { names: [], hasMore: false });
});
test("results are deduplicated, limited and indicate more without pagination", () => {
  const names = Array.from({ length: 12 }, (_, i) => `Example Person ${i}`);
  assert.equal(suggestNames(names, "ex").names.length, 8);
  assert.equal(suggestNames(names, "ex").hasMore, true);
  assert.deepEqual(suggestNames(["Luca Example", "Luca Example"], "lu"), { names: ["Luca Example"], hasMore: false });
  assert.deepEqual(suggestNames(names, "unknown"), { names: [], hasMore: false });
});
test("cache narrowing requires equal token count and prefix refinement", () => {
  assert.ok(narrowsQuery("lu", "luc")); assert.ok(narrowsQuery("lu ex", "luca exam"));
  assert.equal(narrowsQuery("luc", "lu"), false); assert.equal(narrowsQuery("lu", "lu ex"), false);
});
test("suggestions are names only and do not verify Turnstile", async () => {
  const { call } = setup({ overrides: { verifyTurnstile: () => { throw new Error("Must not verify suggestions"); } } });
  const response = await call("suggest", { name: "lu" });
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json(); assert.deepEqual(Object.keys(result), ["names", "hasMore"]);
  assert.ok(result.names.every(name => typeof name === "string")); assert.equal(result.names.length, 3);
});
test("lookup uses selected full name and an explicit field allowlist", async () => {
  const repo = memoryRepo(); repo.party.rsvp = { contactEmail: "private@example.test" };
  repo.party.guests[0].dietaryRestrictions = "must not escape";
  const { call } = setup({ repo });
  const response = await call("lookup", { name: "  LUCA  Example ", turnstileToken: "ok" });
  assert.deepEqual(await response.json(), { state: "unanswered", party: { publicId: repo.party.publicId,
    guests: [{ id: 10, name: "Luca Example" }, { id: 11, name: "Taylor Example" }] } });
});
test("unknown, partial, and ambiguous lookup have identical generic responses", async () => {
  const results = [];
  for (const [options, name] of [[{}, "Unknown Person"], [{}, "lu"], [{ ambiguous: true }, "Luca Example"]]) {
    const response = await setup(options).call("lookup", { name, turnstileToken: "ok" });
    assert.equal(response.status, 404); results.push(await response.json());
  }
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[1], results[2]);
});
test("answered invitation returns only terminal state", async () => {
  const response = await setup({ existing: true }).call("lookup", { name: "Luca Example", turnstileToken: "ok" });
  assert.deepEqual(await response.json(), { state: "already_submitted" });
});
test("first submission uses server time and omits declining private details", async () => {
  const { repo, call } = setup(); const body = valid(repo); body.guests[1].dietaryRestrictions = "discard me";
  assert.equal((await call("submit", body)).status, 200);
  assert.equal(repo.saves.length, 1); assert.match(repo.saves[0][2], /^\d{4}-/);
  assert.equal(repo.saves[0][1].guests[1].dinner, null); assert.equal(repo.saves[0][1].guests[1].dietary, "");
});
test("repeat and concurrent submissions return 409", async () => {
  const { repo, call } = setup();
  const responses = await Promise.all([call("submit", valid(repo)), call("submit", valid(repo))]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]); assert.equal(repo.saves.length, 1);
  const repeat = await call("submit", valid(repo));
  assert.equal(repeat.status, 409); assert.equal((await repeat.json()).code, "already_submitted");
});
for (const [title, mutate, status] of [
  ["unknown party", b => b.partyId = "wrong", 404], ["foreign guest", b => b.guests[0].id = 999, 400],
  ["duplicate guest", b => b.guests[1].id = 10, 400], ["missing guest", b => b.guests.pop(), 400],
  ["missing attendance", b => delete b.guests[0].attending, 400], ["invalid attendance", b => b.guests[0].attending = "maybe", 400],
  ["missing dinner", b => delete b.guests[0].dinnerChoice, 400], ["invalid dinner", b => b.guests[0].dinnerChoice = "fish", 400],
  ["declining dinner", b => b.guests[1].dinnerChoice = "beef", 400], ["dinner object", b => b.guests[0].dinnerChoice = {}, 400],
  ["dietary object", b => b.guests[0].dietaryRestrictions = {}, 400], ["long dietary", b => b.guests[0].dietaryRestrictions = "x".repeat(501), 400],
  ["email", b => b.contactEmail = "bad", 400], ["email object", b => b.contactEmail = {}, 400],
  ["long message", b => b.message = "x".repeat(2001), 400], ["guest array object", b => b.guests = {}, 400],
]) test(`rejects ${title}`, async () => {
  const { repo, call } = setup(), body = valid(repo); mutate(body);
  assert.equal((await call("submit", body)).status, status); assert.equal(repo.saves.length, 0);
});
test("required contact fields produce linked field errors", async () => {
  for (const key of ["contactEmail", "addressLine1", "city", "provinceState", "postalCode", "country"]) {
    const { repo, call } = setup(), body = valid(repo); body[key] = "  ";
    const response = await call("submit", body); assert.equal(response.status, 400);
    assert.ok((await response.json()).fields[key]);
  }
});
test("honeypot applies to every endpoint", async () => {
  for (const path of ["suggest", "lookup", "submit"]) assert.equal((await setup().call(path, { ...valid(), name: "lu", website: "bot" })).status, 400);
});
test("lookup and submission always require Turnstile", async () => {
  for (const path of ["lookup", "submit"]) for (const token of [undefined, "bad", {}]) {
    const response = await setup().call(path, { ...valid(), name: "Luca Example", turnstileToken: token });
    assert.equal(response.status, 400); assert.equal((await response.json()).code, "verification_failed");
  }
});
test("malformed body, content type, name type and length rejected", async () => {
  for (const body of ["{bad", "null", "[]", { name: {} }, { name: "x".repeat(121) }]) assert.equal((await setup().call("suggest", body)).status, 400);
  assert.equal((await setup().call("suggest", { name: "lu" }, { headers: { "content-type": "text/plain" } })).status, 400);
});
test("suggest and lookup share rate limiter key; submit uses its own", async () => {
  const keys = [], { call } = setup({ overrides: { limited: async (_binding, key) => { keys.push(key); return true; } } });
  for (const path of ["suggest", "lookup", "submit"]) {
    const response = await call(path, {}); assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60");
  }
  assert.deepEqual(keys, ["l:unknown", "l:unknown", "s:unknown"]);
});
