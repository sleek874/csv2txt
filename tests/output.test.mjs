import assert from "node:assert/strict";
import test from "node:test";

import {
  createOutputAdapter,
  taipeiMinuteStamp,
} from "../src/app/adapters/output-adapter.ts";
import { createCodecManager } from "../src/app/resources/codec-manager.ts";
import { createOutputPlan } from "../src/app/sections/output/output-plan.ts";
import { OUTPUT_PRESENTATIONS } from "../src/app/sections/output/output-presentations.ts";
import { inspectZip } from "../src/core/archive/zip.ts";
import { parseBig5Txt } from "../src/core/formats/big5-txt.ts";
import { summarizeInternalFile } from "../src/core/internal-model.ts";

function internalFile(id, virtualPath, options = {}) {
  const row = {
    sourceRow: 1,
    included: options.included ?? true,
    cells: Array.from({ length: 15 }, (_, index) => ({
      fieldIndex: index + 1,
      normalizedValue: options.values?.[index] ?? (index === 0 ? id : ""),
      issues: [],
    })),
    issues: options.rowIssue ? [options.rowIssue] : [],
    changes: options.modified ? [{
      kind: "telephone-default",
      sourceRow: 1,
      fieldIndex: 1,
      before: "before",
      after: id,
      reason: "test",
    }] : [],
  };
  const file = {
    blankSourceRows: [],
    id,
    virtualPath,
    rows: [row],
    issues: options.fileIssue ? [options.fileIssue] : [],
    summary: {},
    metadata: {},
    rejectedRecords: [],
  };
  file.summary = summarizeInternalFile(file, 1);
  return file;
}

function readyItem(file) {
  return {
    id: file.id,
    size: 1,
    sourceId: `input-${file.id}`,
    sourceFormat: "csv",
    state: "ready",
    relativePath: file.virtualPath,
    virtualPath: file.virtualPath,
    file,
  };
}

test("uses concise output labels", () => {
  assert.equal(OUTPUT_PRESENTATIONS["big5-txt"].label, "TXT");
  assert.equal(OUTPUT_PRESENTATIONS.csv.label, "CSV");
  assert.equal(OUTPUT_PRESENTATIONS.xlsx.label, "XLSX");
});

test("summarizes the full workspace and blocks an incomplete batch", () => {
  const warning = { severity: "warning", stage: "final", code: "TEST", message: "warning", sourceRow: 1 };
  const omittedError = { severity: "error", stage: "final", code: "OMITTED", message: "omitted", sourceRow: 1 };
  const included = internalFile("one", "one.csv", { modified: true, rowIssue: warning });
  const omitted = internalFile("two", "two.csv", {
    included: false,
    modified: true,
    rowIssue: omittedError,
  });
  const snapshot = {
    files: [
      readyItem(included),
      readyItem(omitted),
      { id: "failed", size: 1, sourceId: "input-failed", sourceFormat: "csv", state: "error", relativePath: "", virtualPath: "failed.csv" },
    ],
    inputFormat: "csv",
    outputFormat: "csv",
    selectedFileId: included.id,
    sources: [],
  };

  const plan = createOutputPlan(snapshot);
  assert.deepEqual(plan.selectedSummary, {
    downloadableRows: 1,
    problemCount: 0,
    selectedRows: 1,
  });
  assert.deepEqual(plan.totalSummary, {
    downloadableRows: 1,
    fileCount: 3,
    problemCount: 2,
    selectedRows: 1,
  });
  assert.equal(plan.omittedRowCount, 1);
  assert.equal(plan.canDownload, false);
});

test("excludes unchecked-row issues and changes from the Section 2 summary", () => {
  const error = { severity: "error", stage: "final", code: "OMITTED", message: "omitted", sourceRow: 1 };
  const omitted = internalFile("omitted", "omitted.csv", {
    included: false,
    modified: true,
    rowIssue: error,
  });
  const plan = createOutputPlan({
    files: [readyItem(omitted)],
    inputFormat: "csv",
    outputFormat: "csv",
    selectedFileId: omitted.id,
    sources: [],
  });

  assert.equal(omitted.summary.errorRows, 1);
  assert.equal(omitted.summary.warningRows, 0, "an error dominates the row warning");
  assert.deepEqual(plan.totalSummary, {
    downloadableRows: 0,
    fileCount: 1,
    problemCount: 1,
    selectedRows: 0,
  });
});

test("ignored inventory entries never enter output totals or block download", () => {
  const file = internalFile("ready", "ready.csv");
  const plan = createOutputPlan({
    files: [
      readyItem(file),
      {
        id: "ignored",
        ignoredReason: "unsupported-type",
        size: 10,
        sourceId: "ignored-source",
        state: "ignored",
        relativePath: "notes.pdf",
        virtualPath: "notes.pdf",
      },
    ],
    inputFormat: "csv",
    outputFormat: "csv",
    selectedFileId: "ignored",
    sources: [],
  });

  assert.equal(plan.totalSummary.fileCount, 1);
  assert.equal(plan.totalSummary.problemCount, 0);
  assert.equal(plan.canDownload, true);
});

test("keeps nonblocking output substitutions out of fatal counts", () => {
  const error = { severity: "error", stage: "final", code: "PUA", message: "error", sourceRow: 1 };
  const values = Array.from({ length: 15 }, () => "");
  values[6] = "廍";
  values[8] = "廍";
  const file = internalFile("one-error-row", "one-error-row.xlsx", {
    rowIssue: error,
    values,
  });
  file.rows[0].changes.push({
    kind: "private-use-recovery",
    sourceRow: 1,
    fieldIndex: 9,
    before: "before-two",
    after: "after-two",
    reason: "test-two",
  });
  const plan = createOutputPlan({
    files: [readyItem(file)],
    inputFormat: "csv",
    outputFormat: "big5-txt",
    selectedFileId: file.id,
    sources: [],
  });

  assert.equal(plan.outputIssues.length, 2);
  assert.equal(plan.outputIssues.every((issue) => !issue.blocking), true);
  assert.equal(plan.totalSummary.problemCount, 0);
  assert.equal(plan.totalSummary.downloadableRows, 1);
  assert.equal(plan.replacementRowCount, 1);
  assert.equal(plan.canDownload, true);
});

test("does not repeat Section 1 row findings when the selected codec can serialize them", () => {
  const sourceError = {
    severity: "error",
    stage: "final",
    code: "SOURCE_ONLY",
    message: "review",
    sourceRow: 1,
  };
  const file = internalFile("reviewed", "reviewed.csv", { rowIssue: sourceError });
  const plan = createOutputPlan({
    files: [readyItem(file)],
    inputFormat: "csv",
    outputFormat: "csv",
    selectedFileId: file.id,
    sources: [],
  });

  assert.equal(file.summary.errorRows, 1);
  assert.equal(plan.totalSummary.problemCount, 0);
  assert.equal(plan.totalSummary.downloadableRows, 1);
  assert.equal(plan.canDownload, true);
});

test("downloads one file directly using its basename", async () => {
  const output = await createOutputAdapter(createCodecManager()).create([
    internalFile("one", "bundle/folder/one.xlsx"),
  ], "csv");
  assert.equal(output.filename, "one.csv");
  assert.equal(output.mimeType, "text/csv;charset=utf-8");
});

test("packages multiple outputs with safe paths and a Taipei timestamp", async () => {
  const output = await createOutputAdapter(createCodecManager()).create([
    internalFile("one", "one.csv"),
    internalFile("two", "bundle/folder/two.xlsx"),
  ], "csv", new Date("2026-08-04T07:30:00.000Z"));

  assert.equal(taipeiMinuteStamp(new Date("2026-08-04T16:05:00.000Z")), "202608050005");
  assert.equal(output.filename, "csv-202608041530.zip");
  assert.equal(output.mimeType, "application/zip");
  assert.deepEqual(inspectZip(output.bytes).map((entry) => entry.name), [
    "one.csv",
    "bundle/folder/two.csv",
  ]);
});

test("rejects colliding batch paths instead of renaming them", async () => {
  await assert.rejects(createOutputAdapter(createCodecManager()).create([
    internalFile("one", "same.csv"),
    internalFile("two", "same.xlsx"),
  ], "csv"), /輸出路徑碰撞：same\.csv/u);
});

test("applies BIG-5E compatibility only to BIG-5E TXT output", async () => {
  const values = Array.from({ length: 15 }, () => "");
  values[6] = "甲廍乙";
  const file = internalFile("rare-character", "rare-character.xlsx", { values });
  const baseSnapshot = {
    files: [readyItem(file)],
    inputFormat: "csv",
    selectedFileId: file.id,
    sources: [],
  };

  const big5Plan = createOutputPlan({ ...baseSnapshot, outputFormat: "big5-txt" });
  assert.equal(big5Plan.canDownload, true);
  assert.equal(big5Plan.totalSummary.problemCount, 0);
  assert.equal(big5Plan.replacementRowCount, 1);
  assert.equal(big5Plan.outputIssues[0]?.blocking, false);
  assert.equal(big5Plan.outputIssues[0]?.code, "OUTPUT_UNENCODABLE");
  assert.equal(big5Plan.outputIssues[0]?.fieldIndex, 7);
  assert.deepEqual(big5Plan.outputIssues[0]?.unsupportedCharacters, [{
    character: "廍",
    codePoint: 0x5ecd,
  }]);
  assert.equal(
    big5Plan.outputIssues[0]?.message,
    "字元「■」（U+5ECD）沒有 BIG-5E 對照；TXT 將以？代替。",
  );

  const csvPlan = createOutputPlan({ ...baseSnapshot, outputFormat: "csv" });
  assert.equal(csvPlan.outputIssues.length, 0);
  assert.equal(csvPlan.canDownload, true);
  assert.equal((await createOutputAdapter(createCodecManager()).create([file], "csv")).filename, "rare-character.csv");
  const txtOutput = await createOutputAdapter(createCodecManager()).create([file], "big5-txt");
  assert.equal(parseBig5Txt(txtOutput.bytes).rows[0]?.[6], "甲？乙");
});

test("blocks BIG-5E byte overflow only for BIG-5E TXT", () => {
  const values = Array.from({ length: 15 }, () => "");
  values[0] = "AB";
  const file = internalFile("wide", "wide.xlsx", { values });

  const big5Plan = createOutputPlan({
    files: [readyItem(file)],
    inputFormat: "csv",
    outputFormat: "big5-txt",
    selectedFileId: file.id,
    sources: [],
  });
  assert.equal(big5Plan.outputIssues[0]?.code, "OUTPUT_WIDTH_OVERFLOW");
  assert.equal(big5Plan.outputIssues[0]?.blocking, true);
  assert.equal(big5Plan.outputIssues[0]?.fieldIndex, 1);
  assert.equal(big5Plan.canDownload, false);

  const xlsxPlan = createOutputPlan({
    files: [readyItem(file)],
    inputFormat: "csv",
    outputFormat: "xlsx",
    selectedFileId: file.id,
    sources: [],
  });
  assert.equal(xlsxPlan.outputIssues.length, 0);
  assert.equal(xlsxPlan.canDownload, true);
});

test("keeps replacement notices nonblocking while replacement overflow remains fatal", () => {
  const values = Array.from({ length: 15 }, () => "");
  values[6] = "ABCDE廍FGHIJK";
  const file = internalFile("replacement-overflow", "replacement-overflow.xlsx", { values });
  const plan = createOutputPlan({
    files: [readyItem(file)],
    inputFormat: "csv",
    outputFormat: "big5-txt",
    selectedFileId: file.id,
    sources: [],
  });

  assert.deepEqual(plan.outputIssues.map((issue) => [issue.code, issue.blocking]), [
    ["OUTPUT_UNENCODABLE", false],
    ["OUTPUT_WIDTH_OVERFLOW", true],
  ]);
  assert.equal(plan.replacementRowCount, 1);
  assert.equal(plan.totalSummary.problemCount, 1);
  assert.equal(plan.totalSummary.downloadableRows, 0);
  assert.equal(plan.canDownload, false);
});

test("keeps a partially decoded source row selected and downloadable", () => {
  const values = Array.from({ length: 15 }, () => "");
  values[6] = "何？芸";
  const file = internalFile("partial-source", "partial-source.txt", {
    fileIssue: {
      code: "UNDECODABLE_BIG5E_BYTES",
      fieldIndex: 7,
      message: "部分內容無法辨識，已以？代替；預覽以 ■ 標示，請核對來源。",
      replacementCharacterIndices: [1],
      severity: "error",
      sourceRow: 1,
      stage: "adapter",
    },
    values,
  });
  const base = {
    files: [readyItem(file)],
    inputFormat: "csv",
    selectedFileId: file.id,
    sources: [],
  };

  const txt = createOutputPlan({ ...base, outputFormat: "big5-txt" });
  assert.equal(txt.canDownload, true);
  assert.equal(txt.outputIssues.length, 0);
  assert.equal(createOutputPlan({ ...base, outputFormat: "csv" }).canDownload, true);
});

test("blocks an incomplete batch when a source record has the wrong column count", () => {
  const file = internalFile("rejected", "rejected.csv");
  file.rows = [];
  file.rejectedRecords = [{
    message: "共有 16 欄，應為 15 欄。",
    original: "synthetic",
    sourceRow: 1,
  }];
  file.summary = summarizeInternalFile(file, 1);
  const plan = createOutputPlan({
    files: [readyItem(file)],
    inputFormat: "csv",
    outputFormat: "csv",
    selectedFileId: file.id,
    sources: [],
  });

  assert.equal(plan.canDownload, false);
  assert.equal(plan.totalSummary.selectedRows, 0);
  assert.match(plan.problems.join("\n"), /有 1 列無法解析/u);
});
