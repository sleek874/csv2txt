import assert from "node:assert/strict";
import test from "node:test";

import { createInputAdapter } from "../src/app/adapters/input-adapter.ts";

function codecs() {
  const calls = [];
  return {
    calls,
    manager: {
      async csv() {
        calls.push("csv");
        return { parseCsv() { return {
          blankSourceRows: [2], decoderLabel: "UTF-8", rejectedRecords: [], rows: [["csv"]],
          issues: [{ message: "csv warning", severity: "warning", sourceRow: 1 }],
        }; } };
      },
      async big5Txt() {
        calls.push("txt");
        return { parseBig5Txt() { return {
          blankSourceRows: [3], rejectedRecords: [], rows: [["txt"]], sourceRowCount: 4,
          sourceRowNumbers: [2],
          issues: [{ code: "TXT_WARNING", fieldIndex: 7, message: "txt warning", severity: "warning" }],
        }; } };
      },
      async spreadsheet() {
        calls.push("spreadsheet");
        return { parseSpreadsheet(_bytes, fieldCount) { return {
          blankSourceRows: [], rejectedRecords: [], rows: [[String(fieldCount)]], sheetName: "資料",
          issues: [{ message: "sheet error", severity: "error", technicalDetail: "detail" }],
        }; } };
      },
    },
  };
}

test("routes CSV and carries parser rows, metadata, and adapter issues", async () => {
  const fake = codecs();
  const parsed = await createInputAdapter(fake.manager).parse("csv", new Uint8Array());
  assert.deepEqual(fake.calls, ["csv"]);
  assert.equal(parsed.decoderLabel, "UTF-8");
  assert.deepEqual(parsed.blankSourceRows, [2]);
  assert.deepEqual(parsed.issues, [{
    code: "ADAPTER_WARNING", message: "csv warning", severity: "warning",
    sourceRow: 1, stage: "adapter",
  }]);
});

test("routes fixed-width TXT and preserves physical source-row metadata", async () => {
  const fake = codecs();
  const parsed = await createInputAdapter(fake.manager).parse("txt", new Uint8Array());
  assert.deepEqual(fake.calls, ["txt"]);
  assert.equal(parsed.decoderLabel, "臺灣政府 BIG-5E 固定 208 bytes");
  assert.deepEqual(parsed.sourceRowNumbers, [2]);
  assert.equal(parsed.sourceRowCount, 4);
  assert.deepEqual(parsed.issues?.[0], {
    code: "TXT_WARNING", fieldIndex: 7, message: "txt warning",
    severity: "warning", stage: "adapter",
  });
});

test("routes both spreadsheet extensions through the shared 15-column parser", async () => {
  for (const format of ["xls", "xlsx"]) {
    const fake = codecs();
    const parsed = await createInputAdapter(fake.manager).parse(format, new Uint8Array());
    assert.deepEqual(fake.calls, ["spreadsheet"]);
    assert.deepEqual(parsed.rows, [["15"]]);
    assert.equal(parsed.sheetName, "資料");
    assert.deepEqual(parsed.issues?.[0], {
      code: "ADAPTER_ERROR", message: "sheet error", severity: "error",
      stage: "adapter", technicalDetail: "detail",
    });
  }
});
