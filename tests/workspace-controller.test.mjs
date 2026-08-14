import assert from "node:assert/strict";
import test from "node:test";

import { createInputController } from "../src/app/sections/input/input-controller.ts";
import { createWorkspaceModel } from "../src/app/state/workspace-model.ts";
import { createInternalFile } from "../src/core/conversion-pipeline.ts";
import { detectSourceFileType, fileFormatForSourceType } from "../src/core/file-formats.ts";
import { summarizeInternalFile } from "../src/core/internal-model.ts";
import { validateOutput } from "../src/core/output-validation.ts";

function sourceFile(name, contents) {
  const bytes = new TextEncoder().encode(contents);
  return {
    async arrayBuffer() { return bytes.slice().buffer; },
    name,
    size: bytes.byteLength,
  };
}

function parsedRow(label) {
  return [label, ...Array(14).fill("x")];
}

function controllerHarness({ archiveError, archiveExtraction, confirmClear = true, onArchiveExtract, onProcessStart, onProcessingInfo, parsedRows, processError, processGate, restoreGate } = {}) {
  let callbacks;
  let snapshot = { files: [], inputFormat: "csv", selectedFileId: null, outputFormat: "big5-txt", sources: [] };
  const announcements = [];
  const messages = [];
  const operationStatuses = [];
  const pickerLocks = [];
  const undos = [];
  const model = createWorkspaceModel();
  model.setInputFormat("csv");
  const view = {
    bind(value) { callbacks = value; },
    clearPreview() {},
    confirmClear() { return confirmClear; },
    fileInput() { return { click() {} }; },
    focusFilePicker() {},
    render(value, options = {}) {
      snapshot = value;
      pickerLocks.push({
        clearEnabled: options.clearEnabled ?? false,
        locked: options.operationLocked ?? false,
        visible: options.processingVisible ?? false,
      });
    },
    renderOperationStatus(status) {
      operationStatuses.push(status);
      if (status.kind === "processing") onProcessingInfo?.(status.progress);
      if (status.kind === "result" && status.failures.length > 0) {
        messages.push({ groups: status.failures, title: status.activeCount + status.otherCount > 0 ? "新增完成，有些項目未加入" : "這次沒有加入檔案" });
      }
      if (status.kind === "removed") undos.push({ message: status.detail, onUndo: status.onUndo });
    },
    renderPreviewPage() {},
  };
  const workerFiles = new Map();
  const removedWorkerFiles = new Map();
  const cancelledSources = new Set();
  let progressListener = null;

  function record(file, outputFormat = "big5-txt") {
    const outputIssues = validateOutput([file], outputFormat);
    return Object.assign(file, {
      blockingOutputIssues: outputIssues.filter((issue) => issue.blocking),
      fileIssueMessages: file.issues.filter((issue) => issue.severity === "error" && issue.sourceRow === undefined).map((issue) => issue.message),
      outputFormat,
      outputReplacementRows: new Set(outputIssues.filter((issue) => !issue.blocking).map((issue) => issue.sourceRow)).size,
      selectionRevision: file.selectionRevision ?? 0,
    });
  }

  function parsedFile(id, virtualPath, today, outputFormat) {
    const file = createInternalFile(id, virtualPath, { rows: parsedRows ?? [parsedRow("A")] }, today);
    workerFiles.set(id, file);
    return record(file, outputFormat);
  }

  const batchClient = {
    async cancelSource(sourceId) { cancelledSources.add(sourceId); },
    async resetWorkspace() {
      workerFiles.clear();
      removedWorkerFiles.clear();
    },
    async discardFiles(fileIds) {
      fileIds.forEach((id) => {
        workerFiles.delete(id);
        removedWorkerFiles.delete(id);
      });
    },
    async getPreviewPage() { throw new Error("not used"); },
    async processSource(request) {
      progressListener?.({ current: 0, phase: request.inputType === "zip" ? "extracting" : "processing", sourceId: request.sourceId, total: 1, virtualPath: request.sourceName });
      onProcessStart?.(request);
      if (processGate) await (typeof processGate === "function" ? processGate(request) : processGate);
      if (cancelledSources.has(request.sourceId)) throw new Error("本次新增已取消。");
      if (processError) throw processError;
      if (request.inputType !== "zip") {
        if (request.existingPaths.includes(request.sourceName)) {
          throw new Error(`清單中已有這個檔案，因此沒有重複加入：${request.sourceName}`);
        }
        const id = `${request.sourceId}:file`;
        return {
          entries: [{
            file: parsedFile(id, request.sourceName, request.today, request.outputFormat),
            id,
            relativePath: request.sourceName,
            size: request.bytes.byteLength,
            sourceFormat: fileFormatForSourceType(request.inputType),
            virtualPath: request.sourceName,
          }],
          skippedEntries: [],
        };
      }
      onArchiveExtract?.();
      if (archiveError) throw archiveError;
      const extraction = archiveExtraction ?? {
        files: [{
          bytes: new TextEncoder().encode("A,01"),
          relativePath: "folder/from-zip.csv",
          size: 4,
          virtualPath: "bundle/folder/from-zip.csv",
        }],
        skippedEntries: [],
      };
      const duplicate = extraction.files.find((entry) => request.existingPaths.includes(entry.virtualPath));
      if (duplicate) {
        throw new Error(`清單中已有這個檔案，因此沒有重複加入：${duplicate.virtualPath}`);
      }
      return {
        entries: extraction.files.map((entry, index) => {
          const type = detectSourceFileType(entry.virtualPath);
          const id = `${request.sourceId}:entry:${index + 1}`;
          return {
            file: parsedFile(id, entry.virtualPath, request.today, request.outputFormat),
            id,
            relativePath: entry.relativePath,
            size: entry.size,
            sourceFormat: fileFormatForSourceType(type),
            virtualPath: entry.virtualPath,
          };
        }),
        skippedEntries: extraction.skippedEntries,
      };
    },
    async refreshOutput(fileIds, outputFormat) { return fileIds.map((id) => record(workerFiles.get(id), outputFormat)); },
    async removeFiles(fileIds) {
      fileIds.forEach((id) => {
        const file = workerFiles.get(id);
        if (file) removedWorkerFiles.set(id, file);
        workerFiles.delete(id);
      });
    },
    async restoreFiles(fileIds) {
      if (restoreGate) await restoreGate;
      fileIds.forEach((id) => {
        const file = removedWorkerFiles.get(id);
        if (file) workerFiles.set(id, file);
        removedWorkerFiles.delete(id);
      });
    },
    setProgressListener(listener) { progressListener = listener; },
    async setRowIncluded(fileId, sourceRow, included, outputFormat) {
      const file = workerFiles.get(fileId);
      file.rows.find((row) => row.sourceRow === sourceRow).included = included;
      file.summary = summarizeInternalFile(file, file.summary.sourceRecords);
      return record(file, outputFormat);
    },
    async setRowsIncluded(fileId, sourceRows, included, outputFormat) {
      const file = workerFiles.get(fileId);
      file.rows.filter((row) => sourceRows.includes(row.sourceRow)).forEach((row) => { row.included = included; });
      file.summary = summarizeInternalFile(file, file.summary.sourceRecords);
      return record(file, outputFormat);
    },
  };
  const controller = createInputController({
    batchClient,
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
    operationStatuses,
    pickerLocks,
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
  assert.ok(harness.snapshot().files.every((file) => file.file));
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

test("does not flash processing information for fast work", async () => {
  const progressEvents = [];
  const harness = controllerHarness({
    onProcessingInfo(progress) { if (progress) progressEvents.push(progress); },
  });
  harness.callbacks().onFilesChosen([sourceFile("bundle.zip", "zip")]);
  await harness.controller.whenIdle();
  assert.deepEqual(progressEvents, []);
  assert.equal(harness.pickerLocks.some(({ locked, visible }) => locked && visible), false);
});

test("reveals processing information when work takes longer", async () => {
  let releaseProcessing;
  let signalStarted;
  const gatePromise = new Promise((resolve) => { releaseProcessing = resolve; });
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const progressEvents = [];
  const harness = controllerHarness({
    onProcessStart() { signalStarted(); },
    onProcessingInfo(progress) { progressEvents.push(progress); },
    processGate: gatePromise,
  });

  harness.callbacks().onFilesChosen([sourceFile("bundle.zip", "zip")]);
  await started;
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.ok(progressEvents.some((progress) => progress?.virtualPath === "bundle.zip"));

  releaseProcessing();
  await harness.controller.whenIdle();
  assert.equal(harness.operationStatuses.at(-1)?.kind, "result");
});

test("ignores another file selection while the current selection is processing", async () => {
  let releaseProcessing;
  let signalStarted;
  const gatePromise = new Promise((resolve) => { releaseProcessing = resolve; });
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const harness = controllerHarness({
    onProcessStart() { signalStarted(); },
    processGate: gatePromise,
  });
  harness.callbacks().onFilesChosen([sourceFile("first.csv", "A,01")]);
  await started;
  harness.callbacks().onFilesChosen([sourceFile("ignored.csv", "B,02")]);
  releaseProcessing();
  await harness.controller.whenIdle();
  assert.deepEqual(harness.snapshot().files.map((file) => file.virtualPath), ["first.csv"]);
});

test("clear stays enabled and preempts an in-flight upload", async () => {
  let releaseProcessing;
  let signalStarted;
  const gatePromise = new Promise((resolve) => { releaseProcessing = resolve; });
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const harness = controllerHarness({
    onProcessStart() { signalStarted(); },
    processGate: gatePromise,
  });

  harness.callbacks().onFilesChosen([sourceFile("large.csv", "A,01")]);
  await started;
  assert.ok(harness.pickerLocks.some(({ clearEnabled, locked }) => clearEnabled && locked));
  harness.callbacks().onClearWorkspace();
  assert.equal(harness.operationStatuses.at(-1)?.kind, "resetting");
  assert.deepEqual(harness.snapshot().files, []);

  releaseProcessing();
  await harness.controller.whenIdle();
  assert.deepEqual(harness.snapshot().files, []);
  assert.equal(harness.operationStatuses.at(-1)?.kind, "cleared");
  assert.equal(harness.operationStatuses.some(({ kind }) => kind === "result"), false);
});

test("cancelling a slow selection discards the whole staged batch and preserves prior files", async () => {
  let releaseProcessing;
  let signalStarted;
  const gatePromise = new Promise((resolve) => { releaseProcessing = resolve; });
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const harness = controllerHarness({
    onProcessStart(request) { if (request.sourceName === "large.csv") signalStarted(); },
    processGate(request) { return request.sourceName === "large.csv" ? gatePromise : undefined; },
  });
  harness.callbacks().onFilesChosen([sourceFile("prior.csv", "A,01")]);
  await harness.controller.whenIdle();

  harness.callbacks().onFilesChosen([
    sourceFile("staged.csv", "B,02"),
    sourceFile("large.csv", "C,03"),
  ]);
  await started;
  assert.deepEqual(harness.snapshot().files.map((file) => file.virtualPath), ["prior.csv"]);
  assert.ok(harness.pickerLocks.some(({ locked, visible }) => locked && !visible));
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.ok(harness.pickerLocks.some(({ locked, visible }) => locked && visible));
  assert.equal(harness.operationStatuses.at(-1)?.kind, "processing");

  harness.callbacks().onCancelFileOperation();
  assert.equal(harness.operationStatuses.at(-1)?.kind, "cancelling");
  releaseProcessing();
  await harness.controller.whenIdle();

  assert.deepEqual(harness.snapshot().files.map((file) => file.virtualPath), ["prior.csv"]);
  assert.equal(harness.operationStatuses.at(-1)?.kind, "cancelled");
  assert.match(harness.announcements.at(-1), /先前的檔案仍保留/u);
});

test("individual removal and clear all only change the browser workspace", async () => {
  const harness = controllerHarness();
  harness.callbacks().onFilesChosen([sourceFile("first.csv", "A,01"), sourceFile("second.csv", "B,02")]);
  await harness.controller.whenIdle();
  harness.callbacks().onRemoveFile(harness.snapshot().files[0].id);
  assert.deepEqual(harness.snapshot().files.map((file) => file.virtualPath), ["first.csv", "second.csv"]);
  await harness.controller.whenIdle();
  assert.deepEqual(harness.snapshot().files.map((file) => file.virtualPath), ["second.csv"]);
  assert.deepEqual(harness.snapshot().sources.map((source) => source.name), ["second.csv"]);
  assert.match(harness.undos.at(-1)?.message, /原始檔案沒有變更/u);
  harness.undos.at(-1)?.onUndo();
  await harness.controller.whenIdle();
  assert.deepEqual(harness.snapshot().files.map((file) => file.virtualPath), ["first.csv", "second.csv"]);
  assert.deepEqual(harness.snapshot().sources.map((source) => source.name), ["first.csv", "second.csv"]);
  harness.callbacks().onClearWorkspace();
  await harness.controller.whenIdle();
  assert.deepEqual(harness.snapshot().files, []);
  assert.deepEqual(harness.snapshot().sources, []);
  assert.match(harness.announcements.at(-1), /原始檔案沒有變更/u);
});

test("undo publishes a restored file only after worker restoration completes", async () => {
  let releaseRestore;
  const restoreGate = new Promise((resolve) => { releaseRestore = resolve; });
  const harness = controllerHarness({ restoreGate });
  harness.callbacks().onFilesChosen([sourceFile("first.csv", "A,01")]);
  await harness.controller.whenIdle();
  harness.callbacks().onRemoveFile(harness.snapshot().files[0].id);
  await harness.controller.whenIdle();

  harness.undos.at(-1)?.onUndo();
  assert.equal(harness.operationStatuses.at(-1)?.kind, "restoring");
  assert.deepEqual(harness.snapshot().files, []);
  releaseRestore();
  await harness.controller.whenIdle();
  assert.deepEqual(harness.snapshot().files.map((file) => file.virtualPath), ["first.csv"]);
  assert.equal(harness.operationStatuses.at(-1)?.kind, "restored");
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
  await harness.controller.whenIdle();
  assert.deepEqual(harness.snapshot().files, []);
  assert.deepEqual(harness.snapshot().sources, []);
  assert.match(harness.announcements.at(-1), /共 1 個項目/u);
  assert.match(harness.undos.at(-1)?.message, /bundle\.zip/u);
  harness.undos.at(-1)?.onUndo();
  await harness.controller.whenIdle();
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
    parsedRows: [parsedRow("A"), parsedRow("B"), parsedRow("C")],
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

test("stores mixed uploads by family and treats XLS as XLSX", async () => {
  const harness = controllerHarness();
  harness.callbacks().onFilesChosen([
    sourceFile("legacy.txt", "A,01"),
    sourceFile("current.csv", "A,01"),
    sourceFile("legacy.xls", "A,01"),
    sourceFile("current.xlsx", "A,01"),
  ]);
  await harness.controller.whenIdle();

  assert.deepEqual(
    harness.snapshot().files.map((file) => file.sourceFormat),
    ["txt", "csv", "xlsx", "xlsx"],
  );
  assert.equal(harness.model.selectedItem()?.virtualPath, "current.csv");
  assert.deepEqual(harness.operationStatuses.at(-1), {
    kind: "result",
    activeCount: 1,
    activeFormat: "csv",
    failures: [],
    otherCount: 3,
  });
  harness.model.setInputFormat("xlsx");
  assert.equal(harness.model.selectedItem()?.virtualPath, "legacy.xls");
});

test("excluded ZIP entries stay out of the workspace and are grouped by category", async () => {
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
  assert.deepEqual(harness.snapshot().files.map((file) => file.virtualPath), [
    "excluded-entries/accepted/data.csv",
  ]);
  assert.deepEqual(harness.messages[0]?.groups, [
    { files: ["excluded-entries.zip／excluded/link.csv"], label: "捷徑", tone: "warning" },
    { files: ["excluded-entries.zip／excluded/notes.md"], label: "不支援的檔案類型（MD）", tone: "warning" },
  ]);
});

test("unsupported direct selections stay out of the workspace and are grouped by extension", async () => {
  const harness = controllerHarness();
  harness.callbacks().onFilesChosen([
    sourceFile("photo.png", "not supported"),
    sourceFile("diagram.png", "not supported"),
    sourceFile("notes.pdf", "not supported"),
  ]);
  await harness.controller.whenIdle();
  assert.deepEqual(harness.snapshot().files, []);
  assert.deepEqual(harness.snapshot().sources, []);
  assert.deepEqual(harness.messages[0]?.groups, [
    { files: ["photo.png", "diagram.png"], label: "不支援的檔案類型（PNG）", tone: "warning" },
    { files: ["notes.pdf"], label: "不支援的檔案類型（PDF）", tone: "warning" },
  ]);
});

test("duplicate files stay out of the workspace and share one failure category", async () => {
  const harness = controllerHarness();
  harness.callbacks().onFilesChosen([sourceFile("foo.csv", "A,01"), sourceFile("bundle.zip", "zip")]);
  await harness.controller.whenIdle();
  harness.callbacks().onFilesChosen([sourceFile("foo.csv", "A,01"), sourceFile("bundle.zip", "zip")]);
  await harness.controller.whenIdle();

  assert.deepEqual(harness.snapshot().sources.map((source) => source.name), ["foo.csv", "bundle.zip"]);
  assert.deepEqual(harness.messages.at(-1)?.groups, [{
    files: ["foo.csv", "bundle.zip"],
    label: "重複檔案",
    tone: "warning",
  }]);
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

test("encrypted archives are categorized without leaving failed workspace items", async () => {
  const harness = controllerHarness({
    archiveError: new Error("不支援加密的 ZIP 項目：private/data.csv"),
  });
  harness.callbacks().onFilesChosen([sourceFile("protected.zip", "zip")]);
  await harness.controller.whenIdle();
  assert.deepEqual(harness.snapshot().files, []);
  assert.deepEqual(harness.snapshot().sources, []);
  assert.deepEqual(harness.messages, [{
    groups: [{ files: ["protected.zip"], label: "受密碼保護", tone: "error" }],
    title: "這次沒有加入檔案",
  }]);
});

test("corrupted supported files are categorized without leaving failed workspace items", async () => {
  const harness = controllerHarness({ processError: new Error("workbook container is invalid") });
  harness.callbacks().onFilesChosen([sourceFile("broken.xlsx", "not a workbook")]);
  await harness.controller.whenIdle();

  assert.deepEqual(harness.snapshot().files, []);
  assert.deepEqual(harness.snapshot().sources, []);
  assert.deepEqual(harness.messages[0]?.groups, [{
    files: ["broken.xlsx"],
    label: "無法開啟或內容格式不符",
    tone: "error",
  }]);
});

test("an empty archive keeps an actionable not-added message", async () => {
  const harness = controllerHarness({
    archiveExtraction: { files: [], skippedEntries: [] },
  });
  harness.callbacks().onFilesChosen([sourceFile("empty.zip", "zip")]);
  await harness.controller.whenIdle();

  assert.deepEqual(harness.snapshot().files, []);
  assert.deepEqual(harness.snapshot().sources, []);
  assert.deepEqual(harness.messages[0]?.groups, [{
    files: ["empty.zip"],
    label: "沒有支援的 TXT、CSV、XLS 或 XLSX 檔案",
    tone: "warning",
  }]);
});
