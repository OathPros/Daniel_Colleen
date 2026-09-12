import { ApiError, createHandler } from "../../worker/src/index.js";
import { normalizeName, suggestNames } from "../../worker/src/normalize.js";

export const fixtureNames = ["Luca Example", "Luis Sample", "Luanne Fiction", "Taylor Example"];
export function memoryRepo({ existing = false, ambiguous = false } = {}) {
  const party = { id: 1, publicId: "synthetic-public-id-0123456789abcdef", submitted: existing,
    guests: [{ id: 10, name: "Luca Example" }, { id: 11, name: "Taylor Example" }] };
  return { party, saves: [], async suggest(query) { return suggestNames(fixtureNames, query); },
    async lookup(name) { return !ambiguous && name === normalizeName("Luca Example") ? party : null; },
    async byPublicId(id) { return id === party.publicId ? party : null; },
    async save(...args) {
      if (party.submitted) throw new ApiError("Already submitted.", 409, "already_submitted");
      party.submitted = true; this.saves.push(args);
    }
  };
}
export const valid = (repo = memoryRepo()) => ({
  partyId: repo.party.publicId, contactEmail: "person@example.test", addressLine1: "1 Test Way", addressLine2: "",
  city: "Ottawa", provinceState: "ON", postalCode: "A1A 1A1", country: "Canada", message: "Synthetic note",
  website: "", turnstileToken: "ok", guests: [
    { id: 10, attending: "yes", dinnerChoice: "chicken", dietaryRestrictions: "Synthetic dietary note" },
    { id: 11, attending: "no" }
  ]
});
export function setup(options = {}) {
  const repo = options.repo || memoryRepo(options);
  const handler = createHandler({ repository: repo, verifyTurnstile: async token => token === "ok", limited: async () => false, ...options.overrides });
  return { repo, call: (path, body, init = {}) => handler(new Request(`https://synthetic.test/api/rsvp/${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body), ...init
  }), {}) };
}
