#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizeName } from "../worker/src/normalize.js";

const WRANGLER_CLI = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((current) => !(current.length === 1 && !current[0].trim()));
}

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

export function parseArguments(args) {
  const environmentIndex = args.indexOf("--env");
  const file = args[0];
  const environment = environmentIndex >= 0 ? args[environmentIndex + 1] : "";
  if (!file || args.length !== 3 || environmentIndex !== 1 ||
      !["preview", "production"].includes(environment)) {
    throw new Error("Usage: npm run import -- <private.csv> --env preview|production");
  }
  return { file, environment };
}

export function prepareImport(text, environment) {
  const rows = parseCsv(text);
  const header = ["party_number", "party_name", "guest_name"];
  if (rows.length < 2 || rows[0].map((value) => value.trim()).join() !== header.join()) {
    throw new Error(`CSV header must be: ${header.join(",")}`);
  }

  const parties = new Map();
  const names = new Set();
  for (const [index, raw] of rows.slice(1).entries()) {
    const line = index + 2;
    if (raw.length !== 3) throw new Error(`Line ${line}: expected exactly 3 columns.`);
    const [numberText, partyName, guestName] = raw.map((value) => value.trim());
    if (!/^\d+$/.test(numberText) || Number(numberText) < 1 || !partyName || !guestName) {
      throw new Error(`Line ${line}: all fields are required.`);
    }

    const number = Number(numberText);
    const prior = parties.get(number);
    if (prior && prior.name !== partyName) {
      throw new Error(`Line ${line}: inconsistent party name.`);
    }
    const normalized = normalizeName(guestName);
    if (!normalized || names.has(normalized)) {
      throw new Error(`Line ${line}: blank or duplicate normalized guest name.`);
    }
    names.add(normalized);
    if (!prior) {
      parties.set(number, {
        name: partyName,
        publicId: randomBytes(24).toString("base64url"),
        guests: [],
      });
    }
    parties.get(number).guests.push({ name: guestName, normalized });
  }

  if (environment === "production" && (parties.size !== 33 || names.size !== 63)) {
    throw new Error(
      `Production requires exactly 33 parties and 63 guests; found ${parties.size} and ${names.size}.`,
    );
  }

  const now = new Date().toISOString();
  // D1 remote file execution manages rollback and rejects explicit transactions.
  let sql = "PRAGMA foreign_keys=ON;\n";
  for (const [number, party] of parties) {
    sql += "INSERT INTO parties(public_id,party_number,party_name,created_at) VALUES(" +
      `${quote(party.publicId)},${number},${quote(party.name)},${quote(now)});\n`;
    party.guests.forEach((guest, order) => {
      sql += "INSERT INTO guests(party_id,full_name,normalized_name,display_order,created_at) VALUES(" +
        `(SELECT id FROM parties WHERE party_number=${number}),${quote(guest.name)},` +
        `${quote(guest.normalized)},${order},${quote(now)});\n`;
    });
  }
  return { sql, partyCount: parties.size, guestCount: names.size };
}

function runWrangler(args, options, spawn = spawnSync) {
  const result = spawn(process.execPath, [WRANGLER_CLI, ...args], options);
  if (result.error) {
    throw new Error(`Failed to start Wrangler: ${result.error.message}`, { cause: result.error });
  }
  if (result.status === null) {
    throw new Error(`Wrangler terminated without an exit code${result.signal ? ` (${result.signal})` : ""}.`);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.toString().trim();
    throw new Error(`Wrangler exited with status ${result.status}${detail ? `: ${detail}` : "."}`);
  }
  return result;
}

function findCounts(value) {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const counts = findCounts(item);
      if (counts) return counts;
    }
  } else if (typeof value === "object") {
    if (Number.isInteger(value.parties) && Number.isInteger(value.guests)) return value;
    return findCounts(Object.values(value));
  }
  return undefined;
}

export async function importGuests({ file, environment }, dependencies = {}) {
  const spawn = dependencies.spawnSync ?? spawnSync;
  const prepared = prepareImport(await readFile(file, "utf8"), environment);
  console.log(`Validated CSV: ${prepared.partyCount} parties and ${prepared.guestCount} guests.`);
  const directory = await mkdtemp(join(tmpdir(), "rsvp-import-"));
  const sqlPath = join(directory, "import.sql");
  const base = ["d1", "execute", "DB", "--env", environment, "--remote"];

  try {
    await writeFile(sqlPath, prepared.sql, { mode: 0o600 });
    console.log(`Importing into ${environment} D1 database...`);
    runWrangler([...base, "--file", sqlPath], { stdio: "inherit" }, spawn);
    console.log("Import complete. Verifying counts...");
    const command = "SELECT (SELECT COUNT(*) FROM parties) AS parties, (SELECT COUNT(*) FROM guests) AS guests;";
    const result = runWrangler(
      [...base, "--command", command, "--json"],
      { encoding: "utf8" },
      spawn,
    );
    let output;
    try {
      output = JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(`Wrangler returned invalid JSON during count verification: ${error.message}`);
    }
    const counts = findCounts(output);
    if (!counts || counts.parties !== prepared.partyCount || counts.guests !== prepared.guestCount) {
      throw new Error(
        `Count verification failed; expected ${prepared.partyCount}/${prepared.guestCount}, got ` +
        `${counts?.parties ?? "unknown"}/${counts?.guests ?? "unknown"}.`,
      );
    }
    console.log(`Verified ${counts.parties} parties and ${counts.guests} guests.`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const isEntryPoint = process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntryPoint) {
  try {
    await importGuests(parseArguments(process.argv.slice(2)));
  } catch (error) {
    console.error(`Guest import failed: ${error.message}`);
    process.exitCode = 1;
  }
}
