import type { OfflineCache } from "../../../browser/offline-cache";
import type { UnloadGuard } from "../../../browser/unload-guard";
import { exceedsFileSizeLimit, FILE_SIZE_LIMIT_LABEL } from "../../../core/file-size-policy";
import { detectInputFileType } from "../../../core/file-formats";
import { taipeiDateStamp } from "../../../core/validation";
import type { BatchClient } from "../../batch/batch-client";
import type { PreviewFilter, ProcessingProgress, SkippedEntry } from "../../batch/protocol";
import type { AppStatus } from "../../shell/app-status";
import type { WorkspaceModel } from "../../state/workspace-model";
import type { WorkspaceItem, WorkspaceSource } from "../../state/workspace-types";
import type { FileOperationStatus, UploadFailureGroup } from "./file-operation-status-view";
import type { InputSectionView } from "./input-section-view";

const OPERATION_FEEDBACK_DELAY_MS = 300;

interface InputControllerOptions {
  batchClient: BatchClient;
  model: WorkspaceModel;
  offlineCache: OfflineCache;
  status: AppStatus;
  unloadGuard: UnloadGuard;
  view: InputSectionView;
}

interface FailureCategory {
  label: string;
  tone: "error" | "warning";
}

interface UploadBatch {
  activeSourceId: string | null;
  cancelSignal: Promise<void>;
  cancelled: boolean;
  completedCandidateCount: number;
  currentSourceProgress: ProcessingProgress | null;
  reset: boolean;
  failures: Map<string, { category: FailureCategory; files: Set<string> }>;
  items: WorkspaceItem[];
  latestProgress: ProcessingProgress;
  signalCancel: () => void;
  sources: WorkspaceSource[];
}

type FeedbackPhase = "quiet" | "visible";

interface RemovingOperation {
  kind: "removing";
  phase: FeedbackPhase;
  previousStatus: FileOperationStatus;
  subject: string;
}

type WorkspaceOperation =
  | { kind: "idle"; status: FileOperationStatus }
  | { kind: "adding"; batch: UploadBatch; phase: FeedbackPhase }
  | { kind: "cancelling"; batch: UploadBatch }
  | RemovingOperation
  | { kind: "restoring" }
  | { kind: "resetting" };

function extensionLabel(path: string): string {
  const fileName = path.split("/").at(-1) ?? path;
  return fileName.match(/\.([^.]{1,8})$/u)?.[1]?.toLocaleUpperCase("en-US") ?? "未知";
}

function archiveFailureCategory(error: unknown): FailureCategory {
  const message = error instanceof Error ? error.message : "";
  if (/清單中已有這個檔案/u.test(message)) return { label: "重複檔案", tone: "warning" };
  if (/路徑不安全|路徑超過/u.test(message)) return { label: "不安全的壓縮檔內容", tone: "error" };
  if (/加密/u.test(message)) return { label: "受密碼保護", tone: "error" };
  if (/重複路徑/u.test(message)) return { label: "壓縮檔內有同名檔案", tone: "error" };
  if (/單檔.*超過/u.test(message)) return { label: `檔案超過 ${FILE_SIZE_LIMIT_LABEL}`, tone: "error" };
  if (/項目.*上限|項目累計/u.test(message)) return { label: "壓縮檔內檔案過多", tone: "error" };
  if (/巢狀/u.test(message)) return { label: "壓縮層數超過限制", tone: "error" };
  return { label: "無法開啟或內容損壞", tone: "error" };
}

function skippedArchiveCategory(reason: SkippedEntry["reason"], relativePath: string): FailureCategory {
  switch (reason) {
    case "symlink": return { label: "捷徑", tone: "warning" };
    case "unsupported-type": return {
      label: `不支援的檔案類型（${extensionLabel(relativePath)}）`,
      tone: "warning",
    };
    case "duplicate-path": return { label: "壓縮檔內有同名檔案", tone: "error" };
    case "encrypted": return { label: "受密碼保護", tone: "error" };
    case "too-large": return { label: `檔案超過 ${FILE_SIZE_LIMIT_LABEL}`, tone: "error" };
    case "unsafe-path": return { label: "不安全的壓縮檔內容", tone: "error" };
    case "archive-depth": return { label: "壓縮層數超過限制", tone: "error" };
    case "invalid-file": return { label: "無法開啟或內容格式不符", tone: "error" };
    case "invalid-archive":
    case "unsupported-compression":
    default: return { label: "無法開啟或內容損壞", tone: "error" };
  }
}

function addFailure(batch: UploadBatch, category: FailureCategory, file: string): void {
  const key = `${category.tone}:${category.label}`;
  const group = batch.failures.get(key) ?? { category, files: new Set<string>() };
  group.files.add(file);
  batch.failures.set(key, group);
}

function groupedFailures(batch: UploadBatch): UploadFailureGroup[] {
  return [...batch.failures.values()].map(({ category, files }) => ({ ...category, files: [...files] }));
}

export function createInputController(options: InputControllerOptions) {
  let nextSourceId = 1;
  let operation: WorkspaceOperation = { kind: "idle", status: { kind: "idle" } };
  let pendingTask = Promise.resolve();
  let validationDate: string | null = null;
  let previewRequest = 0;
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelFeedback(): void {
    if (feedbackTimer !== null) clearTimeout(feedbackTimer);
    feedbackTimer = null;
  }

  function deferFeedback(reveal: () => void): void {
    cancelFeedback();
    feedbackTimer = setTimeout(() => {
      feedbackTimer = null;
      reveal();
    }, OPERATION_FEEDBACK_DELAY_MS);
  }

  function currentBatch(): UploadBatch | null {
    return operation.kind === "adding" || operation.kind === "cancelling" ? operation.batch : null;
  }

  function updateBatchProgress(batch: UploadBatch, progress: ProcessingProgress): void {
    batch.currentSourceProgress = progress;
    batch.latestProgress = {
      ...progress,
      current: batch.completedCandidateCount + progress.current,
      total: batch.completedCandidateCount + progress.total,
    };
  }

  function visibleOperationStatus(): FileOperationStatus | null {
    switch (operation.kind) {
      case "idle": return operation.status;
      case "adding": return operation.phase === "visible"
        ? { kind: "processing", progress: operation.batch.latestProgress }
        : null;
      case "cancelling": return { kind: "cancelling" };
      case "removing": return operation.phase === "visible" || operation.previousStatus.kind === "removed"
        ? { kind: "removing", phase: operation.phase, subject: operation.subject }
        : null;
      case "restoring": return { kind: "restoring" };
      case "resetting": return { kind: "resetting" };
    }
  }

  function render(): void {
    const snapshot = options.model.snapshot();
    options.view.render(snapshot, {
      clearEnabled: operation.kind !== "resetting",
      operationLocked: operation.kind !== "idle",
      processingVisible: operation.kind === "adding" && operation.phase === "visible",
    });
    const status = visibleOperationStatus();
    if (status) options.view.renderOperationStatus(status);
    options.unloadGuard.setPendingFile(snapshot.sources.length > 0 || operation.kind !== "idle", "primary-workspace");
  }

  function renderOperationStatus(): void {
    const status = visibleOperationStatus();
    if (status) options.view.renderOperationStatus(status);
  }

  function settle(status: FileOperationStatus): void {
    cancelFeedback();
    operation = { kind: "idle", status };
    render();
  }

  async function requestPreview(fileId: string, filter: PreviewFilter, page: number): Promise<void> {
    const currentRequest = ++previewRequest;
    const outputFormat = options.model.snapshot().outputFormat;
    try {
      const preview = await options.batchClient.getPreviewPage(fileId, filter, page, outputFormat);
      if (currentRequest === previewRequest && options.model.snapshot().selectedFileId === fileId) {
        options.view.renderPreviewPage(preview);
      }
    } catch {
      if (currentRequest === previewRequest) options.view.renderPreviewError(fileId);
    }
  }

  async function processFile(sourceFile: File, batch: UploadBatch): Promise<void> {
    const inputType = detectInputFileType(sourceFile.name);
    if (!inputType) {
      addFailure(batch, { label: `不支援的檔案類型（${extensionLabel(sourceFile.name)}）`, tone: "warning" }, sourceFile.name);
      return;
    }
    if (sourceFile.size === 0 || exceedsFileSizeLimit(sourceFile.size)) {
      addFailure(batch, {
        label: sourceFile.size === 0 ? "空白檔案" : `檔案超過 ${FILE_SIZE_LIMIT_LABEL}`,
        tone: "error",
      }, sourceFile.name);
      return;
    }

    let bytes: Uint8Array;
    try {
      const buffer = await Promise.race([
        sourceFile.arrayBuffer(),
        batch.cancelSignal.then(() => null),
      ]);
      if (buffer === null) return;
      bytes = new Uint8Array(buffer);
    } catch {
      addFailure(batch, { label: "無法讀取檔案", tone: "error" }, sourceFile.name);
      return;
    }
    if (batch.cancelled) return;

    const existingPaths = [
      ...options.model.snapshot().files.map((item) => item.virtualPath),
      ...batch.items.map((item) => item.virtualPath),
    ];
    if (inputType !== "zip" && existingPaths.includes(sourceFile.name)) {
      addFailure(batch, { label: "重複檔案", tone: "warning" }, sourceFile.name);
      return;
    }

    const source = {
      id: `input-${nextSourceId++}`,
      kind: inputType === "zip" ? "archive" : "file",
      name: sourceFile.name,
    } satisfies WorkspaceSource;
    batch.activeSourceId = source.id;
    updateBatchProgress(batch, {
      current: 0,
      phase: inputType === "zip" ? "extracting" : "processing",
      sourceId: source.id,
      total: inputType === "zip" ? 0 : 1,
      virtualPath: sourceFile.name,
    });
    if (operation.kind === "adding" && operation.batch === batch && operation.phase === "visible") {
      renderOperationStatus();
    }

    let sourceCompleted = false;
    try {
      void options.offlineCache.prioritizePreviewFont().catch(() => undefined);
      const processing = options.batchClient.processSource({
        sourceId: source.id,
        sourceName: sourceFile.name,
        inputType,
        bytes,
        today: validationDate ?? taipeiDateStamp(),
        existingPaths,
        outputFormat: options.model.snapshot().outputFormat,
      });
      const result = await Promise.race([
        processing,
        batch.cancelSignal.then(() => null),
      ]);
      if (result === null) {
        if (!batch.reset) void processing.then((completed) => (
          options.batchClient.discardFiles(completed.entries.map((entry) => entry.id))
        )).catch(() => undefined);
        return;
      }
      if (batch.cancelled) {
        if (!batch.reset) await options.batchClient.discardFiles(result.entries.map((entry) => entry.id));
        return;
      }
      if (result.entries.length > 0) {
        batch.sources.push(source);
        batch.items.push(...result.entries.map((entry) => ({
          file: entry.file,
          id: entry.id,
          relativePath: entry.relativePath,
          size: entry.size,
          sourceFormat: entry.sourceFormat,
          sourceId: source.id,
          unread: true,
          virtualPath: entry.virtualPath,
        })));
      }
      result.skippedEntries.forEach((skipped) => addFailure(
        batch,
        skippedArchiveCategory(skipped.reason, skipped.relativePath),
        `${sourceFile.name}／${skipped.relativePath}`,
      ));
      if (result.entries.length === 0 && result.skippedEntries.length === 0) {
        addFailure(batch, { label: "沒有支援的 TXT、CSV、XLS 或 XLSX 檔案", tone: "warning" }, sourceFile.name);
      }
      sourceCompleted = true;
    } catch (error) {
      if (!batch.cancelled) addFailure(
        batch,
        inputType === "zip"
          ? archiveFailureCategory(error)
          : { label: "無法開啟或內容格式不符", tone: "error" },
        sourceFile.name,
      );
    } finally {
      if (sourceCompleted && batch.currentSourceProgress?.sourceId === source.id) {
        batch.completedCandidateCount += batch.currentSourceProgress.total;
      }
      if (batch.activeSourceId === source.id) batch.activeSourceId = null;
    }
  }

  async function discardBatch(batch: UploadBatch): Promise<void> {
    const fileIds = batch.items.map((item) => item.id);
    if (!batch.reset && fileIds.length > 0) void options.batchClient.discardFiles(fileIds).catch(() => undefined);
    if (batch.reset) return;
    if (operation.kind !== "cancelling" || operation.batch !== batch) return;
    settle({ kind: "cancelled" });
    options.status.announce("已取消本次新增；這次選取的檔案都沒有加入，先前的檔案仍保留。");
  }

  async function commitBatch(batch: UploadBatch): Promise<FileOperationStatus> {
    let outputFormat = options.model.snapshot().outputFormat;
    while (batch.items.some((item) => item.file?.outputFormat !== outputFormat)) {
      const refreshed = await options.batchClient.refreshOutput(batch.items.map((item) => item.id), outputFormat);
      const byId = new Map(refreshed.map((file) => [file.id, file]));
      batch.items.forEach((item) => { item.file = byId.get(item.id) ?? item.file; });
      if (batch.cancelled) return { kind: "cancelled" };
      outputFormat = options.model.snapshot().outputFormat;
    }
    options.model.addBatch(batch.sources, batch.items);
    const inputFormat = options.model.snapshot().inputFormat;
    const activeCount = batch.items.filter((item) => item.sourceFormat === inputFormat).length;
    const failures = groupedFailures(batch);
    const failureCount = failures.reduce((total, group) => total + group.files.length, 0);
    const status: FileOperationStatus = {
      kind: "result",
      activeCount,
      activeFormat: inputFormat,
      failures,
      otherCount: batch.items.length - activeCount,
    };
    options.status.announce(failureCount > 0
      ? `已加入 ${batch.items.length} 個檔案，另有 ${failureCount} 個項目未加入。`
      : `已加入 ${batch.items.length} 個檔案。`);
    return status;
  }

  async function addFiles(batch: UploadBatch, files: readonly File[]): Promise<void> {
    options.status.announce(`正在加入 ${files.length} 個檔案。`);
    deferFeedback(() => {
      if (operation.kind !== "adding" || operation.batch !== batch || batch.cancelled) return;
      operation.phase = "visible";
      render();
    });
    render();
    try {
      for (const file of files) {
        if (batch.cancelled) break;
        await processFile(file, batch);
      }
      if (batch.cancelled) await discardBatch(batch);
      else try {
        const status = await commitBatch(batch);
        if (batch.cancelled) await discardBatch(batch);
        else if (operation.kind === "adding" && operation.batch === batch) settle(status);
      } catch {
        if (!batch.reset) await options.batchClient.discardFiles(batch.items.map((item) => item.id));
        batch.items = [];
        batch.sources = [];
        addFailure(batch, { label: "無法完成本次新增", tone: "error" }, "本次選取的檔案");
        if (!batch.reset) {
          const status = await commitBatch(batch);
          if (operation.kind === "adding" && operation.batch === batch) settle(status);
        }
      }
    } finally {
      if (operation.kind === "adding" && operation.batch === batch) settle({ kind: "idle" });
      if (batch.cancelled && !batch.reset) options.view.focusFilePicker();
    }
  }

  function startAdd(files: readonly File[]): void {
    if (operation.kind !== "idle") return;
    validationDate ??= taipeiDateStamp();
    let signalCancel: () => void = () => undefined;
    const cancelSignal = new Promise<void>((resolve) => { signalCancel = resolve; });
    const batch: UploadBatch = {
      activeSourceId: null,
      cancelSignal,
      cancelled: false,
      completedCandidateCount: 0,
      currentSourceProgress: null,
      reset: false,
      failures: new Map(),
      items: [],
      latestProgress: { current: 0, phase: "processing", sourceId: "", total: 0, virtualPath: files[0]?.name ?? "" },
      signalCancel,
      sources: [],
    };
    operation = { kind: "adding", batch, phase: "quiet" };
    pendingTask = addFiles(batch, files).catch(() => {
      if (!batch.reset && currentBatch() === batch) {
        settle({ kind: "error", detail: "無法加入檔案，請再試一次。" });
        options.status.announce("無法加入檔案。");
      }
    });
  }

  function cancelFileOperation(): void {
    const batch = currentBatch();
    if (!batch || batch.cancelled || operation.kind !== "adding") return;
    batch.cancelled = true;
    batch.signalCancel();
    cancelFeedback();
    operation = { kind: "cancelling", batch };
    render();
    if (batch.activeSourceId) void options.batchClient.cancelSource(batch.activeSourceId).catch(() => undefined);
  }

  function clear(): void {
    cancelFeedback();
    const batch = currentBatch();
    if (batch) {
      batch.cancelled = true;
      batch.reset = true;
      batch.signalCancel();
    }
    const resetOperation = { kind: "resetting" } as const;
    operation = resetOperation;
    previewRequest += 1;
    validationDate = null;
    const resetTask = options.batchClient.resetWorkspace();
    options.model.clear();
    render();
    pendingTask = resetTask.then(() => {
      if (operation === resetOperation) {
        settle({ kind: "cleared" });
        options.status.announce("檔案清單已清空；進階下載的參照檔仍保留。電腦中的原始檔案沒有變更。");
      }
    }, () => {
      if (operation === resetOperation) {
        settle({ kind: "error", detail: "背景工作區無法重設，請重新整理頁面。" });
        options.status.announce("背景工作區無法重設，請重新整理頁面。");
      }
    });
  }

  function startRestoreFile(
    removed: WorkspaceItem,
    source: WorkspaceSource,
    fileIndex: number,
    sourceIndex: number,
    wasSelected: boolean,
  ): void {
    if (operation.kind !== "idle") return;
    const restoring = { kind: "restoring" } as const;
    operation = restoring;
    render();
    pendingTask = options.batchClient.restoreFiles([removed.id]).then(async () => {
      if (operation !== restoring) return;
      if (!options.model.restore(removed, source, fileIndex, sourceIndex, wasSelected)) {
        await options.batchClient.removeFiles([removed.id]);
        if (operation === restoring) settle({ kind: "error", detail: "無法復原檔案，請再試一次。" });
        return;
      }
      settle({ kind: "restored", detail: `${removed.virtualPath} 已復原。` });
      options.status.announce(`${removed.virtualPath} 已復原。`);
    }).catch(() => {
      if (operation === restoring) {
        settle({ kind: "error", detail: "無法復原檔案，請再試一次。" });
        options.status.announce("無法復原檔案，請再試一次。");
      }
    });
  }

  function beginRemoval(subject: string, previousStatus: FileOperationStatus): RemovingOperation {
    const removing: RemovingOperation = { kind: "removing", phase: "quiet", previousStatus, subject };
    operation = removing;
    deferFeedback(() => {
      if (operation !== removing) return;
      removing.phase = "visible";
      render();
    });
    render();
    return removing;
  }

  function startRemoveFile(fileId: string): void {
    if (operation.kind !== "idle") return;
    const previousStatus = operation.status;
    const snapshot = options.model.snapshot();
    const fileIndex = snapshot.files.findIndex((item) => item.id === fileId);
    const item = snapshot.files[fileIndex];
    if (!item) return;
    const sourceIndex = snapshot.sources.findIndex((source) => source.id === item.sourceId);
    const source = snapshot.sources[sourceIndex];
    if (!source) return;
    const wasSelected = snapshot.selectedFileId === fileId;
    const removing = beginRemoval(item.virtualPath, previousStatus);
    pendingTask = options.batchClient.removeFiles([fileId]).then(async () => {
      if (operation !== removing) return;
      const removed = options.model.remove(fileId);
      if (!removed) {
        await options.batchClient.restoreFiles([fileId]);
        if (operation === removing) settle({ kind: "error", detail: "無法移除檔案，請再試一次。" });
        return;
      }
      settle({
        kind: "removed",
        onUndo: () => startRestoreFile(removed, source, fileIndex, sourceIndex, wasSelected),
        subject: removed.virtualPath,
      });
      options.status.announce(`${removed.virtualPath} 已從清單移除；電腦中的原始檔案沒有變更。`);
    }).catch(() => {
      if (operation === removing) {
        settle({ kind: "error", detail: "無法移除檔案，請再試一次。" });
        options.status.announce("無法移除檔案，請再試一次。");
      }
    });
  }

  function startRestoreSource(
    source: WorkspaceSource,
    restoreItems: readonly { index: number; item: WorkspaceItem }[],
    sourceIndex: number,
    previousSelectedFileId: string | null,
  ): void {
    if (operation.kind !== "idle") return;
    const fileIds = restoreItems.map(({ item }) => item.id);
    const restoring = { kind: "restoring" } as const;
    operation = restoring;
    render();
    pendingTask = options.batchClient.restoreFiles(fileIds).then(async () => {
      if (operation !== restoring) return;
      if (!options.model.restoreSource(source, restoreItems, sourceIndex, previousSelectedFileId)) {
        await options.batchClient.removeFiles(fileIds);
        if (operation === restoring) settle({ kind: "error", detail: "無法復原檔案來源，請再試一次。" });
        return;
      }
      settle({ kind: "restored", detail: `${source.name} 及其中 ${restoreItems.length} 個項目已復原。` });
      options.status.announce(`${source.name} 及其中 ${restoreItems.length} 個項目已復原。`);
    }).catch(() => {
      if (operation === restoring) {
        settle({ kind: "error", detail: "無法復原檔案來源，請再試一次。" });
        options.status.announce("無法復原檔案來源，請再試一次。");
      }
    });
  }

  function startRemoveSource(sourceId: string): void {
    if (operation.kind !== "idle") return;
    const previousStatus = operation.status;
    const snapshot = options.model.snapshot();
    const sourceIndex = snapshot.sources.findIndex((candidate) => candidate.id === sourceId);
    const source = snapshot.sources[sourceIndex];
    if (!source) return;
    const restoreItems = snapshot.files.flatMap((item, index) => item.sourceId === sourceId ? [{ index, item }] : []);
    const fileIds = restoreItems.map(({ item }) => item.id);
    const previousSelectedFileId = snapshot.selectedFileId;
    const removing = beginRemoval(source.name, previousStatus);
    pendingTask = options.batchClient.removeFiles(fileIds).then(async () => {
      if (operation !== removing) return;
      const removed = options.model.removeSource(sourceId);
      if (removed.length !== restoreItems.length) {
        await options.batchClient.restoreFiles(fileIds);
        if (operation === removing) settle({ kind: "error", detail: "無法移除檔案來源，請再試一次。" });
        return;
      }
      settle({
        kind: "removed",
        onUndo: () => startRestoreSource(source, restoreItems, sourceIndex, previousSelectedFileId),
        subject: source.name,
      });
      options.status.announce(`${source.name} 已從清單移除，共 ${removed.length} 個項目；電腦中的原始檔案沒有變更。`);
    }).catch(() => {
      if (operation === removing) {
        settle({ kind: "error", detail: "無法移除檔案來源，請再試一次。" });
        options.status.announce("無法移除檔案來源，請再試一次。");
      }
    });
  }

  return {
    bind() {
      options.batchClient.setProgressListener((progress) => {
        const batch = currentBatch();
        if (!batch || progress.sourceId !== batch.activeSourceId) return;
        updateBatchProgress(batch, progress);
        if (operation.kind === "adding" && operation.batch === batch && operation.phase === "visible") {
          renderOperationStatus();
        }
      });
      options.view.bind({
        onCancelFileOperation: cancelFileOperation,
        onChooseFile: () => { if (operation.kind === "idle") options.view.fileInput().click(); },
        onClearWorkspace: () => { if (operation.kind !== "resetting" && options.view.confirmClear()) clear(); },
        onFilesChosen: startAdd,
        onPreviewRequest: (fileId, filter, page) => void requestPreview(fileId, filter, page),
        onRemoveFile: startRemoveFile,
        onRemoveSource: startRemoveSource,
        onMarkAllViewed: () => {
          const count = options.model.markAllViewed();
          options.status.announce(count > 0 ? `已將 ${count} 個檔案標示為已查看。` : "沒有尚未查看的檔案。");
        },
        onVisibleRowsIncludedChange: (sourceRows, included) => {
          if (operation.kind !== "idle") return;
          const selected = options.model.selectedItem();
          if (!selected?.file) return;
          void options.batchClient.setRowsIncluded(selected.id, sourceRows, included, options.model.snapshot().outputFormat)
            .then((file) => options.model.update(selected.id, (item) => { item.file = file; }))
            .catch(() => undefined);
          options.status.announce(included
            ? `已選取本頁，共變更 ${sourceRows.length} 列。`
            : `已取消選取本頁，共變更 ${sourceRows.length} 列。`);
        },
        onRowIncludedChange: (sourceRow, included) => {
          if (operation.kind !== "idle") return;
          const selected = options.model.selectedItem();
          if (!selected?.file) return;
          void options.batchClient.setRowIncluded(selected.id, sourceRow, included, options.model.snapshot().outputFormat)
            .then((file) => options.model.update(selected.id, (item) => { item.file = file; }))
            .catch(() => undefined);
          options.status.announce(`第 ${sourceRow} 列已${included ? "納入" : "排除"}輸出。`);
        },
        onSelectFile: (fileId) => { options.model.select(fileId); },
      });
      options.model.subscribe(render);
      render();
    },
    whenIdle() { return pendingTask; },
  };
}
