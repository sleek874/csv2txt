import assert from "node:assert/strict";
import test from "node:test";

import { encodeBig5 } from "../src/core/encoding.ts";
import { parseBig5Txt } from "../src/core/formats/big5-txt.ts";

function bytes(...chunks) {
  return new Uint8Array(chunks.flatMap((chunk) => [...chunk]));
}

test("parses left-aligned fixed-width Big5 records and skips physical blank lines", () => {
  const chinese = encodeBig5("中");
  assert.ok(chinese);
  const source = bytes(
    [0x41, 0x20, 0x20, 0x20],
    [...chinese, 0x20, 0x20],
    [0x0d, 0x0a],
    [0x0d, 0x0a],
  );

  const parsed = parseBig5Txt(source, [4, 4]);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.rows, [["A", "中"]]);
  assert.deepEqual(parsed.sourceRowNumbers, [1]);
  assert.equal(parsed.sourceRowCount, 2);
  assert.equal(parsed.excludedBlankRows, 1);
  assert.equal(parsed.recordWidthBytes, 8);
});

test("rejects wrong record widths, unsafe Big5 bytes, and unpaired CR bytes", () => {
  assert.match(
    parseBig5Txt(new Uint8Array([0x41, 0x0a]), [2]).errors[0] ?? "",
    /第 1 筆共有 1 位元組，應為 2 位元組/u,
  );
  assert.match(
    parseBig5Txt(new Uint8Array([0xff]), [1]).errors[0] ?? "",
    /無法安全解讀的 Big5 位元組/u,
  );
  assert.match(
    parseBig5Txt(new Uint8Array([0x0d]), [1]).errors[0] ?? "",
    /未配對的 CR/u,
  );
});
