import assert from "node:assert/strict";
import test from "node:test";

import {
  adapterIssue,
  createInternalFile,
  createInternalFileWithRecovery,
} from "../src/core/conversion-pipeline.ts";

function validRow(overrides = {}) {
  const row = [
    "A", "01", "1", "1234567890", "A123456789", "20000101", "測試",
    "1", "測試地址", "0212345678", "A123456789", "A", "20200101", "", "",
  ];
  Object.entries(overrides).forEach(([field, value]) => { row[Number(field) - 1] = value; });
  return row;
}

test("normalizes adapter issue defaults without losing diagnostics", () => {
  assert.deepEqual(adapterIssue({ message: "bad", severity: "error" }), {
    code: "ADAPTER_ERROR", message: "bad", severity: "error", stage: "adapter",
  });
  assert.deepEqual(adapterIssue({
    code: "SOURCE_WARNING", fieldIndex: 7, message: "review", severity: "warning",
    sourceRow: 4, replacementCharacterIndices: [1], technicalDetail: "byte 0xff",
  }), {
    code: "SOURCE_WARNING", fieldIndex: 7, message: "review", severity: "warning",
    sourceRow: 4, replacementCharacterIndices: [1], stage: "adapter", technicalDetail: "byte 0xff",
  });
});

test("maps adapter replacement positions through normalization and suppresses only the matching question-mark finding", () => {
  const file = createInternalFile("source", "source.csv", {
    rows: [validRow({ 7: " 王?明 " })],
    issues: [adapterIssue({
      code: "UNDECODABLE_BIG5E_BYTES", fieldIndex: 7, message: "字元無法讀取。",
      replacementCharacterIndices: [2], severity: "error", sourceRow: 1,
    })],
  }, "20260829");

  assert.equal(file.rows[0]?.cells[6]?.normalizedValue, "王？明");
  assert.deepEqual(file.issues.filter(({ code }) => code === "UNDECODABLE_BIG5E_BYTES")
    .map(({ replacementCharacterIndices }) => replacementCharacterIndices), [[1]]);
  assert.equal(file.issues.some(({ code }) => code === "QUESTION_MARK_PRESENT"), false);
});

test("deduplicates physical blank rows and preserves source metadata and rejected records", () => {
  const rejected = { message: "bad row", original: "x", sourceRow: 4 };
  const file = createInternalFile("mixed", "mixed.xlsx", {
    blankSourceRows: [1, 3],
    decoderLabel: "UTF-8",
    rejectedRecords: [rejected],
    rows: [Array(15).fill(""), validRow()],
    sheetName: "資料",
    sourceRowCount: 5,
    sourceRowNumbers: [3, 5],
  }, "20260829");

  assert.deepEqual(file.blankSourceRows, [1, 3]);
  assert.deepEqual(file.rejectedRecords, [rejected]);
  assert.deepEqual(file.metadata, { decoderLabel: "UTF-8", sheetName: "資料" });
  assert.equal(file.rows[0]?.sourceRow, 5);
  assert.equal(file.summary.sourceRecords, 5);
  assert.equal(file.summary.blankRows, 2);
  assert.equal(file.summary.rejectedRows, 1);
});

test("loads legacy recovery only when a row contains a private-use code point", async () => {
  const ordinary = await createInternalFileWithRecovery(
    "ordinary", "ordinary.csv", { rows: [validRow()] }, "20260829",
  );
  assert.equal(ordinary.rows[0]?.changes.length, 0);

  const legacy = await createInternalFileWithRecovery(
    "legacy", "legacy.csv", { rows: [validRow({ 7: `王${String.fromCodePoint(0xe808)}` })] }, "20260829",
  );
  assert.equal(legacy.rows[0]?.changes.some(({ kind }) => kind === "private-use-recovery"), true);
});
