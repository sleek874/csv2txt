import assert from "node:assert/strict";
import test from "node:test";

import { encodeBig5E } from "../src/core/encoding.ts";
import { parseBig5Txt } from "../src/core/formats/big5-txt.ts";

function bytes(...chunks) {
  return new Uint8Array(chunks.flatMap((chunk) => [...chunk]));
}

test("parses left-aligned fixed-width BIG-5E records and skips physical blank lines", () => {
  const chinese = encodeBig5E("中");
  assert.ok(chinese);
  const source = bytes(
    [0x41, 0x20, 0x20, 0x20],
    [...chinese, 0x20, 0x20],
    [0x0d, 0x0a],
    [0x0d, 0x0a],
  );

  const parsed = parseBig5Txt(source, [4, 4]);
  assert.deepEqual(parsed.issues, [{
    message: "空白列不會輸出。",
    severity: "warning",
    sourceRow: 2,
  }]);
  assert.deepEqual(parsed.rows, [["A", "中"]]);
  assert.deepEqual(parsed.sourceRowNumbers, [1]);
  assert.equal(parsed.sourceRowCount, 2);
  assert.equal(parsed.recordWidthBytes, 8);
});

test("rejects wrong record widths, unmapped BIG-5E bytes, and unpaired CR bytes", () => {
  assert.match(
    parseBig5Txt(new Uint8Array([0x41, 0x0a]), [2]).issues[0]?.message ?? "",
    /共有 1 位元組，應為 2 位元組/u,
  );
  assert.match(
    parseBig5Txt(new Uint8Array([0xff]), [1]).issues[0]?.message ?? "",
    /無法依臺灣政府 BIG-5E 對照表解讀/u,
  );
  assert.match(
    parseBig5Txt(new Uint8Array([0x0d]), [1]).issues[0]?.message ?? "",
    /未配對的 CR/u,
  );
});
