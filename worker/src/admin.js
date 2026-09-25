import { normalizeName } from "./normalize.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
const clean = value => typeof value === "string" ? value.trim() : "";
const encoder = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const randomId = () => b64(crypto.getRandomValues(new Uint8Array(24)));
const cookie = request => Object.fromEntries((request.headers.get("cookie") || "").split(";").map(item => item.trim().split(/=(.*)/s)).filter(x => x[0]));
const secureEqual = (a, b) => {
  const aa = encoder.encode(a), bb = encoder.encode(b); let difference = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) difference |= (aa[i % (aa.length || 1)] || 0) ^ (bb[i % (bb.length || 1)] || 0);
  return difference === 0;
};
async function signature(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}
async function makeSession(env) {
  const expires = Date.now() + 8 * 60 * 60 * 1000, nonce = randomId(), payload = `${expires}.${nonce}`;
  return `${payload}.${await signature(payload, env.ADMIN_SESSION_SECRET || env.ADMIN_PASSWORD || "honeycomb")}`;
}
async function authenticated(request, env, overrides) {
  if (overrides.adminAuthenticated) return overrides.adminAuthenticated(request, env);
  const token = cookie(request).howlers_admin;
  if (!token) return false;
  const [expires, nonce, supplied, extra] = token.split(".");
  if (extra || !expires || !nonce || !supplied || Number(expires) <= Date.now()) return false;
  return secureEqual(supplied, await signature(`${expires}.${nonce}`, env.ADMIN_SESSION_SECRET || env.ADMIN_PASSWORD || "honeycomb"));
}
async function body(request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new AdminError("Invalid request.");
  try { const value = await request.json(); if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(); return value; }
  catch { throw new AdminError("Invalid request."); }
}
class AdminError extends Error { constructor(message, status = 400, code = "validation_error") { super(message); this.status = status; this.code = code; } }
const name = (value, label = "Name") => {
  const result = clean(value);
  if (!result) throw new AdminError(`${label} is required.`);
  if (result.length > 120) throw new AdminError(`${label} must be 120 characters or fewer.`);
  if (!normalizeName(result)) throw new AdminError(`${label} must contain letters or numbers.`);
  return result;
};
const id = value => { const result = Number(value); if (!Number.isInteger(result) || result < 1) throw new AdminError("Invalid identifier."); return result; };

export class AdminRepository {
  constructor(db) { this.db = db; }
  async ensureNamesAvailable(names, excludedGuestId = 0) {
    if (new Set(names.map(normalizeName)).size !== names.length) throw new AdminError("Guest names must be unique in the roster.", 409, "conflict");
    for (const guestName of names) {
      const existing = await this.db.prepare("SELECT id FROM guests WHERE normalized_name=? AND id<>? LIMIT 1").bind(normalizeName(guestName), excludedGuestId).first();
      if (existing) throw new AdminError("A guest with that normalized name already exists. Please use a distinct name.", 409, "conflict");
    }
  }
  async list() {
    const rows = await this.db.prepare(`SELECT p.id party_id,p.public_id,p.party_name,g.id guest_id,g.full_name,g.display_order,
      pr.submitted_at,gr.attending,gr.dinner_choice,gr.dietary_restrictions
      FROM parties p JOIN guests g ON g.party_id=p.id LEFT JOIN party_rsvps pr ON pr.party_id=p.id
      LEFT JOIN guest_rsvps gr ON gr.guest_id=g.id ORDER BY p.party_number,g.display_order`).all();
    const parties = [];
    for (const row of rows.results) {
      let party = parties.at(-1); if (!party || party.id !== row.party_id) { party = { id: row.party_id, publicId: row.public_id, name: row.party_name, submitted: Boolean(row.submitted_at), guests: [] }; parties.push(party); }
      party.guests.push({ id: row.guest_id, name: row.full_name, order: row.display_order, response: row.attending ? { attending: row.attending, dinner: row.dinner_choice, dietary: row.dietary_restrictions || "" } : null });
    }
    return parties;
  }
  async exportRows() {
    const result = await this.db.prepare(`SELECT p.party_name,g.full_name,g.display_order,pr.contact_email,
      pr.mailing_address_line1,pr.mailing_address_line2,pr.mailing_city,pr.mailing_province_state,
      pr.mailing_postal_code,pr.mailing_country,gr.attending,gr.dinner_choice,gr.dietary_restrictions,
      pr.message,pr.submitted_at,pr.updated_at
      FROM parties p JOIN guests g ON g.party_id=p.id LEFT JOIN party_rsvps pr ON pr.party_id=p.id
      LEFT JOIN guest_rsvps gr ON gr.guest_id=g.id ORDER BY p.party_number,g.display_order`).all();
    return result.results;
  }
  async create(partyName, guests, now) {
    await this.ensureNamesAvailable(guests);
    const publicId = randomId();
    const statements = [this.db.prepare(`INSERT INTO parties(public_id,party_number,party_name,created_at)
      VALUES(?,(SELECT COALESCE(MAX(party_number),0)+1 FROM parties),?,?)`).bind(publicId, partyName, now)];
    guests.forEach((guest, order) => statements.push(this.db.prepare(`INSERT INTO guests(party_id,full_name,normalized_name,display_order,created_at)
      VALUES((SELECT id FROM parties WHERE public_id=?),?,?,?,?)`).bind(publicId, guest, normalizeName(guest), order, now)));
    await this.db.batch(statements);
    return this.db.prepare("SELECT id,public_id publicId,party_name name FROM parties WHERE public_id=?").bind(publicId).first();
  }
  async renameParty(partyId, partyName) {
    const result = await this.db.prepare("UPDATE parties SET party_name=? WHERE id=?").bind(partyName, partyId).run();
    if (!result.meta.changes) throw new AdminError("Party not found.", 404, "not_found");
  }
  async deleteParty(partyId) {
    // Explicit order documents and protects all relationships even if a migrated database lacks cascades.
    const exists = await this.db.prepare("SELECT id FROM parties WHERE id=?").bind(partyId).first();
    if (!exists) throw new AdminError("Party not found.", 404, "not_found");
    await this.db.batch([
      this.db.prepare("DELETE FROM guest_rsvps WHERE guest_id IN (SELECT id FROM guests WHERE party_id=?)").bind(partyId),
      this.db.prepare("DELETE FROM party_rsvps WHERE party_id=?").bind(partyId),
      this.db.prepare("DELETE FROM guests WHERE party_id=?").bind(partyId),
      this.db.prepare("DELETE FROM parties WHERE id=?").bind(partyId)
    ]);
  }
  async addGuest(partyId, guestName, now) {
    const party = await this.db.prepare("SELECT id FROM parties WHERE id=?").bind(partyId).first();
    if (!party) throw new AdminError("Party not found.", 404, "not_found");
    await this.ensureNamesAvailable([guestName]);
    await this.db.prepare(`INSERT INTO guests(party_id,full_name,normalized_name,display_order,created_at)
      VALUES(?,?,?,(SELECT COALESCE(MAX(display_order),-1)+1 FROM guests WHERE party_id=?),?)`)
      .bind(partyId, guestName, normalizeName(guestName), partyId, now).run();
  }
  async renameGuest(guestId, guestName) {
    await this.ensureNamesAvailable([guestName], guestId);
    const result = await this.db.prepare("UPDATE guests SET full_name=?,normalized_name=? WHERE id=?").bind(guestName, normalizeName(guestName), guestId).run();
    if (!result.meta.changes) throw new AdminError("Guest not found.", 404, "not_found");
  }
  async removeGuest(guestId) {
    const guest = await this.db.prepare("SELECT party_id FROM guests WHERE id=?").bind(guestId).first();
    if (!guest) throw new AdminError("Guest not found.", 404, "not_found");
    const count = await this.db.prepare("SELECT COUNT(*) count FROM guests WHERE party_id=?").bind(guest.party_id).first();
    if (count.count <= 1) throw new AdminError("A party must have at least one guest. Delete the party instead.", 409, "last_guest");
    await this.db.batch([
      this.db.prepare("DELETE FROM guest_rsvps WHERE guest_id=?").bind(guestId),
      this.db.prepare("DELETE FROM guests WHERE id=?").bind(guestId)
    ]);
  }
  async reorder(partyId, guestIds) {
    const current = await this.db.prepare("SELECT id FROM guests WHERE party_id=? ORDER BY display_order").bind(partyId).all();
    const expected = current.results.map(row => row.id);
    if (guestIds.length !== expected.length || new Set(guestIds).size !== expected.length || guestIds.some(value => !expected.includes(value))) throw new AdminError("Guest order must include every guest in this party exactly once.");
    // Move into a disjoint, still-valid range first to satisfy the per-party
    // unique and non-negative constraints throughout the atomic batch.
    const statements = guestIds.map((guestId, order) => this.db.prepare("UPDATE guests SET display_order=? WHERE id=? AND party_id=?").bind(guestIds.length + order, guestId, partyId));
    guestIds.forEach((guestId, order) => statements.push(this.db.prepare("UPDATE guests SET display_order=? WHERE id=? AND party_id=?").bind(order, guestId, partyId)));
    await this.db.batch(statements);
  }
}

const parseRoute = path => path.split("/").filter(Boolean);
const duplicateMessage = error => /constraint|unique/i.test(String(error?.message)) ? new AdminError("That change conflicts with existing roster data. Please use a different name or try again.", 409, "conflict") : error;
export async function handleAdminRequest(request, env, overrides = {}) {
  try {
    const path = new URL(request.url).pathname, parts = parseRoute(path);
    if (path === "/api/admin/login" && request.method === "POST") {
      const data = await body(request), username = env.ADMIN_USERNAME || "howlerhoney", password = env.ADMIN_PASSWORD || "honeycomb";
      if (!secureEqual(clean(data.username), username) || !secureEqual(String(data.password || ""), password)) return reply({ code: "invalid_credentials", message: "Invalid username or password." }, 401);
      const session = await makeSession(env);
      return reply({ authenticated: true }, 200, { "set-cookie": `howlers_admin=${session}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=28800` });
    }
    if (!await authenticated(request, env, overrides)) return reply({ code: "unauthorized", message: "Admin authentication required." }, 401);
    if (path === "/api/admin/logout" && request.method === "POST") return reply({ authenticated: false }, 200, { "set-cookie": "howlers_admin=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });
    const repo = overrides.adminRepository || new AdminRepository(env.DB), now = new Date().toISOString();
    if (path === "/api/admin/parties" && request.method === "GET") return reply({ parties: await repo.list() });
    if (path === "/api/admin/export" && request.method === "GET") {
      const columns = ["party_name", "full_name", "display_order", "contact_email", "mailing_address_line1", "mailing_address_line2", "mailing_city", "mailing_province_state", "mailing_postal_code", "mailing_country", "attending", "dinner_choice", "dietary_restrictions", "message", "submitted_at", "updated_at"];
      const csv = [columns, ...(await repo.exportRows()).map(row => columns.map(column => row[column] ?? ""))]
        .map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
      return new Response(`\ufeff${csv}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=invitation-roster.csv", "cache-control": "no-store" } });
    }
    if (path === "/api/admin/parties" && request.method === "POST") {
      const data = await body(request), partyName = name(data.name, "Party name");
      if (!Array.isArray(data.guests) || !data.guests.length) throw new AdminError("Add at least one guest.");
      const guests = data.guests.map(value => name(value, "Guest name"));
      return reply({ party: await repo.create(partyName, guests, now) }, 201);
    }
    if (parts[2] === "parties" && parts.length === 4) {
      const partyId = id(parts[3]);
      if (request.method === "PATCH") { const data = await body(request); await repo.renameParty(partyId, name(data.name, "Party name")); return reply({ updated: true }); }
      if (request.method === "DELETE") { await repo.deleteParty(partyId); return reply({ deleted: true }); }
    }
    if (parts[2] === "parties" && parts[4] === "guests" && parts.length === 5 && request.method === "POST") {
      const data = await body(request); await repo.addGuest(id(parts[3]), name(data.name, "Guest name"), now); return reply({ created: true }, 201);
    }
    if (parts[2] === "parties" && parts[4] === "guest-order" && parts.length === 5 && request.method === "PATCH") {
      const data = await body(request); if (!Array.isArray(data.guestIds)) throw new AdminError("Guest order is required.");
      await repo.reorder(id(parts[3]), data.guestIds.map(id)); return reply({ updated: true });
    }
    if (parts[2] === "guests" && parts.length === 4) {
      const guestId = id(parts[3]);
      if (request.method === "PATCH") { const data = await body(request); await repo.renameGuest(guestId, name(data.name, "Guest name")); return reply({ updated: true }); }
      if (request.method === "DELETE") { await repo.removeGuest(guestId); return reply({ deleted: true }); }
    }
    return reply({ message: "Not found." }, 404);
  } catch (original) {
    const error = duplicateMessage(original);
    if (error instanceof AdminError) return reply({ code: error.code, message: error.message }, error.status);
    console.error("Admin request failed", { error: error?.name || "Error" });
    return reply({ code: "unavailable", message: "The admin request could not be completed." }, 500);
  }
}
