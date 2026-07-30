import assert from "node:assert/strict";
import test from "node:test";

import { parseCsv } from "../src/core/csv.ts";

test("preserves quoted commas, escaped quotes, embedded CRLF, and empty cells", () => {
  const parsed = parseCsv(
    'first,"comma,value","escaped ""quote"""\r\n"line 1\r\nline 2",,last\r\n',
  );

  assert.deepEqual(parsed.rows, [
    ["first", "comma,value", 'escaped "quote"'],
    ["line 1\r\nline 2", "", "last"],
  ]);
  assert.deepEqual(parsed.errors, []);
});

test("removes only the parser artifact after a terminal line break", () => {
  assert.deepEqual(parseCsv("a,b\r\n").rows, [["a", "b"]]);
  assert.deepEqual(parseCsv("a,b\r\n\r\n").rows, [["a", "b"], [""]]);
});

test("translates malformed quotation errors with a source row", () => {
  const parsed = parseCsv('a,"unterminated');

  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0] ?? "", /資料列 1：引號未正確結束。/u);
});
