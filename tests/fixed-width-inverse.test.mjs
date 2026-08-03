import assert from "node:assert/strict";
import test from "node:test";

import { convertRows } from "../src/core/fixed-width.ts";
import { parseFixedWidthBig5 } from "../src/core/fixed-width-inverse.ts";

function settings(alignment) {
  return {
    version: 3,
    removeWhitespace: false,
    alignment,
    expectedRows: 2,
    columns: [4, 4, 3].map((widthBytes) => ({
      required: false,
      defaultValue: "",
      widthBytes,
    })),
  };
}

test("parses left-aligned fixed-width Big5 records back into text cells", () => {
  const rows = [
    ["中", "001", "A"],
    ["文", " 2", ""],
  ];
  const converted = convertRows(rows, settings("left"));
  assert.ok(converted.outputBytes);

  const parsed = parseFixedWidthBig5(converted.outputBytes, [4, 4, 3], "left");

  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.rows, rows);
  assert.equal(parsed.recordWidthBytes, 11);
});

test("removes only the configured padding side", () => {
  const rows = [
    ["中", "001", "A "],
    ["文", "2", ""],
  ];
  const converted = convertRows(rows, settings("right"));
  assert.ok(converted.outputBytes);

  const parsed = parseFixedWidthBig5(converted.outputBytes, [4, 4, 3], "right");

  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.rows, rows);
});

test("rejects wrong record widths, unsafe Big5 bytes, and unpaired CR bytes", () => {
  assert.match(
    parseFixedWidthBig5(new Uint8Array([0x41, 0x0a]), [2], "left").errors[0] ?? "",
    /第 1 筆共有 1 位元組，應為 2 位元組/u,
  );
  assert.match(
    parseFixedWidthBig5(new Uint8Array([0xff]), [1], "left").errors[0] ?? "",
    /無法安全解讀的 Big5 位元組/u,
  );
  assert.match(
    parseFixedWidthBig5(new Uint8Array([0x0d]), [1], "left").errors[0] ?? "",
    /未配對的 CR/u,
  );
});
