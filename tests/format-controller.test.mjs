import assert from "node:assert/strict";
import test from "node:test";

import { createFormatController } from "../src/app/sections/format/format-controller.ts";
import { createWorkspaceModel } from "../src/app/state/workspace-model.ts";

function record(outputFormat = "big5-txt") {
  return {
    blockingOutputIssues: [],
    fileIssueMessages: [],
    hasBlockingIssues: false,
    id: "primary",
    outputBlockingRows: 0,
    outputFormat,
    outputIssues: [],
    outputReplacementRows: 0,
    rowCount: 1,
    selectionRevision: 0,
    summary: {
      blankRows: 0,
      correctRows: 1,
      dataRows: 1,
      errorRows: 0,
      includedRows: 1,
      rejectedRows: 0,
      sourceRecords: 1,
      warningRows: 0,
    },
    virtualPath: "primary.csv",
  };
}

function modelWithFile() {
  const model = createWorkspaceModel();
  model.setInputFormat("csv");
  model.addBatch([{ id: "input", kind: "file", name: "primary.csv" }], [{
    file: record(),
    id: "primary",
    relativePath: "primary.csv",
    size: 1,
    sourceFormat: "csv",
    sourceId: "input",
    virtualPath: "primary.csv",
  }]);
  return model;
}

test("output preparation settles in ready after refreshed summaries arrive", async () => {
  const model = modelWithFile();
  let callbacks;
  const controller = createFormatController({
    batchClient: {
      async refreshOutput() { return [record("csv")]; },
    },
    model,
    view: {
      bind(value) { callbacks = value; },
      render() {},
    },
  });
  controller.bind();

  callbacks.onOutputChange("csv");
  assert.equal(model.snapshot().outputPreparationState, "loading");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(model.snapshot().outputPreparationState, "ready");
  assert.equal(model.snapshot().files[0]?.file?.outputFormat, "csv");
});

test("output preparation exposes a recoverable error instead of spinning forever", async () => {
  const model = modelWithFile();
  let callbacks;
  const controller = createFormatController({
    batchClient: {
      async refreshOutput() { throw new Error("synthetic failure"); },
    },
    model,
    view: {
      bind(value) { callbacks = value; },
      render() {},
    },
  });
  controller.bind();

  callbacks.onOutputChange("csv");
  assert.equal(model.snapshot().outputPreparationState, "loading");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(model.snapshot().outputPreparationState, "error");
  assert.match(model.snapshot().outputPreparationError, /重新選擇輸出格式/u);
});

test("clearing the primary workspace resets output preparation state", () => {
  const model = modelWithFile();
  model.setOutputPreparation("error", "synthetic failure");
  model.clear();

  assert.equal(model.snapshot().outputPreparationState, "ready");
  assert.equal(model.snapshot().outputPreparationError, null);
});
