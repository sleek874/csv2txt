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
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.blankSourceRows, [2]);
  assert.deepEqual(parsed.rows, [["A", "中"]]);
  assert.deepEqual(parsed.sourceRowNumbers, [1]);
  assert.equal(parsed.sourceRowCount, 2);
  assert.equal(parsed.recordWidthBytes, 8);
});

test("rejects structural records but keeps decodable field segments", () => {
  assert.match(
    parseBig5Txt(new Uint8Array([0x41, 0x0a]), [2]).rejectedRecords[0]?.message ?? "",
    /共有 1 位元組，應為 2 位元組/u,
  );
  const partialRecord = new Uint8Array(208).fill(0x20);
  partialRecord.set([0xa6, 0xf3, 0xfb, 0xa9, 0xaa, 0xe5], 32);
  const partial = parseBig5Txt(partialRecord);
  assert.equal(partial.rows[0]?.[6], "何？芸");
  assert.deepEqual(partial.rejectedRecords, []);
  assert.deepEqual(partial.issues, [{
    code: "UNDECODABLE_BIG5E_BYTES",
    fieldIndex: 7,
    message: "部分內容無法辨識，已以？代替；預覽以 ■ 標示，請核對來源。",
    replacementCharacterIndices: [1],
    severity: "error",
    sourceRow: 1,
    technicalDetail: "欄位7無法對照的位元組：FB A9（欄內第 3–4 位元組）。",
  }]);
  assert.match(
    parseBig5Txt(new Uint8Array([0x0d]), [1]).rejectedRecords[0]?.message ?? "",
    /不完整的換行/u,
  );
});
