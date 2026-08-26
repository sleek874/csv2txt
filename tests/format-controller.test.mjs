import assert from "node:assert/strict";
import test from "node:test";

import { ActionInterruptedError } from "../src/app/batch/batch-client.ts";
import { createFormatController } from "../src/app/sections/format/format-controller.ts";
import { createOutputController } from "../src/app/sections/output/output-controller.ts";
import { createWorkspaceModel } from "../src/app/state/workspace-model.ts";

const runtimeClient = {
  invalidateOutput() {},
  runtime() { return { state: "ready", error: null }; },
  subscribeRecovered() { return () => undefined; },
  subscribeOutputInvalidation() { return () => undefined; },
};

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
    batchClient: runtimeClient,
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
      ...runtimeClient,
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
      ...runtimeClient,
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
  let invalidateOutput;
  const announcements = [];
  const batchClient = {
    ...runtimeClient,
    invalidateOutput() { invalidateOutput?.(); },
    subscribeOutputInvalidation(listener) {
      invalidateOutput = listener;
      return () => undefined;
    },
    createOutput() {
      return new Promise((resolve) => {
        releaseOutput = () => resolve({ blob: new Blob([new Uint8Array([1])]), filename: "old.txt" });
      });
    },
    async refreshOutput() { throw new Error("not used"); },
  };
  const controller = createOutputController({
    batchClient,
    model,
    status: { announce(message) { announcements.push(message); } },
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
  batchClient.invalidateOutput();
  model.setInputFormat("xlsx");
  assert.equal(announcements.includes("工作區已變更，正在停止建立下載。"), true);
  releaseOutput();
  await controller.whenIdle();

  assert.equal(saved, 0, "the output for the previous input family stays discarded");
  assert.match(error, /工作區已在建立下載期間變更/u);
  assert.equal(disabled, false, "the current valid output can be generated immediately");
});

test("section 2 cancels generation from the right action slot", async () => {
  const model = modelWithFile();
  let callbacks;
  let rejectOutput;
  const states = [];
  const announcements = [];
  const controller = createOutputController({
    batchClient: {
      ...runtimeClient,
      async cancelOutput() { rejectOutput(new Error("已取消建立下載。")); },
      createOutput() {
        return new Promise((_resolve, reject) => { rejectOutput = reject; });
      },
      async refreshOutput() { throw new Error("not used"); },
    },
    model,
    status: { announce(message) { announcements.push(message); } },
    view: {
      bind(value) { callbacks = value; },
      render(_plan, _format, busy, cancelling) { states.push({ busy, cancelling }); },
      renderError() {},
      save() { throw new Error("cancelled output must not be saved"); },
    },
  });
  controller.bind();

  callbacks.onDownload();
  callbacks.onCancel();
  await controller.whenIdle();

  assert.deepEqual(states.slice(-3), [
    { busy: true, cancelling: false },
    { busy: true, cancelling: true },
    { busy: false, cancelling: false },
  ]);
  assert.equal(announcements.includes("已取消建立下載。"), true);
});

test("section 2 forwards request progress only while generating", async () => {
  const model = modelWithFile();
  let callbacks;
  let displayedProgress = null;
  const controller = createOutputController({
    batchClient: {
      ...runtimeClient,
      async createOutput(_fileIds, _format, onProgress) {
        onProgress({ current: 1, phase: "finalizing", total: 1, virtualPath: "primary.csv" });
        return { blob: new Blob([new Uint8Array([1])]), filename: "primary.txt" };
      },
      async refreshOutput() { throw new Error("not used"); },
    },
    model,
    status: { announce() {} },
    view: {
      bind(value) { callbacks = value; },
      render(_plan, _format, _busy, _cancelling, progress) {
        if (progress) displayedProgress = progress;
      },
      renderError() {},
      save() {},
    },
  });
  controller.bind();

  callbacks.onDownload();
  await controller.whenIdle();
  assert.deepEqual(displayedProgress, {
    current: 1, phase: "finalizing", total: 1, virtualPath: "primary.csv",
  });
});

test("section 2 preserves the concise retry-exhaustion detail", async () => {
  const model = modelWithFile();
  let callbacks;
  let error;
  const controller = createOutputController({
    batchClient: {
      ...runtimeClient,
      async createOutput() {
        throw new ActionInterruptedError("這項操作在自動重試後再次中斷。");
      },
      async refreshOutput() { throw new Error("not used"); },
    },
    model,
    status: { announce() {} },
    view: {
      bind(value) { callbacks = value; },
      render() {},
      renderError(detail) { error = detail; },
      save() {},
    },
  });
  controller.bind();
  callbacks.onDownload();
  await controller.whenIdle();
  assert.equal(error, "這項操作在自動重試後再次中斷。");
});
