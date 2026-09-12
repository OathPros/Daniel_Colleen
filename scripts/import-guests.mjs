#!/usr/bin/env node

import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { normalizeName } from "../worker/src/normalize.js";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }

  if (quoted) {
    throw Error("CSV has an unclosed quoted field.");
  }

  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows.filter(
    (r) => !(r.length === 1 && !r[0].trim())
  );
}

const quote = (value) =>
  `'${String(value).replaceAll("'", "''")}'`;

const fail = (message) => {
  throw Error(message);
};

function runNpx(args, options = {}) {
  const result = spawnSync("npx", args, {
    ...options,
    shell: process.platform === "win32",
  });

  if (result.error) {
    fail(`Failed to start npx: ${result.error.message}`);
  }

  return result;
}

const args = process.argv.slice(2);
const file = args[0];
const envPosition = args.indexOf("--env");
const environment =
  envPosition >= 0 ? args[envPosition + 1] : "";

if (
  !file ||
  !["preview", "production"].includes(environment)
) {
  fail(
    "Usage: npm run import -- <private.csv> --env preview|production"
  );
}

const rows = parseCsv(await readFile(file, "utf8"));

const header = [
  "party_number",
  "party_name",
  "guest_name",
];

if (
  rows.length < 2 ||
  rows[0].map((value) => value.trim()).join() !==
    header.join()
) {
  fail(
    `CSV header must be: ${header.join(",")}`
  );
}

const parties = new Map();
const names = new Set();

for (const [index, raw] of rows.slice(1).entries()) {
  const line = index + 2;

  if (raw.length !== 3) {
    fail(`Line ${line}: expected exactly 3 columns.`);
  }

  const [numText, partyName, guestName] =
    raw.map((value) => value.trim());

  if (
    !/^\d+$/.test(numText) ||
    Number(numText) < 1 ||
    !partyName ||
    !guestName
  ) {
    fail(`Line ${line}: all fields are required.`);
  }

  const num = Number(numText);
  const prior = parties.get(num);

  if (prior && prior.name !== partyName) {
    fail(`Line ${line}: inconsistent party name.`);
  }

  const normalized = normalizeName(guestName);

  if (!normalized || names.has(normalized)) {
    fail(
      `Line ${line}: blank or duplicate normalized guest name.`
    );
  }

  names.add(normalized);

  if (!prior) {
    parties.set(num, {
      name: partyName,
      publicId: randomBytes(24).toString("base64url"),
      guests: [],
    });
  }

  parties.get(num).guests.push({
    name: guestName,
    normalized,
  });
}

if (
  environment === "production" &&
  (parties.size !== 33 || names.size !== 63)
) {
  fail(
    `Production requires exactly 33 parties and 63 guests; found ${parties.size} and ${names.size}.`
  );
}

console.log(
  `Validated CSV: ${parties.size} parties and ${names.size} guests.`
);

const now = new Date().toISOString();

/*
 * Do not add BEGIN TRANSACTION / COMMIT here.
 * Cloudflare D1's remote SQL-file execution manages the
 * import transaction/rollback and rejects explicit transaction SQL.
 */
let sql = "PRAGMA foreign_keys=ON;\n";

for (const [num, party] of parties) {
  sql +=
    `INSERT INTO parties(` +
    `public_id,party_number,party_name,created_at` +
    `) VALUES(` +
    `${quote(party.publicId)},` +
    `${num},` +
    `${quote(party.name)},` +
    `${quote(now)}` +
    `);\n`;

  party.guests.forEach((guest, order) => {
    sql +=
      `INSERT INTO guests(` +
      `party_id,full_name,normalized_name,display_order,created_at` +
      `) VALUES(` +
      `(SELECT id FROM parties WHERE party_number=${num}),` +
      `${quote(guest.name)},` +
      `${quote(guest.normalized)},` +
      `${order},` +
      `${quote(now)}` +
      `);\n`;
  });
}

const dir = await mkdtemp(
  join(tmpdir(), "rsvp-import-")
);

const sqlPath = join(dir, "import.sql");

try {
  await writeFile(sqlPath, sql, {
    mode: 0o600,
  });

  const base = [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--env",
    environment,
    "--remote",
  ];

  console.log(
    `Importing into ${environment} D1 database...`
  );

  let result = runNpx(
    [...base, "--file", sqlPath],
    {
      stdio: "inherit",
    }
  );

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  console.log("Import complete. Verifying counts...");

  result = runNpx(
    [
      ...base,
      "--command",
      "SELECT (SELECT COUNT(*) FROM parties) AS parties, (SELECT COUNT(*) FROM guests) AS guests;",
      "--json",
    ],
    {
      encoding: "utf8",
    }
  );

  if (result.status !== 0) {
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }

    process.exit(result.status || 1);
  }

  const output = JSON.parse(result.stdout);

  let counts;

  const findCounts = (value) => {
    if (!value || counts) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(findCounts);
      return;
    }

    if (typeof value === "object") {
      if (
        Number.isInteger(value.parties) &&
        Number.isInteger(value.guests)
      ) {
        counts = value;
      } else {
        Object.values(value).forEach(findCounts);
      }
    }
  };

  findCounts(output);

  if (
    !counts ||
    counts.parties !== parties.size ||
    counts.guests !== names.size
  ) {
    fail(
      `Count verification failed; expected ` +
      `${parties.size}/${names.size}, got ` +
      `${counts?.parties ?? "unknown"}/` +
      `${counts?.guests ?? "unknown"}.`
    );
  }

  console.log(
    `Verified ${counts.parties} parties and ${counts.guests} guests.`
  );
} finally {
  await rm(dir, {
    recursive: true,
    force: true,
  });
}