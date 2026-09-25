import { normalizeName, meaningfulQuery, suggestNames } from "./normalize.js";
import { handleAdminRequest } from "./admin.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const LIMITS = { name: 120, publicId: 100, email: 254, line1: 200, line2: 100, city: 100, region: 100, postal: 32, country: 100, dietary: 500, message: 2000, honeypot: 200 };
const CLOSED_MESSAGE = "This party has already RSVPed. To make a change, please contact Daniel or Colleen.";
const reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
const clean = value => typeof value === "string" ? value.trim() : "";
export class ApiError extends Error {
  constructor(message, status = 400, code = "invalid_request", fields = {}) {
    super(message); this.status = status; this.code = code; this.fields = fields;
  }
}
const alreadySubmitted = () => new ApiError(CLOSED_MESSAGE, 409, "already_submitted");
const invalidField = (key, message) => new ApiError(message, 400, "validation_error", { [key]: message });
function field(body, key, max, required = false) {
  if (body[key] != null && typeof body[key] !== "string") throw invalidField(key, "Please enter text in this field.");
  const value = clean(body[key]);
  if (required && !value) throw invalidField(key, "Please complete this field.");
  if (value.length > max) throw invalidField(key, `Please use ${max} characters or fewer.`);
  return value;
}

export class D1Repository {
  constructor(db) { this.db = db; }
  async suggest(query) {
    const rows = await this.db.prepare("SELECT full_name FROM guests").all();
    return suggestNames(rows.results.map(row => row.full_name), query);
  }
  async lookup(normalized) {
    const matches = await this.db.prepare("SELECT party_id FROM guests WHERE normalized_name=? LIMIT 2").bind(normalized).all();
    if (matches.results.length !== 1) return null;
    return this.readParty("p.id", matches.results[0].party_id);
  }
  async byPublicId(publicId) { return this.readParty("p.public_id", publicId); }
  async readParty(column, value) {
    // column is an internal constant. No saved response fields are selected.
    const result = await this.db.prepare(`SELECT p.id party_id, p.public_id, g.id guest_id, g.full_name,
      EXISTS(SELECT 1 FROM party_rsvps pr WHERE pr.party_id=p.id) submitted
      FROM parties p JOIN guests g ON g.party_id=p.id WHERE ${column}=? ORDER BY g.display_order`).bind(value).all();
    if (!result.results.length) return null;
    const first = result.results[0];
    return { id: first.party_id, publicId: first.public_id, submitted: Boolean(first.submitted),
      guests: result.results.map(row => ({ id: row.guest_id, name: row.full_name })) };
  }
  async save(party, data, now) {
    // The unique party_id INSERT is first. A failed D1 batch rolls back every
    // statement, so a competing submission cannot overwrite any guest response.
    const statements = [this.db.prepare(`INSERT INTO party_rsvps
      (party_id,contact_email,mailing_address_line1,mailing_address_line2,mailing_city,mailing_province_state,mailing_postal_code,mailing_country,message,submitted_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(party.id, data.email, data.line1, data.line2 || null,
      data.city, data.region, data.postal, data.country, data.message || null, now, now)];
    for (const guest of data.guests) statements.push(this.db.prepare(`INSERT INTO guest_rsvps
      (guest_id,attending,dinner_choice,dietary_restrictions,updated_at) VALUES (?,?,?,?,?)`)
      .bind(guest.id, guest.attending, guest.dinner, guest.dietary || null, now));
    try { await this.db.batch(statements); }
    catch (error) {
      // D1 wraps constraint errors. Check the post-failure state rather than
      // depending on error text. Unrelated failures with no saved party stay 500.
      const existing = await this.db.prepare("SELECT party_id FROM party_rsvps WHERE party_id=?").bind(party.id).first();
      if (existing) throw alreadySubmitted();
      throw error;
    }
  }
}

async function verifyTurnstile(token, request, env) {
  if (!token || typeof token !== "string" || token.length > 2048) return false;
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET_KEY || ""); form.set("response", token);
  const ip = request.headers.get("CF-Connecting-IP"); if (ip) form.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  return response.ok && Boolean((await response.json()).success);
}
async function limited(binding, key) {
  if (!binding) return false;
  return !(await binding.limit({ key })).success;
}
async function jsonBody(request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new ApiError("Invalid request.");
  try {
    const body = await request.json();
    if (!body || Array.isArray(body) || typeof body !== "object") throw new Error();
    return body;
  } catch { throw new ApiError("Invalid request."); }
}
export function createHandler(overrides = {}) {
  return async (request, env) => {
    try {
      const path = new URL(request.url).pathname;
      if (path.startsWith("/api/admin/")) return await handleAdminRequest(request, env, overrides);
      if (request.method !== "POST" || !["/api/rsvp/suggest", "/api/rsvp/lookup", "/api/rsvp/submit"].includes(path)) return reply({ message: "Not found." }, 404);
      const isSuggest = path.endsWith("/suggest"), isLookup = path.endsWith("/lookup"), isSearch = isSuggest || isLookup;
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      if (await (overrides.limited || limited)(isSearch ? env.LOOKUP_RATE_LIMITER : env.SUBMIT_RATE_LIMITER, `${isSearch ? "l" : "s"}:${ip}`)) {
        return reply({ code: "rate_limited", message: "Please wait a minute before trying again." }, 429, { "retry-after": "60" });
      }
      const body = await jsonBody(request);
      if (field(body, "website", LIMITS.honeypot)) throw new ApiError("Unable to process this request.");
      const repo = overrides.repository || new D1Repository(env.DB);
      if (isSuggest) {
        const query = field(body, "name", LIMITS.name, true);
        if (!meaningfulQuery(query)) return reply({ names: [], hasMore: false });
        const result = await repo.suggest(query);
        return reply({ names: result.names.slice(0, 8), hasMore: Boolean(result.hasMore) });
      }
      if (!await (overrides.verifyTurnstile || verifyTurnstile)(body.turnstileToken, request, env)) {
        throw new ApiError("We couldn't complete the security check. Please try again.", 400, "verification_failed");
      }
      if (isLookup) {
        const normalized = normalizeName(field(body, "name", LIMITS.name, true));
        const party = normalized ? await repo.lookup(normalized) : null;
        if (!party) throw new ApiError("We couldn't open that invitation. Please try the name on your invitation, or contact Daniel or Colleen.", 404, "invitation_unavailable");
        if (party.submitted) return reply({ state: "already_submitted" });
        return reply({ state: "unanswered", party: { publicId: party.publicId,
          guests: party.guests.map(guest => ({ id: guest.id, name: guest.name })) } });
      }
      const party = await repo.byPublicId(field(body, "partyId", LIMITS.publicId, true));
      if (!party) throw new ApiError("Unable to open that invitation.", 404, "invitation_unavailable");
      if (party.submitted) throw alreadySubmitted();
      if (!Array.isArray(body.guests)) throw new ApiError("Please answer for every guest.");
      const expected = new Set(party.guests.map(guest => guest.id)), seen = new Set();
      const guests = body.guests.map(guest => {
        if (!guest || typeof guest !== "object" || !Number.isInteger(guest.id) || !expected.has(guest.id) || seen.has(guest.id)) throw new ApiError("Invalid guest response.");
        seen.add(guest.id);
        if (!["yes", "no"].includes(guest.attending)) throw invalidField(`attendance-${guest.id}`, "Please choose Yes or No.");
        if (guest.dinnerChoice != null && typeof guest.dinnerChoice !== "string") throw invalidField(`dinner-${guest.id}`, "Please choose a dinner option.");
        const dinner = clean(guest.dinnerChoice);
        if (guest.attending === "yes" && !["beef", "chicken", "vegetarian"].includes(dinner)) throw invalidField(`dinner-${guest.id}`, "Please choose a dinner option.");
        if (guest.attending === "no" && dinner) throw invalidField(`dinner-${guest.id}`, "A declining guest cannot have a dinner selection.");
        if (guest.dietaryRestrictions != null && typeof guest.dietaryRestrictions !== "string") throw invalidField(`dietary-${guest.id}`, "Please enter text in this field.");
        const dietary = clean(guest.dietaryRestrictions);
        if (dietary.length > LIMITS.dietary) throw invalidField(`dietary-${guest.id}`, "Please use 500 characters or fewer.");
        return { id: guest.id, attending: guest.attending, dinner: guest.attending === "yes" ? dinner : null,
          dietary: guest.attending === "yes" ? dietary : "" };
      });
      if (seen.size !== expected.size) throw new ApiError("Please answer for every guest.");
      const data = { guests, email: field(body, "contactEmail", LIMITS.email, true), line1: field(body, "addressLine1", LIMITS.line1, true),
        line2: field(body, "addressLine2", LIMITS.line2), city: field(body, "city", LIMITS.city, true),
        region: field(body, "provinceState", LIMITS.region, true), postal: field(body, "postalCode", LIMITS.postal, true),
        country: field(body, "country", LIMITS.country, true), message: field(body, "message", LIMITS.message) };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw invalidField("contactEmail", "Please enter a valid email address.");
      await repo.save(party, data, new Date().toISOString());
      return reply({ state: "submitted", message: "Your RSVP has been saved." });
    } catch (error) {
      if (error instanceof ApiError) return reply({ code: error.code, ...(error.code === "already_submitted" ? { state: error.code } : {}),
        message: error.message, ...(Object.keys(error.fields).length ? { fields: error.fields } : {}) }, error.status);
      console.error("RSVP request failed", { error: error?.name || "Error" });
      return reply({ code: "unavailable", message: "We couldn't save your RSVP. Please try again." }, 500);
    }
  };
}
export default { fetch: createHandler() };
