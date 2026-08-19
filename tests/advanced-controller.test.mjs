import assert from "node:assert/strict";
import test from "node:test";

import { createAdvancedController } from "../src/app/sections/advanced/advanced-controller.ts";
import { createWorkspaceModel } from "../src/app/state/workspace-model.ts";
import { FILE_SIZE_LIMIT_BYTES } from "../src/core/file-size-policy.ts";

function selectedFileWithIssues() {
  const values = Array(15).fill("");
  values[4] = "DUPLICATE";
  values[5] = "20000101";
  values[10] = "A123456789";
  return {
    blankSourceRows: [],
    id: "primary",
    issues: [{
      code: "FILE_ISSUE",
      message: "仍然逐列處理",
      severity: "error",
      stage: "adapter",
    }],
    metadata: {},
    rejectedRecords: [],
    rows: [{
      cells: values.map((normalizedValue, index) => ({
        fieldIndex: index + 1,
        issues: [],
        normalizedValue,
      })),
      changes: [],
      included: true,
      issues: [{
        code: "ROW_ISSUE",
        message: "不阻止進階輸出",
        severity: "error",
        sourceRow: 1,
        stage: "final",
      }],
      sourceRow: 1,
    }],
    summary: {
      blankRows: 0,
      correctRows: 0,
      dataRows: 1,
      errorRows: 1,
      includedRows: 1,
      rejectedRows: 0,
      sourceRecords: 1,
      warningRows: 0,
    },
    virtualPath: "primary.csv",
  };
}

test("advanced download ignores data issues and expands duplicate reference matches", async () => {
  const model = createWorkspaceModel();
  model.setInputFormat("csv");
  model.addBatch([{ id: "input", kind: "file", name: "primary.csv" }], [{
    file: selectedFileWithIssues(),
    id: "primary",
    relativePath: "primary.csv",
    size: 100,
    sourceId: "input",
    sourceFormat: "csv",
    virtualPath: "primary.csv",
  }]);

  let callbacks;
  let state;
  let createdRequest;
  let deferResult = false;
  let releaseResult;
  let savedOutput;
  let resultRequestCount = 0;
  let releaseSheet;
  let sheetRequestCount = 0;
  const controller = createAdvancedController({
    batchClient: {
      async clearReference() {},
      async createAdvancedOutput(fileIds, keyColumnIndex, selectedColumnIndices) {
        createdRequest = { fileIds, keyColumnIndex, selectedColumnIndices };
        return {
          bytes: new Uint8Array([1]),
          filename: "advanced.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        };
      },
      async getAdvancedResult() {
        resultRequestCount += 1;
        const value = {
          resultRowCount: 2,
          selectedRowCount: 1,
          unmatchedRowCount: 0,
        };
        if (!deferResult) return value;
        return new Promise((resolve) => { releaseResult = () => resolve(value); });
      },
      async inspectReference() {
        return {
          headers: ["ID", "Value"],
          issues: ["參照 Excel 有 1 個讀取提醒。"],
          sheetName: "Reference",
          sheetNames: ["Reference", "Other"],
        };
      },
      async selectReferenceSheet(sheetName) {
        sheetRequestCount += 1;
        return new Promise((resolve) => {
          releaseSheet = () => resolve({
            headers: ["ID", "Value"],
            issues: [],
            sheetName,
            sheetNames: ["Reference", "Other"],
          });
        });
      },
    },
    model,
    status: { announce() {} },
    unloadGuard: { setPendingFile() {} },
    view: {
      bind(value) { callbacks = value; },
      fileInput() { return { click() {} }; },
      render(value) { state = value; },
      save(output) { savedOutput = output; },
    },
  });
  controller.bind();

  callbacks.onReferenceChosen({
    async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer; },
    name: "reference.xlsx",
    size: 3,
  });
  await controller.whenIdle();

  assert.equal(state.canDownload, true);
  assert.deepEqual(state.issues, ["參照 Excel 有 1 個讀取提醒。"]);
  assert.deepEqual(state.selectedColumnIndices, [], "first use starts with no appended reference columns");
  assert.equal(state.selectedRowCount, 1);
  assert.equal(state.resultRowCount, 2);
  assert.equal(state.resultBusy, false);
  assert.equal(resultRequestCount, 1);

  model.setOutputFormat("csv");
  assert.equal(resultRequestCount, 1, "standard output changes do not invalidate the advanced join");

  model.setInputFormat("xlsx");
  await controller.whenIdle();
  assert.equal(resultRequestCount, 2, "active input-family changes do invalidate the advanced join");
  model.setInputFormat("csv");
  await controller.whenIdle();
  assert.equal(resultRequestCount, 3);

  deferResult = true;
  callbacks.onSelectedColumnChange(1, false);
  assert.equal(state.resultBusy, true);
  assert.equal(state.canDownload, false);
  releaseResult();
  await controller.whenIdle();
  assert.equal(state.resultBusy, false);
  assert.equal(state.canDownload, true);

  callbacks.onDownload();
  await controller.whenIdle();
  assert.deepEqual(createdRequest.fileIds, ["primary"]);
  assert.equal(savedOutput.filename, "advanced.xlsx");

  deferResult = false;
  callbacks.onSheetChange("Other");
  assert.equal(state.busy, "reference");
  callbacks.onSheetChange("Reference");
  assert.equal(sheetRequestCount, 1, "a second sheet change is ignored while the first is running");
  releaseSheet();
  await controller.whenIdle();
  assert.equal(state.sheetName, "Other");
});

test("reference Excel uses the shared 100 MiB input limit", async () => {
  let callbacks;
  let inspectCount = 0;
  let state;
  const controller = createAdvancedController({
    batchClient: {
      async clearReference() {},
      async getAdvancedResult() {
        return { resultRowCount: 0, selectedRowCount: 0, unmatchedRowCount: 0 };
      },
      async inspectReference() {
        inspectCount += 1;
        return { headers: ["ID"], issues: [], sheetName: "Reference", sheetNames: ["Reference"] };
      },
    },
    model: createWorkspaceModel(),
    status: { announce() {} },
    unloadGuard: { setPendingFile() {} },
    view: {
      bind(value) { callbacks = value; },
      fileInput() { return { click() {} }; },
      render(value) { state = value; },
      save() {},
    },
  });
  controller.bind();

  callbacks.onReferenceChosen({
    async arrayBuffer() { return new Uint8Array([1]).buffer; },
    name: "accepted.xlsx",
    size: FILE_SIZE_LIMIT_BYTES,
  });
  await controller.whenIdle();
  assert.equal(inspectCount, 1);
  assert.equal(state.error, null);

  callbacks.onReferenceChosen({
    async arrayBuffer() { throw new Error("oversized files must be rejected before reading"); },
    name: "too-large.xlsx",
    size: FILE_SIZE_LIMIT_BYTES + 1,
  });
  await controller.whenIdle();
  assert.equal(inspectCount, 1);
  assert.equal(state.error, "參照 Excel 超過 100 MB，請選擇較小的檔案。");
});
