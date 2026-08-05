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

function controllerHarness({ archiveError, archiveExtraction, confirmClear = true, parsedRows } = {}) {
  let callbacks;
  let snapshot = { files: [], selectedFileId: null, outputFormat: "big5-txt", sources: [] };
  const announcements = [];
  const messages = [];
  const undos = [];
  const model = createWorkspaceModel();
  const view = {
    bind(value) { callbacks = value; },
    clear() {},
    clearMessage() {},
    confirmClear() { return confirmClear; },
    fileInput() { return { click() {} }; },
    render(value) { snapshot = value; },
    renderMessage(title, details, tone) { messages.push({ details, title, tone }); },
    renderUndo(message, onUndo) { undos.push({ message, onUndo }); },
  };
  const controller = createInputController({
    codecs: {
      async prepareSource() {},
      async zip() {
        return {
          async extractZip() {
            if (archiveError) throw archiveError;
            return archiveExtraction ?? {
              files: [{
                bytes: new TextEncoder().encode("A,01"),
                relativePath: "folder/from-zip.csv",
                size: 4,
                virtualPath: "bundle/folder/from-zip.csv",
              }],
              skippedEntries: [],
            };
          },
        };
      },
    },
    inputAdapter: {
      async parse() { return { rows: parsedRows ?? [["A", "01"]] }; },
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
    messages,
    model,
    snapshot: () => snapshot,
    undos,
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
  assert.ok(harness.snapshot().files.every((file) => file.unread));
  assert.equal(harness.model.selectedItem()?.virtualPath, "first.csv");
  assert.equal(harness.messages.length, 0);
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
  assert.match(harness.undos.at(-1)?.message, /原始檔案沒有變更/u);
  harness.undos.at(-1)?.onUndo();
  assert.deepEqual(harness.snapshot().files.map((file) => file.virtualPath), ["first.csv", "second.csv"]);
  assert.deepEqual(harness.snapshot().sources.map((source) => source.name), ["first.csv", "second.csv"]);
  harness.callbacks().onClearWorkspace();
  assert.deepEqual(harness.snapshot().files, []);
  assert.deepEqual(harness.snapshot().sources, []);
  assert.match(harness.announcements.at(-1), /原始檔案沒有變更/u);
});

test("clear all keeps the workspace when confirmation is cancelled", async () => {
  const harness = controllerHarness({ confirmClear: false });
  harness.callbacks().onFilesChosen([sourceFile("first.csv", "A,01")]);
  await harness.controller.whenIdle();
  harness.callbacks().onClearWorkspace();
  assert.deepEqual(harness.snapshot().files.map((file) => file.virtualPath), ["first.csv"]);
  assert.doesNotMatch(harness.announcements.at(-1), /清單已清空/u);
});

test("removing an archive source is undoable with its extracted files", async () => {
  const harness = controllerHarness();
  harness.callbacks().onFilesChosen([sourceFile("bundle.zip", "zip")]);
  await harness.controller.whenIdle();
  const sourceId = harness.snapshot().sources[0]?.id;
  harness.callbacks().onRemoveSource(sourceId);
  assert.deepEqual(harness.snapshot().files, []);
  assert.deepEqual(harness.snapshot().sources, []);
  assert.match(harness.announcements.at(-1), /共 1 個項目/u);
  assert.match(harness.undos.at(-1)?.message, /bundle\.zip/u);
  harness.undos.at(-1)?.onUndo();
  assert.deepEqual(harness.snapshot().files.map((file) => file.virtualPath), [
    "bundle/folder/from-zip.csv",
  ]);
  assert.deepEqual(harness.snapshot().sources.map((source) => source.name), ["bundle.zip"]);
  assert.match(harness.announcements.at(-1), /已復原/u);
});

test("a row output decision updates the shared model summary", async () => {
  const harness = controllerHarness();
  harness.callbacks().onFilesChosen([sourceFile("invalid.csv", "A,01")]);
  await harness.controller.whenIdle();
  const file = harness.model.selectedItem().file;
  assert.equal(file.rows[0].included, true);
  assert.equal(file.summary.includedRows, 1);
  harness.callbacks().onRowIncludedChange(1, false);
  assert.equal(file.rows[0].included, false);
  assert.equal(file.summary.includedRows, 0);
  assert.match(harness.announcements.at(-1), /第 1 列已排除輸出/u);
  harness.callbacks().onRowIncludedChange(1, true);
  assert.equal(file.rows[0].included, true);
  assert.equal(file.summary.includedRows, 1);
  assert.match(harness.announcements.at(-1), /第 1 列已納入輸出/u);
});

test("bulk row actions update only the current filtered page", async () => {
  const harness = controllerHarness({
    parsedRows: [["A", "01"], ["B", "02"], ["C", "03"]],
  });
  harness.callbacks().onFilesChosen([sourceFile("invalid.csv", "A,01")]);
  await harness.controller.whenIdle();
  const file = harness.model.selectedItem().file;

  harness.callbacks().onVisibleRowsIncludedChange([1, 3], false);
  assert.deepEqual(file.rows.map((row) => row.included), [false, true, false]);
  assert.equal(file.summary.includedRows, 1);
  assert.match(harness.announcements.at(-1), /已取消選取本頁/u);

  harness.callbacks().onVisibleRowsIncludedChange([3], true);
  assert.deepEqual(file.rows.map((row) => row.included), [false, true, true]);
  assert.equal(file.summary.includedRows, 2);
  assert.match(harness.announcements.at(-1), /已選取本頁/u);
});

test("output format is global workspace state", () => {
  const harness = controllerHarness();
  harness.model.setOutputFormat("csv");
  assert.equal(harness.model.snapshot().outputFormat, "csv");
});

test("excluded ZIP entries are shown as separate path messages", async () => {
  const harness = controllerHarness({
    archiveExtraction: {
      files: [{
        bytes: new TextEncoder().encode("A,01"),
        relativePath: "accepted/data.csv",
        size: 4,
        virtualPath: "excluded-entries/accepted/data.csv",
      }],
      skippedEntries: [
        { relativePath: "excluded/link.csv", reason: "symlink", virtualPath: "excluded-entries/excluded/link.csv" },
        { relativePath: "excluded/notes.md", reason: "unsupported-type", virtualPath: "excluded-entries/excluded/notes.md" },
      ],
    },
  });
  harness.callbacks().onFilesChosen([sourceFile("excluded-entries.zip", "zip")]);
  await harness.controller.whenIdle();
  assert.deepEqual(
    harness.snapshot().files.filter((file) => file.state === "ignored").map((file) => ({
      reason: file.ignoredReason,
      relativePath: file.relativePath,
    })),
    [
      { reason: "symlink", relativePath: "excluded/link.csv" },
      { reason: "unsupported-type", relativePath: "excluded/notes.md" },
    ],
  );
  assert.equal(harness.messages.length, 0);
});

test("unsupported direct selections remain visible without entering output", async () => {
  const harness = controllerHarness();
  harness.callbacks().onFilesChosen([sourceFile("notes.pdf", "not supported")]);
  await harness.controller.whenIdle();
  assert.equal(harness.snapshot().files[0]?.state, "ignored");
  assert.equal(harness.snapshot().files[0]?.ignoredReason, "unsupported-type");
  assert.equal(harness.snapshot().files[0]?.unread, undefined);
});

test("new badges remain until deliberate selection or bulk acknowledgement", async () => {
  const harness = controllerHarness();
  harness.callbacks().onFilesChosen([sourceFile("first.csv", "A,01"), sourceFile("second.csv", "B,02")]);
  await harness.controller.whenIdle();
  const [first, second] = harness.snapshot().files;
  assert.equal(first?.unread, true, "automatic initial selection does not acknowledge the file");
  harness.callbacks().onSelectFile(first.id);
  assert.equal(harness.snapshot().files[0]?.unread, false);
  assert.equal(harness.snapshot().files[1]?.unread, true);
  harness.callbacks().onMarkAllViewed();
  assert.equal(harness.snapshot().files[1]?.unread, false);
  assert.match(harness.announcements.at(-1), /1 個檔案/u);
});

test("technical archive failures are presented with a helpful next step", async () => {
  const harness = controllerHarness({
    archiveError: new Error("不支援加密的 ZIP 項目：private/data.csv"),
  });
  harness.callbacks().onFilesChosen([sourceFile("protected.zip", "zip")]);
  await harness.controller.whenIdle();
  assert.equal(
    harness.snapshot().files[0]?.error,
    "壓縮檔內有受密碼保護的檔案，請先解除密碼後再試：private/data.csv",
  );
  assert.doesNotMatch(harness.snapshot().files[0]?.error, /ZIP|項目|加密/u);
});
