import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCsv,
  parseCsvText,
  serializeCsv,
} from "../src/core/formats/csv.ts";

test("preserves quoted commas, escaped quotes, embedded CRLF, and empty cells", () => {
  const parsed = parseCsvText(
    'first,"comma,value","escaped ""quote"""\r\n"line 1\r\nline 2",,last\r\n',
  );
  assert.deepEqual(parsed.rows, [
    ["first", "comma,value", 'escaped "quote"'],
    ["line 1\r\nline 2", "", "last"],
  ]);
  assert.deepEqual(parsed.issues, []);
});

test("removes only the parser artifact after a terminal line break", () => {
  assert.deepEqual(parseCsvText("a,b\r\n").rows, [["a", "b"]]);
  assert.deepEqual(parseCsvText("a,b\r\n\r\n").rows, [["a", "b"], [""]]);
});

test("translates malformed quotation errors with a source row", () => {
  const parsed = parseCsvText('a,"unterminated');
  assert.deepEqual(parsed.issues, [{
    message: "引號未正確結束。",
    severity: "error",
    sourceRow: 1,
  }]);
});

test("serializes the final IR as literal UTF-8 values", () => {
  const rows = [
    { sourceRow: 1, values: ["00123", "comma,value", 'a "quote"'] },
    { sourceRow: 2, values: ["line 1\nline 2", "", "=literal"] },
  ];
  const bytes = serializeCsv(rows);
  assert.deepEqual(bytes.slice(0, 3), new Uint8Array([0xef, 0xbb, 0xbf]));
  const text = new TextDecoder().decode(bytes.slice(3));
  assert.deepEqual(parseCsv(bytes).rows, [
    ["00123", "comma,value", 'a "quote"'],
    ["line 1\nline 2", "", "=literal"],
  ]);
  assert.doesNotMatch(text, /="00123"/u, "CSV must not replace values with spreadsheet formulas");
  assert.match(text, /\r\n$/u);
});
