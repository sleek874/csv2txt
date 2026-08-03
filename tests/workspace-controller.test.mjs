import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceController } from "../src/app/workspace-controller.ts";

function sourceFile(name, contents) {
  const bytes = new TextEncoder().encode(contents);
  return {
    async arrayBuffer() {
      return bytes.slice().buffer;
    },
    name,
    size: bytes.byteLength,
  };
}

function controllerHarness() {
  let callbacks;
  let inventory = [];
  let renderedFile = null;
  let selectedId = null;
  const announcements = [];
  const view = {
    announce(message) {
      announcements.push(message);
    },
    bind(value) {
      callbacks = value;
    },
    clear() {
      inventory = [];
      renderedFile = null;
      selectedId = null;
    },
    fileInput() {
      return { click() {} };
    },
    outputFormat() {
      return "big5-txt";
    },
    renderActiveError() {},
    renderActivePending() {},
    renderError() {},
    renderFile(file) {
      renderedFile = file;
    },
    renderInventory(files, activeId) {
      inventory = files.map((file) => ({
        id: file.id,
        state: file.state,
        virtualPath: file.virtualPath,
      }));
      selectedId = activeId;
    },
    saveOutput() {},
    setDownloadBusy() {},
    setProcessing() {},
    syncDownload() {},
  };
  const controller = createWorkspaceController({
    archive: {
      async extract() {
        return {
          files: [{
            bytes: new TextEncoder().encode("A,01"),
            size: 4,
            virtualPath: "bundle/folder/from-zip.csv",
          }],
          skippedEntries: 0,
        };
      },
    },
    offlineCache: {
      async prepareOfflineUse() {},
      async prioritizePreviewFont() {},
    },
    outputAdapter: {
      async create() {
        throw new Error("not used");
      },
    },
    sourceAdapter: {
      async parse() {
        return { rows: [["A", "01"]] };
      },
    },
    spreadsheet: {
      async create() {
        return new Uint8Array();
      },
      async parse() {
        return { rows: [], errors: [], sheetName: "Sheet1" };
      },
      async prepare() {},
    },
    unloadGuard: { setPendingFile() {} },
    view,
  });
  controller.bind();
  return {
    announcements,
    callbacks: () => callbacks,
    controller,
    inventory: () => inventory,
    renderedFile: () => renderedFile,
    selectedId: () => selectedId,
  };
}

test("new file selections append to the existing workspace", async () => {
  const harness = controllerHarness();
  harness.callbacks().onFilesChosen([sourceFile("first.csv", "A,01")]);
  await harness.controller.whenIdle();
  harness.callbacks().onFilesChosen([sourceFile("second.csv", "B,02")]);
  await harness.controller.whenIdle();

  assert.deepEqual(
    harness.inventory().map((file) => file.virtualPath),
    ["first.csv", "second.csv"],
  );
  assert.ok(harness.inventory().every((file) => file.state === "ready"));
  assert.equal(harness.inventory().find((file) => file.id === harness.selectedId())?.virtualPath, "first.csv");
});

test("ZIP extraction appends files using their virtual paths", async () => {
  const harness = controllerHarness();
  harness.callbacks().onFilesChosen([sourceFile("bundle.zip", "zip")]);
  await harness.controller.whenIdle();

  assert.deepEqual(
    harness.inventory().map((file) => file.virtualPath),
    ["bundle/folder/from-zip.csv"],
  );
});

test("individual removal and clear all only change the browser workspace", async () => {
  const harness = controllerHarness();
  harness.callbacks().onFilesChosen([
    sourceFile("first.csv", "A,01"),
    sourceFile("second.csv", "B,02"),
  ]);
  await harness.controller.whenIdle();
  const firstId = harness.inventory()[0].id;
  harness.callbacks().onRemoveFile(firstId);
  assert.deepEqual(harness.inventory().map((file) => file.virtualPath), ["second.csv"]);

  harness.callbacks().onClearWorkspace();
  assert.deepEqual(harness.inventory(), []);
  assert.match(harness.announcements.at(-1), /原始檔案沒有變更/u);
});

test("a row output decision updates the shared file summary", async () => {
  const harness = controllerHarness();
  harness.callbacks().onFilesChosen([sourceFile("invalid.csv", "A,01")]);
  await harness.controller.whenIdle();

  assert.equal(harness.renderedFile().rows[0].included, false);
  assert.equal(harness.renderedFile().summary.includedRows, 0);

  harness.callbacks().onRowIncludedChange(1, true);

  assert.equal(harness.renderedFile().rows[0].included, true);
  assert.equal(harness.renderedFile().summary.includedRows, 1);
  assert.match(harness.announcements.at(-1), /第 1 列已納入輸出/u);
});
