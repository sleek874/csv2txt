import assert from "node:assert/strict";
import test from "node:test";

import { createAdvancedController } from "../src/app/sections/advanced/advanced-controller.ts";
import { createWorkspaceModel } from "../src/app/state/workspace-model.ts";

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
  model.addSource({ id: "input", kind: "file", name: "primary.csv" });
  model.add({
    file: selectedFileWithIssues(),
    id: "primary",
    relativePath: "primary.csv",
    size: 100,
    sourceId: "input",
    sourceFormat: "csv",
    state: "ready",
    virtualPath: "primary.csv",
  });

  let callbacks;
  let state;
  let createdResult;
  let savedOutput;
  const controller = createAdvancedController({
    model,
    outputAdapter: {
      async create(result) {
        createdResult = result;
        return {
          bytes: new Uint8Array([1]),
          filename: "advanced.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        };
      },
      async inspect() {
        return { sheetNames: ["Reference"] };
      },
      async parse() {
        return {
          headers: ["ID", "Value"],
          issues: [{ message: "read warning", severity: "error", sourceRow: 2 }],
          rows: [
            ["A123456789", "first"],
            ["A123456789", "second"],
          ],
          sheetName: "Reference",
        };
      },
    },
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
  assert.equal(state.issueCount, 1);
  assert.equal(state.selectedRowCount, 1);
  assert.equal(state.matchedRowCount, 1);
  assert.equal(state.resultRowCount, 2);

  callbacks.onDownload();
  await controller.whenIdle();
  assert.equal(createdResult.resultRowCount, 2);
  assert.equal(savedOutput.filename, "advanced.xlsx");
});
