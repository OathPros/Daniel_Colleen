import { normalizeName } from "./normalize.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const LIMITS = { name: 120, publicId: 100, email: 254, line1: 200, line2: 100, city: 100, region: 100, postal: 32, country: 100, dietary: 500, message: 2000, honeypot: 200 };

const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const clean = (value) => typeof value === "string" ? value.trim() : "";
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const field = (body, key, max, required = false) => {
  if (body[key] != null && typeof body[key] !== "string") throw new ApiError("Invalid RSVP details.");
  const value = clean(body[key]);
  if ((required && !value) || value.length > max) throw new ApiError("Please check the required fields and try again.");
  return value;
};

class ApiError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

export class D1Repository {
  constructor(db) { this.db = db; }
  async lookup(normalized) {
    const matches = await this.db.prepare("SELECT party_id FROM guests WHERE normalized_name=? LIMIT 2").bind(normalized).all();
    if (matches.results.length !== 1) return null;
    const rows = await this.db.prepare(`SELECT p.id party_id, p.public_id, p.party_name, g.id guest_id, g.full_name,
      pr.contact_email, pr.mailing_address_line1, pr.mailing_address_line2, pr.mailing_city,
      pr.mailing_province_state, pr.mailing_postal_code, pr.mailing_country, pr.message,
      gr.attending, gr.dinner_choice, gr.dietary_restrictions
      FROM parties p JOIN guests g ON g.party_id=p.id
      LEFT JOIN party_rsvps pr ON pr.party_id=p.id LEFT JOIN guest_rsvps gr ON gr.guest_id=g.id
      WHERE p.id=? ORDER BY g.display_order`).bind(matches.results[0].party_id).all();
    return mapParty(rows.results);
  }
  async byPublicId(publicId) {
    const result = await this.db.prepare(`SELECT p.id party_id, p.public_id, p.party_name, g.id guest_id, g.full_name
      FROM parties p JOIN guests g ON g.party_id=p.id WHERE p.public_id=? ORDER BY g.display_order`).bind(publicId).all();
    return result.results.length ? mapParty(result.results) : null;
  }
  async save(party, data, now) {
    const statements = [this.db.prepare(`INSERT INTO party_rsvps
      (party_id,contact_email,mailing_address_line1,mailing_address_line2,mailing_city,mailing_province_state,mailing_postal_code,mailing_country,message,submitted_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(party_id) DO UPDATE SET contact_email=excluded.contact_email,
      mailing_address_line1=excluded.mailing_address_line1, mailing_address_line2=excluded.mailing_address_line2,
      mailing_city=excluded.mailing_city, mailing_province_state=excluded.mailing_province_state,
      mailing_postal_code=excluded.mailing_postal_code, mailing_country=excluded.mailing_country,
      message=excluded.message, updated_at=excluded.updated_at`).bind(party.id, data.email, data.line1, data.line2 || null,
        data.city, data.region, data.postal, data.country, data.message || null, now, now)];
    for (const guest of data.guests) statements.push(this.db.prepare(`INSERT INTO guest_rsvps
      (guest_id,attending,dinner_choice,dietary_restrictions,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(guest_id) DO UPDATE SET attending=excluded.attending,dinner_choice=excluded.dinner_choice,
      dietary_restrictions=excluded.dietary_restrictions,updated_at=excluded.updated_at`)
      .bind(guest.id, guest.attending, guest.dinner, guest.dietary || null, now));
    await this.db.batch(statements);
  }
}

function mapParty(rows) {
  const first = rows[0];
  return { id: first.party_id, publicId: first.public_id, name: first.party_name,
    guests: rows.map((r) => ({ id: r.guest_id, name: r.full_name, attending: r.attending ?? null,
      dinnerChoice: r.dinner_choice ?? null, dietaryRestrictions: r.dietary_restrictions ?? "" })),
    rsvp: first.contact_email == null ? null : { contactEmail: first.contact_email, addressLine1: first.mailing_address_line1,
      addressLine2: first.mailing_address_line2 ?? "", city: first.mailing_city, provinceState: first.mailing_province_state,
      postalCode: first.mailing_postal_code, country: first.mailing_country, message: first.message ?? "" } };
}

async function verifyTurnstile(token, request, env) {
  if (!token || typeof token !== "string") return false;
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET_KEY || ""); form.set("response", token);
  const ip = request.headers.get("CF-Connecting-IP"); if (ip) form.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  return response.ok && Boolean((await response.json()).success);
}

async function limited(binding, key) {
  if (!binding) return false;
  const result = await binding.limit({ key });
  return !result.success;
}

async function jsonBody(request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new ApiError("Invalid request.");
  try { const body = await request.json(); if (!body || Array.isArray(body) || typeof body !== "object") throw new Error(); return body; }
  catch { throw new ApiError("Invalid request."); }
}

export function createHandler(overrides = {}) {
  return async (request, env) => {
    try {
      const url = new URL(request.url);
      if (request.method !== "POST" || !["/api/rsvp/lookup", "/api/rsvp/submit"].includes(url.pathname)) return reply({ message: "Not found." }, 404);
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const isLookup = url.pathname.endsWith("/lookup");
      if (await (overrides.limited || limited)(isLookup ? env.LOOKUP_RATE_LIMITER : env.SUBMIT_RATE_LIMITER, `${isLookup ? "l" : "s"}:${ip}`)) return reply({ message: "Please wait before trying again." }, 429);
      const body = await jsonBody(request);
      if (field(body, "website", LIMITS.honeypot)) throw new ApiError("Unable to process this request.");
      const verify = overrides.verifyTurnstile || verifyTurnstile;
      if (!await verify(body.turnstileToken, request, env)) throw new ApiError("Please complete the security check.");
      const repo = overrides.repository || new D1Repository(env.DB);
      if (isLookup) {
        const normalized = normalizeName(field(body, "name", LIMITS.name, true));
        if (!normalized) throw new ApiError("We could not find that invitation. Please check the name and try again.", 404);
        const party = await repo.lookup(normalized);
        if (!party) throw new ApiError("We could not find that invitation. Please check the name and try again.", 404);
        return reply({ party: { publicId: party.publicId, partyName: party.name, guests: party.guests, rsvp: party.rsvp } });
      }
      const publicId = field(body, "partyId", LIMITS.publicId, true);
      const party = await repo.byPublicId(publicId);
      if (!party) throw new ApiError("Unable to update that invitation.", 404);
      if (!Array.isArray(body.guests)) throw new ApiError("Please answer for every guest.");
      const expected = new Set(party.guests.map((g) => g.id));
      const seen = new Set();
      const guests = body.guests.map((guest) => {
        if (!guest || typeof guest !== "object" || !Number.isInteger(guest.id) || !expected.has(guest.id) || seen.has(guest.id)) throw new ApiError("Invalid guest response.");
        seen.add(guest.id);
        if (!['yes', 'no'].includes(guest.attending)) throw new ApiError("Please select attendance for every guest.");
        const dinner = guest.dinnerChoice == null ? null : clean(guest.dinnerChoice);
        if (guest.attending === "yes" && !['beef', 'chicken', 'vegetarian'].includes(dinner)) throw new ApiError("Please select dinner for each attending guest.");
        if (guest.attending === "no" && dinner !== null && dinner !== "") throw new ApiError("Declining guests cannot have a dinner choice.");
        if (guest.dietaryRestrictions != null && typeof guest.dietaryRestrictions !== "string") throw new ApiError("Invalid dietary information.");
        const dietary = clean(guest.dietaryRestrictions); if (dietary.length > LIMITS.dietary) throw new ApiError("Dietary information is too long.");
        return { id: guest.id, attending: guest.attending, dinner: guest.attending === "no" ? null : dinner, dietary };
      });
      if (seen.size !== expected.size) throw new ApiError("Please answer for every guest.");
      const data = { guests, email: field(body, "contactEmail", LIMITS.email, true), line1: field(body, "addressLine1", LIMITS.line1, true),
        line2: field(body, "addressLine2", LIMITS.line2), city: field(body, "city", LIMITS.city, true),
        region: field(body, "provinceState", LIMITS.region, true), postal: field(body, "postalCode", LIMITS.postal, true),
        country: field(body, "country", LIMITS.country, true), message: field(body, "message", LIMITS.message) };
      if (!validEmail(data.email)) throw new ApiError("Please enter a valid email address.");
      await repo.save(party, data, new Date().toISOString());
      return reply({ message: "Your RSVP has been saved." });
    } catch (error) {
      if (error instanceof ApiError) return reply({ message: error.message }, error.status);
      console.error("RSVP request failed", { error: error?.name || "Error" });
      return reply({ message: "We could not process your RSVP. Please try again." }, 500);
    }
  };
}

const handler = createHandler();
export default { fetch: handler };
