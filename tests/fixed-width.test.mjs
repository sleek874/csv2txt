import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseCsv } from "../src/core/csv.ts";
import { encodeBig5 } from "../src/core/encoding.ts";
import { convertRows } from "../src/core/fixed-width.ts";
import { createDefaultSettings } from "../src/settings/profile.ts";

function createSettings(widths, overrides = {}) {
  return {
    version: 3,
    removeWhitespace: true,
    alignment: "left",
    expectedRows: 1,
    columns: widths.map((widthBytes) => ({
      required: false,
      defaultValue: "",
      widthBytes,
    })),
    ...overrides,
  };
}

test("emits exact Big5 bytes with global left or right padding and final CRLF", () => {
  const chinese = encodeBig5("中");
  assert.ok(chinese);

  const left = convertRows([["A", "中"]], createSettings([4, 4]));
  assert.deepEqual(
    left.outputBytes,
    new Uint8Array([0x41, 0x20, 0x20, 0x20, ...chinese, 0x20, 0x20, 0x0d, 0x0a]),
  );
  assert.equal(left.recordWidthBytes, 8);

  const right = convertRows(
    [["A", "中"]],
    createSettings([4, 4], { alignment: "right" }),
  );
  assert.deepEqual(
    right.outputBytes,
    new Uint8Array([0x20, 0x20, 0x20, 0x41, 0x20, 0x20, ...chinese, 0x0d, 0x0a]),
  );
});

test("applies defaults after whitespace removal without masking an empty record", () => {
  const settings = createSettings([2, 1]);
  settings.columns[0].defaultValue = "中";

  const resolved = convertRows([[" \t", "A"]], settings);
  assert.equal(resolved.rows[0]?.fields[0]?.resolvedValue, "中");
  assert.equal(resolved.rows[0]?.fields[0]?.usedDefault, true);
  assert.ok(resolved.outputBytes);

  const empty = convertRows([[" \t", " "]], settings);
  assert.equal(empty.outputBytes, null);
  assert.deepEqual(empty.issues.map((issue) => issue.code), ["EMPTY_RECORD"]);
});

test("preserved source whitespace remains valid but visible as a warning", () => {
  const result = convertRows(
    [[" A"]],
    createSettings([3], { removeWhitespace: false }),
  );

  assert.ok(result.outputBytes);
  assert.equal(result.warningCount, 1);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["LEADING_WHITESPACE"]);
  assert.equal(result.rows[0]?.fields[0]?.resolvedValue, " A");
});

test("any required, width, control, or Big5 error blocks the complete download", () => {
  const settings = createSettings([1, 1, 2, 2], { removeWhitespace: false });
  settings.columns[0].required = true;

  const result = convertRows([["", "AB", "\tA", "😀"]], settings);

  assert.equal(result.outputBytes, null);
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    [
      "MISSING_REQUIRED",
      "WIDTH_OVERFLOW",
      "UNSUPPORTED_CONTROL_CHARACTER",
      "UNENCODABLE_BIG5",
    ],
  );
  assert.equal(result.invalidRows, 1);
});

test("the 200-row preset fixture produces 208-byte records plus CRLF", () => {
  const csvText = readFileSync(
    new URL("./fixtures/synthetic-valid-200.utf8.csv", import.meta.url),
    "utf8",
  );
  const parsed = parseCsv(csvText);
  const result = convertRows(parsed.rows, createDefaultSettings());

  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(result.issues, []);
  assert.equal(result.validRows, 200);
  assert.equal(result.recordWidthBytes, 208);
  assert.equal(result.outputBytes?.length, 200 * (208 + 2));
  assert.deepEqual(result.outputBytes?.slice(-2), new Uint8Array([0x0d, 0x0a]));
});
