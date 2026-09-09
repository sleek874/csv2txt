import assert from "node:assert/strict";
import test from "node:test";

import { compactInternalFile } from "../src/app/batch/compact-workspace.ts";
import { queryPreviewPage } from "../src/app/batch/preview-query.ts";
import { createInternalFile } from "../src/core/conversion-pipeline.ts";
import { summarizeInternalFile } from "../src/core/internal-model.ts";

function validRow(index = 0, overrides = {}) {
  const row = [
    "A", "01", "1", String(index).padStart(10, "0"), "A123456789", "20000101", "測試",
    "1", "測試地址", "0212345678", "A123456789", "A", "20200101", "", "",
  ];
  Object.entries(overrides).forEach(([field, value]) => { row[Number(field) - 1] = value; });
  return row;
}

function previewFixture() {
  const file = createInternalFile("preview", "preview.csv", {
    rejectedRecords: [{ message: "欄位數錯誤", original: "bad", sourceRow: 9 }],
    rows: [
      validRow(1, { 1: "Z" }),
      validRow(2, { 10: "" }),
      validRow(3),
      validRow(4),
    ],
  }, "20260829");
  file.rows[3].included = false;
  file.summary = summarizeInternalFile(file, file.summary.sourceRecords);
  return compactInternalFile(file);
}

test("queries every preview outcome from one ordered compact workspace", () => {
  const file = previewFixture();
  const expectedCounts = {
    all: 5, rejected: 1, error: 1, warning: 1, valid: 2, excluded: 1, output: 0,
  };
  for (const filter of ["all", "rejected", "error", "warning", "valid", "excluded"]) {
    const page = queryPreviewPage(file, filter, 0, "csv");
    assert.deepEqual(page.filterCounts, expectedCounts);
    assert.equal(page.totalRecords, expectedCounts[filter]);
  }
  const all = queryPreviewPage(file, "all", 0, "csv");
  assert.equal(all.records[0]?.kind, "rejected");
  assert.deepEqual(all.records.slice(1).map((record) => record.row.sourceRow), [1, 2, 3, 4]);
});

test("clamps pages and keeps rejected and data records stable at the 100-row boundary", () => {
  const file = createInternalFile("large", "large.csv", {
    rejectedRecords: [{ message: "bad", original: "bad", sourceRow: 200 }],
    rows: Array.from({ length: 100 }, (_, index) => validRow(index + 1)),
  }, "20260829");
  const compact = compactInternalFile(file);

  const first = queryPreviewPage(compact, "all", -3, "csv");
  assert.equal(first.page, 0);
  assert.equal(first.records.length, 100);
  assert.equal(first.records[0]?.kind, "rejected");
  assert.equal(first.records.at(-1)?.row.sourceRow, 99);

  const last = queryPreviewPage(compact, "all", 99, "csv");
  assert.equal(last.page, 1);
  assert.equal(last.pageCount, 2);
  assert.equal(last.records.length, 1);
  assert.equal(last.records[0]?.row.sourceRow, 100);
});

test("returns only file issues belonging to records on the visible page", () => {
  const file = createInternalFile("issues", "issues.csv", {
    issues: [
      { code: "GLOBAL", message: "global", severity: "warning", stage: "adapter" },
      { code: "ROW_ONE", message: "one", severity: "warning", sourceRow: 1, stage: "adapter" },
      { code: "ROW_TWO", message: "two", severity: "warning", sourceRow: 2, stage: "adapter" },
    ],
    rows: [validRow(1), validRow(2)],
  }, "20260829");
  const page = queryPreviewPage(compactInternalFile(file), "valid", 0, "csv");
  assert.deepEqual(page.fileIssues.map(({ code }) => code), ["GLOBAL"]);
  const warning = queryPreviewPage(compactInternalFile(file), "warning", 0, "csv");
  assert.deepEqual(warning.fileIssues.map(({ code }) => code), ["GLOBAL", "ROW_ONE", "ROW_TWO"]);
});
