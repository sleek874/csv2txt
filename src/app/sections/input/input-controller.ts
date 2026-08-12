import type { OfflineCache } from "../../../browser/offline-cache";
import type { UnloadGuard } from "../../../browser/unload-guard";
import { detectInputFileType } from "../../../core/file-formats";
import { taipeiDateStamp } from "../../../core/validation";
import type { BatchClient } from "../../batch/batch-client";
import type { PreviewFilter, ProcessingProgress } from "../../batch/protocol";
import type { AppStatus } from "../../shell/app-status";
import type { WorkspaceModel } from "../../state/workspace-model";
import type { WorkspaceItem, WorkspaceSource } from "../../state/workspace-types";
import type { FileOperationStatus, UploadFailureGroup } from "./file-operation-status-view";
import type { InputSectionView } from "./input-section-view";

const MAX_SOURCE_FILE_BYTES = 25 * 1024 * 1024;
const PROCESSING_FEEDBACK_DELAY_MS = 300;

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
  cancelled: boolean;
  failures: Map<string, { category: FailureCategory; files: Set<string> }>;
  items: WorkspaceItem[];
  latestProgress: ProcessingProgress;
  processingVisible: boolean;
  revealTimer: ReturnType<typeof setTimeout> | null;
  sources: WorkspaceSource[];
}

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
  if (/25 MiB|100 MiB/u.test(message)) return { label: "檔案大小超過限制", tone: "error" };
  if (/項目.*上限|項目累計/u.test(message)) return { label: "壓縮檔內檔案過多", tone: "error" };
  if (/巢狀/u.test(message)) return { label: "壓縮層數超過限制", tone: "error" };
  return { label: "無法開啟或內容損壞", tone: "error" };
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
  let activeBatch: UploadBatch | null = null;
  let selectionPending = false;
  let selectionQueue = Promise.resolve();
  let validationDate: string | null = null;
  let previewRequest = 0;

  function render(): void {
    const snapshot = options.model.snapshot();
    options.view.render(snapshot);
    options.unloadGuard.setPendingFile(snapshot.sources.length > 0 || activeBatch !== null || selectionPending, "primary-workspace");
  }

  function setOperationStatus(status: FileOperationStatus): void {
    options.view.renderOperationStatus(status);
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

  function revealProcessing(batch: UploadBatch): void {
    batch.revealTimer = setTimeout(() => {
      batch.revealTimer = null;
      if (activeBatch !== batch || batch.cancelled) return;
      batch.processingVisible = true;
      options.view.setFilePickerLocked(true, true);
      setOperationStatus({ kind: "processing", progress: batch.latestProgress });
    }, PROCESSING_FEEDBACK_DELAY_MS);
  }

  async function processFile(sourceFile: File, batch: UploadBatch): Promise<void> {
    const inputType = detectInputFileType(sourceFile.name);
    if (!inputType) {
      addFailure(batch, { label: `不支援的檔案類型（${extensionLabel(sourceFile.name)}）`, tone: "warning" }, sourceFile.name);
      return;
    }
    if (sourceFile.size === 0 || sourceFile.size > MAX_SOURCE_FILE_BYTES) {
      addFailure(batch, {
        label: sourceFile.size === 0 ? "空白檔案" : "檔案大小超過限制",
        tone: "error",
      }, sourceFile.name);
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await sourceFile.arrayBuffer());
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
    batch.latestProgress = {
      current: 0,
      phase: inputType === "zip" ? "extracting" : "processing",
      sourceId: source.id,
      total: inputType === "zip" ? 0 : 1,
      virtualPath: sourceFile.name,
    };
    if (batch.processingVisible) setOperationStatus({ kind: "processing", progress: batch.latestProgress });

    try {
      void options.offlineCache.prioritizePreviewFont().catch(() => undefined);
      const result = await options.batchClient.processSource({
        sourceId: source.id,
        sourceName: sourceFile.name,
        inputType,
        bytes,
        today: validationDate ?? taipeiDateStamp(),
        existingPaths,
        outputFormat: options.model.snapshot().outputFormat,
      });
      if (batch.cancelled) {
        await options.batchClient.discardFiles(result.entries.map((entry) => entry.id));
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
        skipped.reason === "symlink"
          ? { label: "捷徑", tone: "warning" }
          : { label: `不支援的檔案類型（${extensionLabel(skipped.relativePath)}）`, tone: "warning" },
        `${sourceFile.name}／${skipped.relativePath}`,
      ));
      if (result.entries.length === 0 && result.skippedEntries.length === 0) {
        addFailure(batch, { label: "沒有支援的 TXT、CSV、XLS 或 XLSX 檔案", tone: "warning" }, sourceFile.name);
      }
    } catch (error) {
      if (!batch.cancelled) addFailure(
        batch,
        inputType === "zip"
          ? archiveFailureCategory(error)
          : { label: "無法開啟或內容格式不符", tone: "error" },
        sourceFile.name,
      );
    } finally {
      if (batch.activeSourceId === source.id) batch.activeSourceId = null;
    }
  }

  async function discardBatch(batch: UploadBatch): Promise<void> {
    const fileIds = batch.items.map((item) => item.id);
    if (fileIds.length > 0) await options.batchClient.discardFiles(fileIds);
    setOperationStatus({ kind: "cancelled" });
    options.status.announce("已取消本次新增；這次選取的檔案都沒有加入，先前的檔案仍保留。");
  }

  async function commitBatch(batch: UploadBatch): Promise<void> {
    let outputFormat = options.model.snapshot().outputFormat;
    while (batch.items.some((item) => item.file?.outputFormat !== outputFormat)) {
      const refreshed = await options.batchClient.refreshOutput(batch.items.map((item) => item.id), outputFormat);
      const byId = new Map(refreshed.map((file) => [file.id, file]));
      batch.items.forEach((item) => { item.file = byId.get(item.id) ?? item.file; });
      if (batch.cancelled) return;
      outputFormat = options.model.snapshot().outputFormat;
    }
    options.model.addBatch(batch.sources, batch.items);
    const inputFormat = options.model.snapshot().inputFormat;
    const activeCount = batch.items.filter((item) => item.sourceFormat === inputFormat).length;
    const failures = groupedFailures(batch);
    const failureCount = failures.reduce((total, group) => total + group.files.length, 0);
    setOperationStatus({
      kind: "result",
      activeCount,
      activeFormat: inputFormat,
      failures,
      otherCount: batch.items.length - activeCount,
    });
    options.status.announce(failureCount > 0
      ? `已加入 ${batch.items.length} 個檔案，另有 ${failureCount} 個項目未加入。`
      : `已加入 ${batch.items.length} 個檔案。`);
  }

  async function addFiles(files: readonly File[]): Promise<void> {
    if (activeBatch) return;
    validationDate ??= taipeiDateStamp();
    const batch: UploadBatch = {
      activeSourceId: null,
      cancelled: false,
      failures: new Map(),
      items: [],
      latestProgress: { current: 0, phase: "processing", sourceId: "", total: files.length, virtualPath: files[0]?.name ?? "" },
      processingVisible: false,
      revealTimer: null,
      sources: [],
    };
    activeBatch = batch;
    options.view.setFilePickerLocked(true, false);
    options.status.announce(`正在加入 ${files.length} 個檔案。`);
    revealProcessing(batch);
    render();
    try {
      for (const file of files) {
        if (batch.cancelled) break;
        await processFile(file, batch);
      }
      if (batch.cancelled) await discardBatch(batch);
      else try {
        await commitBatch(batch);
        if (batch.cancelled) await discardBatch(batch);
      } catch {
        await options.batchClient.discardFiles(batch.items.map((item) => item.id));
        batch.items = [];
        batch.sources = [];
        addFailure(batch, { label: "無法完成本次新增", tone: "error" }, "本次選取的檔案");
        await commitBatch(batch);
      }
    } finally {
      if (batch.revealTimer !== null) clearTimeout(batch.revealTimer);
      if (activeBatch === batch) activeBatch = null;
      options.view.setFilePickerLocked(false, false);
      render();
      if (batch.cancelled) options.view.focusFilePicker();
    }
  }

  function cancelFileOperation(): void {
    const batch = activeBatch;
    if (!batch || batch.cancelled) return;
    batch.cancelled = true;
    if (batch.revealTimer !== null) clearTimeout(batch.revealTimer);
    batch.revealTimer = null;
    options.view.setFilePickerLocked(true, true);
    setOperationStatus({ kind: "cancelling" });
    if (batch.activeSourceId) void options.batchClient.cancelSource(batch.activeSourceId);
  }

  function clear(): void {
    previewRequest += 1;
    validationDate = null;
    void options.batchClient.clear().catch(() => {
      options.status.announce("背景清理尚未完成；重新加入檔案時會重新建立工作區。");
    });
    options.model.clear();
    setOperationStatus({ kind: "cleared" });
    options.status.announce("檔案清單已清空；電腦中的原始檔案沒有變更。");
  }

  return {
    bind() {
      options.batchClient.setProgressListener((progress) => {
        const batch = activeBatch;
        if (!batch || progress.sourceId !== batch.activeSourceId) return;
        batch.latestProgress = progress;
        if (batch.processingVisible && !batch.cancelled) {
          setOperationStatus({ kind: "processing", progress });
        }
      });
      options.view.bind({
        onCancelFileOperation: cancelFileOperation,
        onChooseFile: () => { if (!activeBatch && !selectionPending) options.view.fileInput().click(); },
        onClearWorkspace: () => { if (!activeBatch && !selectionPending && options.view.confirmClear()) clear(); },
        onFilesChosen: (files) => {
          if (activeBatch || selectionPending) return;
          selectionPending = true;
          options.view.setFilePickerLocked(true, false);
          render();
          selectionQueue = selectionQueue.catch(() => undefined).then(() => addFiles(files)).finally(() => {
            selectionPending = false;
            if (!activeBatch) options.view.setFilePickerLocked(false, false);
            render();
          });
          void selectionQueue.catch(() => options.status.announce("無法加入檔案。"));
        },
        onPreviewRequest: (fileId, filter, page) => void requestPreview(fileId, filter, page),
        onRemoveFile: (fileId) => {
          const snapshot = options.model.snapshot();
          const fileIndex = snapshot.files.findIndex((item) => item.id === fileId);
          const item = snapshot.files[fileIndex];
          if (!item) return;
          const sourceIndex = snapshot.sources.findIndex((source) => source.id === item.sourceId);
          const source = snapshot.sources[sourceIndex];
          if (!source) return;
          const wasSelected = snapshot.selectedFileId === fileId;
          const removed = options.model.remove(fileId);
          if (!removed) return;
          void options.batchClient.removeFiles([fileId]);
          options.status.announce(`${removed.virtualPath} 已從清單移除；電腦中的原始檔案沒有變更。`);
          setOperationStatus({
            kind: "removed",
            detail: `已移除 ${removed.virtualPath}；電腦中的原始檔案沒有變更。`,
            onUndo: () => {
              if (!options.model.restore(removed, source, fileIndex, sourceIndex, wasSelected)) return;
              void options.batchClient.restoreFiles([fileId]);
              setOperationStatus({ kind: "restored", detail: `${removed.virtualPath} 已復原。` });
              options.status.announce(`${removed.virtualPath} 已復原。`);
            },
          });
        },
        onRemoveSource: (sourceId) => {
          const snapshot = options.model.snapshot();
          const sourceIndex = snapshot.sources.findIndex((candidate) => candidate.id === sourceId);
          const source = snapshot.sources[sourceIndex];
          if (!source) return;
          const restoreItems = snapshot.files.flatMap((item, index) => item.sourceId === sourceId ? [{ index, item }] : []);
          const previousSelectedFileId = snapshot.selectedFileId;
          const removed = options.model.removeSource(sourceId);
          void options.batchClient.removeFiles(removed.map((item) => item.id));
          options.status.announce(`${source.name} 已從清單移除，共 ${removed.length} 個項目；電腦中的原始檔案沒有變更。`);
          setOperationStatus({
            kind: "removed",
            detail: `已移除 ${source.name} 及其中 ${removed.length} 個項目；電腦中的原始檔案沒有變更。`,
            onUndo: () => {
              if (!options.model.restoreSource(source, restoreItems, sourceIndex, previousSelectedFileId)) return;
              void options.batchClient.restoreFiles(removed.map((item) => item.id));
              setOperationStatus({ kind: "restored", detail: `${source.name} 及其中 ${removed.length} 個項目已復原。` });
              options.status.announce(`${source.name} 及其中 ${removed.length} 個項目已復原。`);
            },
          });
        },
        onMarkAllViewed: () => {
          const count = options.model.markAllViewed();
          options.status.announce(count > 0 ? `已將 ${count} 個檔案標示為已查看。` : "沒有尚未查看的檔案。");
        },
        onVisibleRowsIncludedChange: (sourceRows, included) => {
          const selected = options.model.selectedItem();
          if (!selected?.file) return;
          void options.batchClient.setRowsIncluded(selected.id, sourceRows, included, options.model.snapshot().outputFormat)
            .then((file) => options.model.update(selected.id, (item) => { item.file = file; }));
          options.status.announce(included
            ? `已選取本頁，共變更 ${sourceRows.length} 列。`
            : `已取消選取本頁，共變更 ${sourceRows.length} 列。`);
        },
        onRowIncludedChange: (sourceRow, included) => {
          const selected = options.model.selectedItem();
          if (!selected?.file) return;
          void options.batchClient.setRowIncluded(selected.id, sourceRow, included, options.model.snapshot().outputFormat)
            .then((file) => options.model.update(selected.id, (item) => { item.file = file; }));
          options.status.announce(`第 ${sourceRow} 列已${included ? "納入" : "排除"}輸出。`);
        },
        onSelectFile: (fileId) => { options.model.select(fileId); },
      });
      options.model.subscribe(render);
      setOperationStatus({ kind: "idle" });
      render();
    },
    whenIdle() { return selectionQueue; },
  };
}
