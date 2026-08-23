import type { CreatedOutput } from "./output-artifact";
import type { OutputFormat, SourceFileType } from "../../core/file-formats";
import type { WorkspaceFileRecord } from "../state/workspace-types";
import type {
  AdvancedReferenceSummary,
  AdvancedResultSummary,
  BatchRequest,
  BatchRequestMessage,
  BatchResponseValue,
  BatchWorkerMessage,
  PreviewFilter,
  PreviewPage,
  ProcessSourceResult,
  ProcessingProgress,
} from "./protocol";

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (value: BatchResponseValue) => void;
  workspaceEpoch?: number;
}

export interface BatchClient {
  cancelOutput(): Promise<void>;
  cancelSource(sourceId: string): Promise<void>;
  resetWorkspace(): Promise<void>;
  clearReference(): Promise<void>;
  createAdvancedOutput(fileIds: readonly string[], keyColumnIndex: number, selectedColumnIndices: readonly number[]): Promise<CreatedOutput>;
  createOutput(fileIds: readonly string[], outputFormat: OutputFormat): Promise<CreatedOutput>;
  discardFiles(fileIds: readonly string[]): Promise<void>;
  getAdvancedResult(fileIds: readonly string[], keyColumnIndex: number, selectedColumnIndices: readonly number[]): Promise<AdvancedResultSummary>;
  getPreviewPage(fileId: string, filter: PreviewFilter, page: number, outputFormat: OutputFormat): Promise<PreviewPage>;
  inspectReference(bytes: Uint8Array): Promise<AdvancedReferenceSummary>;
  processSource(options: { sourceId: string; sourceName: string; inputType: SourceFileType | "zip"; bytes: Uint8Array; today: string; existingPaths: readonly string[]; outputFormat: OutputFormat }): Promise<ProcessSourceResult>;
  refreshOutput(fileIds: readonly string[], outputFormat: OutputFormat): Promise<readonly WorkspaceFileRecord[]>;
  removeFiles(fileIds: readonly string[]): Promise<void>;
  restoreFiles(fileIds: readonly string[]): Promise<void>;
  selectReferenceSheet(sheetName: string): Promise<AdvancedReferenceSummary>;
  setProgressListener(listener: ((progress: ProcessingProgress) => void) | null): void;
  setRowIncluded(fileId: string, sourceRow: number, included: boolean, outputFormat: OutputFormat): Promise<WorkspaceFileRecord>;
  setRowsIncluded(fileId: string, sourceRows: readonly number[], included: boolean, outputFormat: OutputFormat): Promise<WorkspaceFileRecord>;
}

export function createBatchClient(): BatchClient {
  let worker: Worker | null = null;
  let nextRequestId = 1;
  let progressListener: ((progress: ProcessingProgress) => void) | null = null;
  const pending = new Map<number, PendingRequest>();
  const previewCache = new Map<string, PreviewPage>();
  const previewPending = new Map<string, Promise<PreviewPage>>();
  const fileRevisions = new Map<string, number>();
  let previewContext = "";
  let workspaceEpoch = 0;

  function rejectAll(message: string): void {
    pending.forEach(({ reject }) => reject(new Error(message)));
    pending.clear();
  }

  function currentWorker(): Worker {
    if (worker) return worker;
    const instance = new Worker(new URL("./batch-worker.ts", import.meta.url), { type: "module" });
    worker = instance;
    instance.addEventListener("message", (event: MessageEvent<BatchWorkerMessage>) => {
      const message = event.data;
      if (message.type === "progress") {
        progressListener?.(message);
        return;
      }
      const request = pending.get(message.requestId);
      if (!request) return;
      pending.delete(message.requestId);
      if (message.type === "error") request.reject(new Error(message.message));
      else request.resolve(message.value);
    });
    const stop = (message: string) => {
      rejectAll(message);
      instance.terminate();
      if (worker === instance) worker = null;
    };
    instance.addEventListener("error", () => stop("背景處理已停止，請重新加入檔案。"));
    instance.addEventListener("messageerror", () => stop("無法讀取背景處理結果，請重新加入檔案。"));
    return instance;
  }

  function request<T extends BatchResponseValue>(value: BatchRequest, transfer: Transferable[] = []): Promise<T> {
    const requestId = nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(requestId, {
        reject,
        resolve: (response) => resolve(response as T),
        ...("workspaceEpoch" in value ? { workspaceEpoch: value.workspaceEpoch } : {}),
      });
      try {
        currentWorker().postMessage({ requestId, request: value } satisfies BatchRequestMessage, transfer);
      } catch (error) {
        pending.delete(requestId);
        reject(error instanceof Error ? error : new Error("無法啟動背景處理。"));
      }
    });
  }

  function previewKey(fileId: string, filter: PreviewFilter, page: number, outputFormat: OutputFormat): string {
    return `${fileId}:${fileRevisions.get(fileId) ?? 0}:${outputFormat}:${filter}:${page}`;
  }

  function fetchPreview(fileId: string, filter: PreviewFilter, page: number, outputFormat: OutputFormat): Promise<PreviewPage> {
    const key = previewKey(fileId, filter, page, outputFormat);
    const cached = previewCache.get(key);
    if (cached) return Promise.resolve(cached);
    const active = previewPending.get(key);
    if (active) return active;
    const result = request<PreviewPage>({ type: "preview-page", fileId, filter, page, outputFormat, workspaceEpoch })
      .then((value) => {
        previewCache.set(key, value);
        previewPending.delete(key);
        return value;
      }, (error: unknown) => {
        previewPending.delete(key);
        throw error;
      });
    previewPending.set(key, result);
    return result;
  }

  function invalidatePreview(fileId?: string): void {
    if (!fileId) {
      previewCache.clear();
      previewContext = "";
      return;
    }
    fileRevisions.set(fileId, (fileRevisions.get(fileId) ?? 0) + 1);
    [...previewCache.keys()].filter((key) => key.startsWith(`${fileId}:`))
      .forEach((key) => previewCache.delete(key));
  }

  function transferableBytes(bytes: Uint8Array): Uint8Array {
    return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
  }

  return {
    async cancelOutput() {
      await request({ type: "cancel-output", workspaceEpoch });
    },
    async cancelSource(sourceId) {
      await request({ type: "cancel-source", sourceId, workspaceEpoch });
    },
    async resetWorkspace() {
      workspaceEpoch += 1;
      previewCache.clear();
      previewPending.clear();
      fileRevisions.clear();
      previewContext = "";
      pending.forEach((active, requestId) => {
        if (active.workspaceEpoch === undefined || active.workspaceEpoch === workspaceEpoch) return;
        pending.delete(requestId);
        active.reject(new Error("工作區已重設。"));
      });
      if (worker) await request({ type: "reset-workspace", workspaceEpoch });
    },
    async clearReference() { await request({ type: "clear-reference" }); },
    createAdvancedOutput: (fileIds, keyColumnIndex, selectedColumnIndices) => request({
      type: "create-advanced-output", fileIds, keyColumnIndex, selectedColumnIndices, createdAt: new Date().toISOString(), workspaceEpoch,
    }),
    createOutput: (fileIds, outputFormat) => request({
      type: "create-output", fileIds, outputFormat, createdAt: new Date().toISOString(), workspaceEpoch,
    }),
    async discardFiles(fileIds) {
      fileIds.forEach((id) => invalidatePreview(id));
      await request({ type: "discard-files", fileIds, workspaceEpoch });
    },
    getAdvancedResult: (fileIds, keyColumnIndex, selectedColumnIndices) => request({
      type: "advanced-result", fileIds, keyColumnIndex, selectedColumnIndices, workspaceEpoch,
    }),
    async getPreviewPage(fileId, filter, page, outputFormat) {
      const context = `${fileId}:${fileRevisions.get(fileId) ?? 0}:${outputFormat}:${filter}`;
      if (previewContext !== context) {
        previewCache.clear();
        previewContext = context;
      }
      const result = await fetchPreview(fileId, filter, page, outputFormat);
      [result.page - 1, result.page + 1]
        .filter((candidate) => candidate >= 0 && candidate < result.pageCount)
        .forEach((candidate) => { void fetchPreview(fileId, filter, candidate, outputFormat).catch(() => undefined); });
      return result;
    },
    inspectReference(bytes) {
      const transferable = transferableBytes(bytes);
      return request({ type: "inspect-reference", bytes: transferable }, [transferable.buffer]);
    },
    processSource(options) {
      const transferable = transferableBytes(options.bytes);
      return request({ type: "process-source", ...options, bytes: transferable, workspaceEpoch }, [transferable.buffer]);
    },
    refreshOutput(fileIds, outputFormat) {
      invalidatePreview();
      return request({ type: "refresh-output", fileIds, outputFormat, workspaceEpoch });
    },
    async removeFiles(fileIds) {
      fileIds.forEach((id) => invalidatePreview(id));
      await request({ type: "remove-files", fileIds, workspaceEpoch });
    },
    async restoreFiles(fileIds) { await request({ type: "restore-files", fileIds, workspaceEpoch }); },
    selectReferenceSheet: (sheetName) => request({ type: "select-reference-sheet", sheetName }),
    setProgressListener(listener) { progressListener = listener; },
    setRowIncluded(fileId, sourceRow, included, outputFormat) {
      invalidatePreview(fileId);
      return request({ type: "set-row-included", fileId, sourceRow, included, outputFormat, workspaceEpoch });
    },
    setRowsIncluded(fileId, sourceRows, included, outputFormat) {
      invalidatePreview(fileId);
      return request({ type: "set-rows-included", fileId, sourceRows, included, outputFormat, workspaceEpoch });
    },
  };
}
