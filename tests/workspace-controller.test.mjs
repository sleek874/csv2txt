import assert from "node:assert/strict";
import test from "node:test";

import { createInputController } from "../src/app/sections/input/input-controller.ts";
import { createWorkspaceModel } from "../src/app/state/workspace-model.ts";

function sourceFile(name, contents) {
  const bytes = new TextEncoder().encode(contents);
  return {
    async arrayBuffer() { return bytes.slice().buffer; },
    name,
    size: bytes.byteLength,
  };
}

function controllerHarness() {
  let callbacks;
  let snapshot = { files: [], selectedFileId: null, outputFormat: "big5-txt", sources: [] };
  const announcements = [];
  const model = createWorkspaceModel();
  const view = {
    bind(value) { callbacks = value; },
    clear() {},
    fileInput() { return { click() {} }; },
    render(value) { snapshot = value; },
    renderError() {},
  };
  const controller = createInputController({
    codecs: {
      async prepareSource() {},
      async zip() {
        return {
          async extractZip() {
            return {
              files: [{
                bytes: new TextEncoder().encode("A,01"),
                relativePath: "folder/from-zip.csv",
                size: 4,
                virtualPath: "bundle/folder/from-zip.csv",
              }],
              skippedEntries: 0,
            };
          },
        };
      },
    },
    inputAdapter: {
      async parse() { return { rows: [["A", "01"]] }; },
    },
    model,
    offlineCache: {
      async prepareOfflineUse() {},
      async prioritizePreviewFont() {},
    },
    status: { announce(message) { announcements.push(message); } },
    unloadGuard: { setPendingFile() {} },
    view,
  });
  controller.bind();
  return {
    announcements,
    callbacks: () => callbacks,
    controller,
    model,
    snapshot: () => snapshot,
  };
}

test("new file selections append to the existing workspace", async () => {
  const harness = controllerHarness();
  harness.callbacks().onFilesChosen([sourceFile("first.csv", "A,01")]);
  await harness.controller.whenIdle();
  harness.callbacks().onFilesChosen([sourceFile("second.csv", "B,02")]);
  await harness.controller.whenIdle();
  assert.deepEqual(harness.snapshot().files.map((file) => file.virtualPath), ["first.csv", "second.csv"]);
  assert.deepEqual(harness.snapshot().sources.map((source) => source.name), ["first.csv", "second.csv"]);
  assert.ok(harness.snapshot().files.every((file) => file.state === "ready"));
  assert.equal(harness.model.selectedItem()?.virtualPath, "first.csv");
});

test("ZIP extraction appends files using their virtual paths", async () => {
  const harness = controllerHarness();
  harness.callbacks().onFilesChosen([sourceFile("bundle.zip", "zip")]);
  await harness.controller.whenIdle();
  assert.deepEqual(harness.snapshot().files.map((file) => file.virtualPath), ["bundle/folder/from-zip.csv"]);
  assert.deepEqual(harness.snapshot().files.map((file) => file.relativePath), ["folder/from-zip.csv"]);
  assert.deepEqual(harness.snapshot().sources.map((source) => source.name), ["bundle.zip"]);
});

test("individual removal and clear all only change the browser workspace", async () => {
  const harness = controllerHarness();
  harness.callbacks().onFilesChosen([sourceFile("first.csv", "A,01"), sourceFile("second.csv", "B,02")]);
  await harness.controller.whenIdle();
  harness.callbacks().onRemoveFile(harness.snapshot().files[0].id);
  assert.deepEqual(harness.snapshot().files.map((file) => file.virtualPath), ["second.csv"]);
  assert.deepEqual(harness.snapshot().sources.map((source) => source.name), ["second.csv"]);
  harness.callbacks().onClearWorkspace();
  assert.deepEqual(harness.snapshot().files, []);
  assert.deepEqual(harness.snapshot().sources, []);
  assert.match(harness.announcements.at(-1), /原始檔案沒有變更/u);
});

test("removing an archive source removes all of its extracted files", async () => {
  const harness = controllerHarness();
  harness.callbacks().onFilesChosen([sourceFile("bundle.zip", "zip")]);
  await harness.controller.whenIdle();
  const sourceId = harness.snapshot().sources[0]?.id;
  harness.callbacks().onRemoveSource(sourceId);
  assert.deepEqual(harness.snapshot().files, []);
  assert.deepEqual(harness.snapshot().sources, []);
  assert.match(harness.announcements.at(-1), /共 1 個檔案/u);
});

test("a row output decision updates the shared model summary", async () => {
  const harness = controllerHarness();
  harness.callbacks().onFilesChosen([sourceFile("invalid.csv", "A,01")]);
  await harness.controller.whenIdle();
  const file = harness.model.selectedItem().file;
  assert.equal(file.rows[0].included, false);
  assert.equal(file.summary.includedRows, 0);
  harness.callbacks().onRowIncludedChange(1, true);
  assert.equal(file.rows[0].included, true);
  assert.equal(file.summary.includedRows, 1);
  assert.match(harness.announcements.at(-1), /第 1 列已納入輸出/u);
});

test("output format is global workspace state", () => {
  const harness = controllerHarness();
  harness.model.setOutputFormat("csv");
  assert.equal(harness.model.snapshot().outputFormat, "csv");
});
