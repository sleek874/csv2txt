import type { OutputFormat, SourceFileType } from "../../core/file-formats";
import type { WorkspaceFileRecord } from "../state/workspace-types";
import type { CreatedOutput } from "./output-artifact";
import type {
  AdvancedReferenceSummary,
  AdvancedResultSummary,
  BatchRequest,
  BatchResponseValue,
  OutputProgress,
  PreviewFilter,
  PreviewPage,
  ProcessSourceResult,
  ProcessingProgress,
  ProcessedEntry,
} from "./protocol";
import { createWorkerChannel, type WorkerChannel, WorkerInterruptedError } from "./worker-channel";

export type BatchRuntime =
  | { state: "ready"; error: null }
  | { state: "recovering"; error: string; notice: "dialog" | "silent" }
  | { state: "failed"; error: string };
export type BatchTestFault = "error" | "fatal" | "msgerr";

interface ReplaySource {
  accepted: readonly Pick<ProcessedEntry, "id" | "relativePath" | "size" | "sourceFormat" | "virtualPath">[];
  discarded: Set<string>;
  existingPaths: readonly string[];
  file: File;
  inputType: SourceFileType | "zip";
  removed: Set<string>;
  sourceId: string;
  sourceName: string;
  today: string;
}

class WorkerUnavailableError extends Error {}
export class ActionInterruptedError extends Error {
  constructor(message = "這項操作在自動重試後再次中斷。") { super(message); }
}

export function isWorkerFailure(error: unknown): boolean {
  return error instanceof WorkerInterruptedError || error instanceof WorkerUnavailableError;
}

export function isActionInterruption(error: unknown): error is ActionInterruptedError {
  return error instanceof ActionInterruptedError;
}

export interface BatchClient {
  cancelOutput(): Promise<void>;
  cancelSource(sourceId: string): Promise<void>;
  clearReference(): Promise<void>;
  createAdvancedOutput(fileIds: readonly string[], keyColumnIndex: number, selectedColumnIndices: readonly number[], onProgress?: (progress: OutputProgress) => void): Promise<CreatedOutput>;
  createOutput(fileIds: readonly string[], outputFormat: OutputFormat, onProgress?: (progress: OutputProgress) => void): Promise<CreatedOutput>;
  discardFiles(fileIds: readonly string[]): Promise<void>;
  getAdvancedResult(fileIds: readonly string[], keyColumnIndex: number, selectedColumnIndices: readonly number[]): Promise<AdvancedResultSummary>;
  getPreviewPage(fileId: string, filter: PreviewFilter, page: number, outputFormat: OutputFormat): Promise<PreviewPage>;
  inspectReference(file: File): Promise<AdvancedReferenceSummary>;
  invalidateOutput(): void;
  processSource(options: { sourceId: string; sourceName: string; sourceFile: File; inputType: SourceFileType | "zip"; bytes: Uint8Array; today: string; existingPaths: readonly string[]; outputFormat: OutputFormat }): Promise<ProcessSourceResult>;
  refreshOutput(fileIds: readonly string[], outputFormat: OutputFormat): Promise<readonly WorkspaceFileRecord[]>;
  removeFiles(fileIds: readonly string[]): Promise<void>;
  resetWorkspace(): Promise<void>;
  restoreFiles(fileIds: readonly string[]): Promise<void>;
  runtime(): BatchRuntime;
  selectReferenceSheet(sheetName: string): Promise<AdvancedReferenceSummary>;
  setProgressListener(listener: ((progress: ProcessingProgress) => void) | null): void;
  setRowIncluded(fileId: string, sourceRow: number, included: boolean, outputFormat: OutputFormat): Promise<WorkspaceFileRecord>;
  setRowsIncluded(fileId: string, sourceRows: readonly number[], included: boolean, outputFormat: OutputFormat): Promise<WorkspaceFileRecord>;
  subscribeOutputInvalidation(listener: () => void): () => void;
  subscribeRecovered(listener: () => void): () => void;
  subscribeRuntime(listener: (runtime: BatchRuntime) => void): () => void;
}

export interface TestableBatchClient extends BatchClient {
  simulateWorkerFault(fault: BatchTestFault): Promise<BatchRuntime["state"]>;
}

export function createBatchClient(): TestableBatchClient {
  let channel: WorkerChannel | null = null;
  let runtime: BatchRuntime = { state: "ready", error: null };
  let recoveryCycle = 0;
  let recoveryPromise: Promise<void> | null = null;
  let coveredActions = 0;
  let progressListener: ((progress: ProcessingProgress) => void) | null = null;
  let workspaceEpoch = 0;
  let outputFormat: OutputFormat = "big5-txt";
  let activeOutput = 0;
  let nextOutputLease = 0;
  const cancelledSources = new Set<string>();
  const previewCache = new Map<string, PreviewPage>();
  const previewPending = new Map<string, Promise<PreviewPage>>();
  const fileRevisions = new Map<string, number>();
  const sources = new Map<string, ReplaySource>();
  const sourceIds = new Map<string, string>();
  const excludedRows = new Map<string, Set<number>>();
  const runtimeListeners = new Set<(value: BatchRuntime) => void>();
  const recoveredListeners = new Set<() => void>();
  const outputInvalidationListeners = new Set<() => void>();
  let previewContext = "";
  let reference: { file: File; sheetName: string } | null = null;

  function text(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  function publishRuntime(value: BatchRuntime): void {
    if (runtime.state === value.state && runtime.error === value.error
      && (runtime.state !== "recovering" || value.state !== "recovering" || runtime.notice === value.notice)) return;
    runtime = value;
    runtimeListeners.forEach((listener) => listener(value));
  }

  function invalidatePreview(fileId?: string): void {
    if (!fileId) {
      previewCache.clear();
      previewPending.clear();
      previewContext = "";
      return;
    }
    fileRevisions.set(fileId, (fileRevisions.get(fileId) ?? 0) + 1);
    [...previewCache.keys()].filter((key) => key.startsWith(`${fileId}:`))
      .forEach((key) => previewCache.delete(key));
  }

  function stopChannel(error: Error): void {
    const active = channel;
    channel = null;
    active?.stop(error);
    invalidatePreview();
  }

  function openChannel(): WorkerChannel {
    if (channel) return channel;
    try {
      channel = createWorkerChannel({
        onFault: handleFault,
        onProgress: (progress) => progressListener?.(progress),
      });
      return channel;
    } catch (error) {
      const failure = new Error(text(error, "無法啟動背景處理。"));
      if (runtime.state === "ready") beginRecovery(failure, coveredActions > 0 ? "silent" : "dialog");
      throw new WorkerInterruptedError(failure.message);
    }
  }

  function rawRequest<T extends BatchResponseValue>(request: BatchRequest, transfer: Transferable[] = [], onOutputProgress?: (progress: OutputProgress) => void): Promise<T> {
    return openChannel().request<T>(request, transfer, onOutputProgress);
  }

  function sourceFor(fileId: string): ReplaySource | undefined {
    const sourceId = sourceIds.get(fileId);
    return sourceId ? sources.get(sourceId) : undefined;
  }

  function sameEntries(actual: ProcessSourceResult["entries"], expected: ReplaySource["accepted"]): boolean {
    return actual.length === expected.length && actual.every((entry, index) => {
      const saved = expected[index];
      return saved?.id === entry.id
        && saved.relativePath === entry.relativePath
        && saved.size === entry.size
        && saved.sourceFormat === entry.sourceFormat
        && saved.virtualPath === entry.virtualPath;
    });
  }

  function transferable(bytes: Uint8Array): Uint8Array {
    return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
  }

  async function replay(cycle: number): Promise<void> {
    await rawRequest({ type: "ping" });
    for (const source of sources.values()) {
      if (cycle !== recoveryCycle) throw new WorkerInterruptedError("工作區已重設。");
      const bytes = new Uint8Array(await source.file.arrayBuffer());
      const result = await rawRequest<ProcessSourceResult>({
        type: "process-source", sourceId: source.sourceId, sourceName: source.sourceName,
        inputType: source.inputType, bytes, today: source.today, existingPaths: source.existingPaths,
        outputFormat, workspaceEpoch,
      }, [bytes.buffer]);
      if (!sameEntries(result.entries, source.accepted)) throw new Error("背景工作區內容無法核對。");
      for (const entry of source.accepted) {
        const rows = excludedRows.get(entry.id);
        if (rows?.size) await rawRequest({
          type: "set-rows-included", fileId: entry.id, sourceRows: [...rows], included: false,
          outputFormat, workspaceEpoch,
        });
      }
      if (source.discarded.size) await rawRequest({
        type: "discard-files", fileIds: [...source.discarded], workspaceEpoch,
      });
      const removed = [...source.removed].filter((id) => !source.discarded.has(id));
      if (removed.length) await rawRequest({ type: "remove-files", fileIds: removed, workspaceEpoch });
    }
    if (reference) {
      const bytes = new Uint8Array(await reference.file.arrayBuffer());
      const summary = await rawRequest<AdvancedReferenceSummary>({ type: "inspect-reference", bytes }, [bytes.buffer]);
      if (summary.sheetName !== reference.sheetName) {
        await rawRequest({ type: "select-reference-sheet", sheetName: reference.sheetName });
      }
    }
  }

  function failRecovery(error: unknown): void {
    recoveryCycle += 1;
    stopChannel(error instanceof Error ? error : new Error("背景處理無法復原。"));
    publishRuntime({ state: "failed", error: text(error, "背景處理無法復原。") });
  }

  function beginRecovery(error: Error, notice: "dialog" | "silent"): void {
    const cycle = ++recoveryCycle;
    publishRuntime({ state: "recovering", error: error.message, notice });
    const task = replay(cycle).then(() => {
      if (cycle !== recoveryCycle) throw new WorkerInterruptedError("工作區已重設。");
      publishRuntime({ state: "ready", error: null });
      recoveredListeners.forEach((listener) => listener());
    }).catch((caught: unknown) => {
      if (cycle === recoveryCycle) failRecovery(caught);
      throw caught;
    }).finally(() => {
      if (recoveryPromise === task) recoveryPromise = null;
    });
    recoveryPromise = task;
    void task.catch(() => undefined);
  }

  function handleFault(failed: WorkerChannel, error: Error): void {
    if (channel !== failed) return;
    stopChannel(new WorkerInterruptedError("背景處理已中斷。"));
    if (runtime.state === "recovering") {
      failRecovery(error);
      return;
    }
    beginRecovery(error, coveredActions > 0 ? "silent" : "dialog");
  }

  async function ensureReady(): Promise<void> {
    if (runtime.state === "recovering") await recoveryPromise;
    if (runtime.state === "failed") throw new WorkerUnavailableError("背景處理無法使用。");
  }

  async function request<T extends BatchResponseValue>(value: BatchRequest, onOutputProgress?: (progress: OutputProgress) => void): Promise<T> {
    await ensureReady();
    return rawRequest<T>(value, [], onOutputProgress);
  }

  async function covered<T>(action: () => Promise<T>): Promise<T> {
    coveredActions += 1;
    try {
      return await action();
    } finally {
      coveredActions -= 1;
    }
  }

  async function restartable<T>(
    attempt: (index: number) => Promise<T>,
    valid: () => boolean = () => true,
  ): Promise<T> {
    const run = async () => {
      for (let index = 0; index < 2; index += 1) {
        await ensureReady();
        if (!valid()) throw new Error("操作已取消。");
        try {
          return await attempt(index);
        } catch (error) {
          if (!(error instanceof WorkerInterruptedError)) throw error;
          if (index === 1) {
            await ensureReady();
            throw new ActionInterruptedError();
          }
        }
      }
      throw new ActionInterruptedError();
    };
    return covered(run);
  }

  async function journaled<T>(action: () => Promise<T>, afterRecovery: () => Promise<T>): Promise<T> {
    return covered(async () => {
      try {
        return await action();
      } catch (error) {
        if (!(error instanceof WorkerInterruptedError)) throw error;
        await ensureReady();
        return afterRecovery();
      }
    });
  }

  function previewKey(fileId: string, filter: PreviewFilter, page: number, format: OutputFormat): string {
    return `${fileId}:${fileRevisions.get(fileId) ?? 0}:${format}:${filter}:${page}`;
  }

  function fetchPreview(fileId: string, filter: PreviewFilter, page: number, format: OutputFormat): Promise<PreviewPage> {
    const key = previewKey(fileId, filter, page, format);
    const cached = previewCache.get(key);
    if (cached) return Promise.resolve(cached);
    const active = previewPending.get(key);
    if (active) return active;
    const result = request<PreviewPage>({ type: "preview-page", fileId, filter, page, outputFormat: format, workspaceEpoch })
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

  function outputRequest(create: (createdAt: string) => BatchRequest, onProgress?: (progress: OutputProgress) => void): Promise<CreatedOutput> {
    const lease = ++nextOutputLease;
    const epoch = workspaceEpoch;
    const createdAt = new Date().toISOString();
    activeOutput = lease;
    return restartable(
      () => request<CreatedOutput>(create(createdAt), onProgress),
      () => activeOutput === lease && workspaceEpoch === epoch,
    ).finally(() => {
      if (activeOutput === lease) activeOutput = 0;
    });
  }

  return {
    async cancelOutput() {
      activeOutput = 0;
      if (runtime.state === "ready" && channel) await rawRequest({ type: "cancel-output", workspaceEpoch });
    },
    async cancelSource(sourceId) {
      cancelledSources.add(sourceId);
      if (runtime.state === "ready" && channel) await rawRequest({ type: "cancel-source", sourceId, workspaceEpoch });
    },
    async clearReference() {
      reference = null;
      await journaled(() => request({ type: "clear-reference" }), async () => undefined);
    },
    createAdvancedOutput(fileIds, keyColumnIndex, selectedColumnIndices, onProgress) {
      return outputRequest((createdAt) => ({
        type: "create-advanced-output", fileIds, keyColumnIndex, selectedColumnIndices,
        createdAt, workspaceEpoch,
      }), onProgress);
    },
    createOutput(fileIds, format, onProgress) {
      outputFormat = format;
      return outputRequest((createdAt) => ({
        type: "create-output", fileIds, outputFormat: format, createdAt, workspaceEpoch,
      }), onProgress);
    },
    async discardFiles(fileIds) {
      fileIds.forEach((id) => invalidatePreview(id));
      await restartable(() => request({ type: "discard-files", fileIds, workspaceEpoch }));
      fileIds.forEach((id) => {
        const source = sourceFor(id);
        source?.discarded.add(id);
        source?.removed.delete(id);
        excludedRows.delete(id);
        sourceIds.delete(id);
        if (source && source.accepted.every((entry) => source.discarded.has(entry.id))) sources.delete(source.sourceId);
      });
    },
    getAdvancedResult: (fileIds, keyColumnIndex, selectedColumnIndices) => request({
      type: "advanced-result", fileIds, keyColumnIndex, selectedColumnIndices, workspaceEpoch,
    }),
    async getPreviewPage(fileId, filter, page, format) {
      outputFormat = format;
      const context = `${fileId}:${fileRevisions.get(fileId) ?? 0}:${format}:${filter}`;
      if (previewContext !== context) {
        previewCache.clear();
        previewContext = context;
      }
      const result = await fetchPreview(fileId, filter, page, format);
      [result.page - 1, result.page + 1]
        .filter((candidate) => candidate >= 0 && candidate < result.pageCount)
        .forEach((candidate) => { void fetchPreview(fileId, filter, candidate, format).catch(() => undefined); });
      return result;
    },
    async inspectReference(file) {
      const summary = await restartable(async () => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await ensureReady();
        return rawRequest<AdvancedReferenceSummary>({ type: "inspect-reference", bytes }, [bytes.buffer]);
      });
      reference = { file, sheetName: summary.sheetName };
      return summary;
    },
    invalidateOutput() {
      if (activeOutput === 0) return;
      activeOutput = 0;
      outputInvalidationListeners.forEach((listener) => listener());
      if (runtime.state === "ready" && channel) {
        void rawRequest({ type: "cancel-output", workspaceEpoch }).catch(() => undefined);
      }
    },
    async processSource(options) {
      outputFormat = options.outputFormat;
      const epoch = workspaceEpoch;
      const firstBytes = transferable(options.bytes);
      try {
        const result = await restartable(async (index) => {
          const bytes = index === 0 ? firstBytes : new Uint8Array(await options.sourceFile.arrayBuffer());
          await ensureReady();
          return rawRequest<ProcessSourceResult>({
            type: "process-source", sourceId: options.sourceId, sourceName: options.sourceName,
            inputType: options.inputType, bytes, today: options.today, existingPaths: options.existingPaths,
            outputFormat: options.outputFormat, workspaceEpoch: epoch,
          }, [bytes.buffer]);
        }, () => workspaceEpoch === epoch && !cancelledSources.has(options.sourceId));
        if (result.entries.length) {
          sources.set(options.sourceId, {
            accepted: result.entries.map(({ id, relativePath, size, sourceFormat, virtualPath }) => (
              { id, relativePath, size, sourceFormat, virtualPath }
            )),
            discarded: new Set(), existingPaths: [...options.existingPaths], file: options.sourceFile,
            inputType: options.inputType, removed: new Set(), sourceId: options.sourceId,
            sourceName: options.sourceName, today: options.today,
          });
          result.entries.forEach((entry) => sourceIds.set(entry.id, options.sourceId));
        }
        return result;
      } finally {
        cancelledSources.delete(options.sourceId);
      }
    },
    async refreshOutput(fileIds, format) {
      outputFormat = format;
      invalidatePreview();
      return request({ type: "refresh-output", fileIds, outputFormat: format, workspaceEpoch });
    },
    async removeFiles(fileIds) {
      const changed = fileIds.flatMap((id) => {
        const source = sourceFor(id);
        if (!source || source.removed.has(id)) return [];
        source.removed.add(id);
        invalidatePreview(id);
        return [{ id, source }];
      });
      try {
        await journaled(() => request({ type: "remove-files", fileIds, workspaceEpoch }), async () => undefined);
      } catch (error) {
        changed.forEach(({ id, source }) => source.removed.delete(id));
        throw error;
      }
    },
    async resetWorkspace() {
      workspaceEpoch += 1;
      activeOutput = 0;
      sources.clear();
      sourceIds.clear();
      excludedRows.clear();
      fileRevisions.clear();
      cancelledSources.clear();
      invalidatePreview();
      if (!channel && runtime.state === "ready") return;
      recoveryCycle += 1;
      stopChannel(new WorkerInterruptedError("工作區已重設。"));
      beginRecovery(new Error("工作區已重設。"), "silent");
      await recoveryPromise;
    },
    async restoreFiles(fileIds) {
      const changed = fileIds.flatMap((id) => {
        const source = sourceFor(id);
        if (!source || !source.removed.delete(id)) return [];
        return [{ id, source }];
      });
      try {
        await journaled(() => request({ type: "restore-files", fileIds, workspaceEpoch }), async () => undefined);
      } catch (error) {
        changed.forEach(({ id, source }) => source.removed.add(id));
        throw error;
      }
    },
    runtime: () => runtime,
    async selectReferenceSheet(sheetName) {
      const summary = await restartable(() => request<AdvancedReferenceSummary>({ type: "select-reference-sheet", sheetName }));
      if (reference) reference.sheetName = summary.sheetName;
      return summary;
    },
    setProgressListener(listener) { progressListener = listener; },
    async simulateWorkerFault(fault) {
      const active = openChannel();
      if (fault !== "fatal" || runtime.state === "recovering") active.simulate(fault);
      else {
        active.simulate("msgerr");
        channel?.simulate("fatal");
      }
      await recoveryPromise?.catch(() => undefined);
      return runtime.state;
    },
    async setRowIncluded(fileId, sourceRow, included, format) {
      outputFormat = format;
      invalidatePreview(fileId);
      const excluded = excludedRows.get(fileId) ?? new Set<number>();
      const previouslyIncluded = !excluded.has(sourceRow);
      if (included) excluded.delete(sourceRow);
      else excluded.add(sourceRow);
      if (excluded.size) excludedRows.set(fileId, excluded);
      else excludedRows.delete(fileId);
      try {
        return await journaled(
          () => request<WorkspaceFileRecord>({
            type: "set-row-included", fileId, sourceRow, included, outputFormat: format, workspaceEpoch,
          }),
          async () => (await request<readonly WorkspaceFileRecord[]>({
            type: "refresh-output", fileIds: [fileId], outputFormat: format, workspaceEpoch,
          }))[0]!,
        );
      } catch (error) {
        const current = excludedRows.get(fileId) ?? new Set<number>();
        if (previouslyIncluded) current.delete(sourceRow);
        else current.add(sourceRow);
        if (current.size) excludedRows.set(fileId, current);
        else excludedRows.delete(fileId);
        throw error;
      }
    },
    async setRowsIncluded(fileId, sourceRows, included, format) {
      outputFormat = format;
      invalidatePreview(fileId);
      const excluded = excludedRows.get(fileId) ?? new Set<number>();
      const previous = new Map(sourceRows.map((row) => [row, !excluded.has(row)]));
      sourceRows.forEach((row) => included ? excluded.delete(row) : excluded.add(row));
      if (excluded.size) excludedRows.set(fileId, excluded);
      else excludedRows.delete(fileId);
      try {
        return await journaled(
          () => request<WorkspaceFileRecord>({
            type: "set-rows-included", fileId, sourceRows, included, outputFormat: format, workspaceEpoch,
          }),
          async () => (await request<readonly WorkspaceFileRecord[]>({
            type: "refresh-output", fileIds: [fileId], outputFormat: format, workspaceEpoch,
          }))[0]!,
        );
      } catch (error) {
        const current = excludedRows.get(fileId) ?? new Set<number>();
        previous.forEach((wasIncluded, row) => wasIncluded ? current.delete(row) : current.add(row));
        if (current.size) excludedRows.set(fileId, current);
        else excludedRows.delete(fileId);
        throw error;
      }
    },
    subscribeOutputInvalidation(listener) {
      outputInvalidationListeners.add(listener);
      return () => outputInvalidationListeners.delete(listener);
    },
    subscribeRecovered(listener) {
      recoveredListeners.add(listener);
      return () => recoveredListeners.delete(listener);
    },
    subscribeRuntime(listener) {
      runtimeListeners.add(listener);
      return () => runtimeListeners.delete(listener);
    },
  };
}
