import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  importGuests,
  parseArguments,
  parseCsv,
  prepareImport,
} from "../scripts/import-guests.mjs";

const csv = "party_number,party_name,guest_name\r\n1,Example Party,Alex Example\r\n";

test("CSV parser handles Windows newlines, quoting, and escaped quotes", () => {
  assert.deepEqual(parseCsv('a,b\r\n1,"Example, ""Jr."""\r\n'), [
    ["a", "b"],
    ["1", 'Example, "Jr."'],
  ]);
});

test("argument parser accepts only the documented invocation", () => {
  assert.deepEqual(parseArguments(["input.csv", "--env", "preview"]), {
    file: "input.csv",
    environment: "preview",
  });
  assert.throws(() => parseArguments(["input.csv", "--env", "staging"]), /Usage/);
  assert.throws(() => parseArguments(["input.csv", "extra", "--env", "preview"]), /Usage/);
});

test("generated SQL preserves validation and D1 remote transaction compatibility", () => {
  const prepared = prepareImport(csv, "preview");
  assert.equal(prepared.partyCount, 1);
  assert.equal(prepared.guestCount, 1);
  assert.doesNotMatch(prepared.sql, /\b(?:BEGIN|COMMIT)\b/i);
  assert.match(prepared.sql, /'[A-Za-z0-9_-]{32}'/);
  assert.throws(() => prepareImport(csv, "production"), /exactly 33 parties and 63 guests/);
  assert.throws(
    () => prepareImport(csv + "2,Other Party,Alex  Example\n", "preview"),
    /duplicate normalized guest name/,
  );
});

test("Wrangler runs through Node with unsplit SQL command and cleans its temp file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rsvp-import-test-"));
  const input = join(directory, "synthetic.csv");
  await writeFile(input, csv);
  const calls = [];
  let generatedSql;
  let importPath;
  const spawnSync = (executable, args, options) => {
    calls.push({ executable, args, options });
    const fileIndex = args.indexOf("--file");
    if (fileIndex >= 0) {
      importPath = args[fileIndex + 1];
      generatedSql = readFileSync(importPath, "utf8");
      return { status: 0 };
    }
    return {
      status: 0,
      stdout: JSON.stringify([{ results: [{ parties: 1, guests: 1 }] }]),
      stderr: "",
    };
  };

  try {
    await importGuests({ file: input, environment: "preview" }, { spawnSync });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].executable, process.execPath);
    assert.match(calls[0].args[0], /node_modules[\\/]wrangler[\\/]bin[\\/]wrangler\.js$/);
    const commandIndex = calls[1].args.indexOf("--command");
    assert.equal(calls[1].args[commandIndex + 1],
      "SELECT (SELECT COUNT(*) FROM parties) AS parties, (SELECT COUNT(*) FROM guests) AS guests;");
    assert.equal(calls[1].args.filter((argument) => argument.includes("SELECT")).length, 1);
    assert.doesNotMatch(generatedSql, /\b(?:BEGIN|COMMIT)\b/i);
    assert.equal(existsSync(importPath), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("subprocess launch errors are reported and temporary SQL is cleaned", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rsvp-import-test-"));
  const input = join(directory, "synthetic.csv");
  await writeFile(input, csv);
  let importPath;
  try {
    await assert.rejects(
      importGuests({ file: input, environment: "preview" }, {
        spawnSync: (_executable, args) => {
          importPath = args[args.indexOf("--file") + 1];
          return { error: Object.assign(new Error("synthetic ENOENT"), { code: "ENOENT" }) };
        },
      }),
      /Failed to start Wrangler: synthetic ENOENT/,
    );
    assert.equal(existsSync(importPath), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
