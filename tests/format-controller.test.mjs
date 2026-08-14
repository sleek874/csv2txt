import assert from "node:assert/strict";
import test from "node:test";

import { createFormatController } from "../src/app/sections/format/format-controller.ts";
import { createOutputController } from "../src/app/sections/output/output-controller.ts";
import { createWorkspaceModel } from "../src/app/state/workspace-model.ts";

function record(outputFormat = "big5-txt") {
  return {
    blockingOutputIssues: [],
    fileIssueMessages: [],
    id: "primary",
    outputFormat,
    outputReplacementRows: 0,
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

function addReadyFile(model, id, sourceFormat) {
  model.addBatch([{ id: `input-${id}`, kind: "file", name: `${id}.${sourceFormat}` }], [{
    file: { ...record(), id, virtualPath: `${id}.${sourceFormat}` },
    id,
    relativePath: `${id}.${sourceFormat}`,
    size: 1,
    sourceFormat,
    sourceId: `input-${id}`,
    virtualPath: `${id}.${sourceFormat}`,
  }]);
}

test("format choices only publish synchronous workspace selections", () => {
  const model = modelWithFile();
  let callbacks;
  const controller = createFormatController({
    model,
    view: {
      bind(value) { callbacks = value; },
      render() {},
    },
  });
  controller.bind();

  callbacks.onOutputChange("csv");
  assert.equal(model.snapshot().outputFormat, "csv");
  assert.equal(model.snapshot().files[0]?.file?.outputFormat, "big5-txt");
  callbacks.onInputChange("xlsx");
  assert.equal(model.snapshot().inputFormat, "xlsx");
});

test("section 2 owns output assessment and publishes refreshed summaries", async () => {
  const model = modelWithFile();
  let lastPlan;
  let releaseRefresh;
  const controller = createOutputController({
    batchClient: {
      async createOutput() { throw new Error("not used"); },
      async refreshOutput() {
        return new Promise((resolve) => { releaseRefresh = () => resolve([record("csv")]); });
      },
    },
    model,
    status: { announce() {} },
    view: {
      bind() {},
      render(plan) { lastPlan = plan; },
      renderError() {},
      save() {},
    },
  });
  controller.bind();

  model.setOutputFormat("csv");
  assert.equal(lastPlan.preparationState, "loading");
  releaseRefresh();
  await controller.whenIdle();
  assert.equal(lastPlan.preparationState, "ready");
  assert.equal(model.snapshot().files[0]?.file?.outputFormat, "csv");
});

test("section 2 exposes an assessment error without storing it in shared state", async () => {
  const model = modelWithFile();
  let lastPlan;
  const controller = createOutputController({
    batchClient: {
      async createOutput() { throw new Error("not used"); },
      async refreshOutput() { throw new Error("synthetic failure"); },
    },
    model,
    status: { announce() {} },
    view: {
      bind() {},
      render(plan) { lastPlan = plan; },
      renderError() {},
      save() {},
    },
  });
  controller.bind();

  model.setOutputFormat("csv");
  await controller.whenIdle();
  assert.equal(lastPlan.preparationState, "error");
  assert.match(lastPlan.preparationError, /重新選擇輸出格式/u);
  assert.equal("outputPreparationState" in model.snapshot(), false);
});

test("section 2 re-enables a valid download after input changes during generation", async () => {
  const model = modelWithFile();
  addReadyFile(model, "other", "xlsx");
  let callbacks;
  let disabled = false;
  let error = null;
  let releaseOutput;
  let saved = 0;
  const controller = createOutputController({
    batchClient: {
      createOutput() {
        return new Promise((resolve) => {
          releaseOutput = () => resolve({ bytes: new Uint8Array([1]), filename: "old.txt", mimeType: "text/plain" });
        });
      },
      async refreshOutput() { throw new Error("not used"); },
    },
    model,
    status: { announce() {} },
    view: {
      bind(value) { callbacks = value; },
      render(plan, _format, busy) {
        disabled = busy || !plan.canDownload;
        error = null;
      },
      renderError(message, canRetry) {
        disabled = !canRetry;
        error = message;
      },
      save() { saved += 1; },
    },
  });
  controller.bind();

  callbacks.onDownload();
  assert.equal(disabled, true);
  model.setInputFormat("xlsx");
  releaseOutput();
  await controller.whenIdle();

  assert.equal(saved, 0, "the output for the previous input family stays discarded");
  assert.match(error, /工作區已在建立下載期間變更/u);
  assert.equal(disabled, false, "the current valid output can be generated immediately");
});
