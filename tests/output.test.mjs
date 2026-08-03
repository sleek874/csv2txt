import assert from "node:assert/strict";
import test from "node:test";

import {
  createOutputAdapter,
  taipeiMinuteStamp,
} from "../src/app/adapters/output-adapter.ts";
import { createCodecManager } from "../src/app/resources/codec-manager.ts";
import { createOutputPlan } from "../src/app/sections/output/output-plan.ts";
import { inspectZip } from "../src/core/archive/zip.ts";
import { summarizeInternalFile } from "../src/core/internal-model.ts";

function internalFile(id, virtualPath, options = {}) {
  const row = {
    sourceRow: 1,
    included: options.included ?? true,
    cells: Array.from({ length: 15 }, (_, index) => ({
      fieldIndex: index + 1,
      normalizedValue: index === 0 ? id : "",
      issues: [],
    })),
    issues: options.rowIssue ? [options.rowIssue] : [],
    changes: options.modified ? [{
      sourceRow: 1,
      fieldIndex: 1,
      before: "before",
      after: id,
      reason: "test",
    }] : [],
  };
  const file = {
    id,
    virtualPath,
    rows: [row],
    issues: options.fileIssue ? [options.fileIssue] : [],
    summary: {},
    metadata: {},
  };
  file.summary = summarizeInternalFile(file, 1, 0);
  return file;
}

function readyItem(file) {
  return {
    id: file.id,
    size: 1,
    sourceId: `input-${file.id}`,
    state: "ready",
    relativePath: file.virtualPath,
    virtualPath: file.virtualPath,
    file,
  };
}

test("summarizes the full workspace and blocks an incomplete batch", () => {
  const warning = { severity: "warning", stage: "final", code: "TEST", message: "warning", sourceRow: 1 };
  const included = internalFile("one", "one.csv", { modified: true, rowIssue: warning });
  const omitted = internalFile("two", "two.csv", { included: false });
  const snapshot = {
    files: [
      readyItem(included),
      readyItem(omitted),
      { id: "failed", size: 1, sourceId: "input-failed", state: "error", relativePath: "", virtualPath: "failed.csv" },
    ],
    outputFormat: "csv",
    selectedFileId: included.id,
    sources: [],
  };

  const plan = createOutputPlan(snapshot);
  assert.deepEqual(plan.summary, {
    errorCount: 1,
    excludedBlankRows: 0,
    fileCount: 3,
    includedRows: 1,
    modifiedCount: 1,
    sourceRows: 2,
    warningCount: 1,
  });
  assert.equal(plan.emptyFileCount, 1);
  assert.equal(plan.failedFileCount, 1);
  assert.equal(plan.forcedRowCount, 1);
  assert.equal(plan.omittedRowCount, 1);
  assert.equal(plan.canDownload, false);
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
