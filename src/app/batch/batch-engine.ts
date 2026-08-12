import { createAdvancedOutputAdapter } from "../adapters/advanced-output-adapter";
import { createInputAdapter } from "../adapters/input-adapter";
import { createCodecManager } from "../resources/codec-manager";
import { joinAdvancedRows, taipeiCurrentYear } from "../../core/advanced/lookup";
import { createInternalFileWithRecovery } from "../../core/conversion-pipeline";
import { detectSourceFileType, fileFormatForSourceType } from "../../core/file-formats";
import type {
  AdvancedReferenceSummary,
  AdvancedResultSummary,
  BatchRequest,
  BatchResponseValue,
  ProcessSourceResult,
  ProcessingProgress,
  StoredReference,
} from "./protocol";
import {
  compactInternalFile,
  setCompactRowsIncluded,
  type CompactFile,
} from "./compact-workspace";
import { collectCompactAdvancedRows } from "./advanced-data";
import { queryPreviewPage } from "./preview-query";
import { createProgressScheduler, yieldToWorker } from "./scheduler";
import { createCompactOutput } from "./standard-output";
import { compactFileRecord } from "./workspace-summary";

function cloneTransfer(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes
    : bytes.slice();
}

export function createBatchEngine(
  onProgress: (progress: ProcessingProgress) => void,
) {
  const codecs = createCodecManager();
  const progress = createProgressScheduler(onProgress);
  const inputAdapter = createInputAdapter(codecs);
  const advancedAdapter = createAdvancedOutputAdapter(codecs);
  const files = new Map<string, CompactFile>();
  const removedFiles = new Map<string, CompactFile>();
  const cancelledSources = new Set<string>();
  let reference: StoredReference | null = null;

  function assertSourceActive(sourceId: string): void {
    if (cancelledSources.has(sourceId)) throw new Error("本次新增已取消。");
  }

  function requireFile(fileId: string): CompactFile {
    const file = files.get(fileId);
    if (!file) throw new Error("找不到要處理的檔案，請重新選擇檔案。");
    return file;
  }

  async function parseFile(
    id: string,
    virtualPath: string,
    bytes: Uint8Array,
    today: string,
  ): Promise<CompactFile> {
    const type = detectSourceFileType(virtualPath);
    if (!type) throw new Error(`這種檔案格式目前不能加入：${virtualPath}`);
    const adapter = await inputAdapter.parse(type, bytes);
    return compactInternalFile(await createInternalFileWithRecovery(id, virtualPath, adapter, today));
  }

  async function processSource(request: Extract<BatchRequest, { type: "process-source" }>): Promise<ProcessSourceResult> {
    const existingPaths = new Set(request.existingPaths);
    const entries = [];
    try {
      assertSourceActive(request.sourceId);
      if (request.inputType !== "zip") {
        if (existingPaths.has(request.sourceName)) throw new Error(`清單中已有這個檔案，因此沒有重複加入：${request.sourceName}`);
        progress.publish({ current: 0, phase: "processing", sourceId: request.sourceId, total: 1, virtualPath: request.sourceName }, true);
        const id = `${request.sourceId}:file`;
        const file = await parseFile(id, request.sourceName, request.bytes, request.today);
        assertSourceActive(request.sourceId);
        files.set(id, file);
        entries.push({
          file: compactFileRecord(file, request.outputFormat),
          id,
          relativePath: request.sourceName,
          size: request.bytes.byteLength,
          sourceFormat: fileFormatForSourceType(request.inputType),
          virtualPath: request.sourceName,
        });
        assertSourceActive(request.sourceId);
        progress.publish({ current: 1, phase: "finalizing", sourceId: request.sourceId, total: 1, virtualPath: request.sourceName }, true);
        return { entries, skippedEntries: [] };
      }

      progress.publish({ current: 0, phase: "extracting", sourceId: request.sourceId, total: 0, virtualPath: request.sourceName }, true);
      const extraction = await (await codecs.zip()).extractZip(request.sourceName, request.bytes);
      assertSourceActive(request.sourceId);
      const total = extraction.files.length;
      let current = 0;
      for (const extracted of extraction.files) {
        assertSourceActive(request.sourceId);
        if (existingPaths.has(extracted.virtualPath)) {
          throw new Error(`清單中已有這個檔案，因此沒有重複加入：${extracted.virtualPath}`);
        }
        current += 1;
        progress.publish({ current: current - 1, phase: "processing", sourceId: request.sourceId, total, virtualPath: extracted.virtualPath });
        const id = `${request.sourceId}:entry:${current}`;
        const type = detectSourceFileType(extracted.virtualPath);
        if (!type) continue;
        const file = await parseFile(id, extracted.virtualPath, extracted.bytes, request.today);
        assertSourceActive(request.sourceId);
        files.set(id, file);
        entries.push({
          file: compactFileRecord(file, request.outputFormat),
          id,
          relativePath: extracted.relativePath,
          size: extracted.size,
          sourceFormat: fileFormatForSourceType(type),
          virtualPath: extracted.virtualPath,
        });
        extracted.bytes = new Uint8Array(0);
        await yieldToWorker();
        assertSourceActive(request.sourceId);
      }
      progress.publish({ current: total, phase: "finalizing", sourceId: request.sourceId, total, virtualPath: request.sourceName }, true);
      assertSourceActive(request.sourceId);
      return { entries, skippedEntries: extraction.skippedEntries };
    } catch (error) {
      entries.forEach((entry) => files.delete(entry.id));
      throw error;
    } finally {
      cancelledSources.delete(request.sourceId);
    }
  }

  function selectedFiles(fileIds: readonly string[]): CompactFile[] {
    return fileIds.map(requireFile);
  }

  function referenceSummary(): AdvancedReferenceSummary {
    if (!reference) throw new Error("請先選擇參照 Excel。");
    return {
      headers: reference.table.headers,
      issueCount: reference.table.issues.length,
      sheetName: reference.table.sheetName,
      sheetNames: reference.sheetNames,
    };
  }

  function advancedResult(
    fileIds: readonly string[],
    keyColumnIndex: number,
    selectedColumnIndices: readonly number[],
  ) {
    if (!reference) throw new Error("請先選擇參照 Excel。");
    return joinAdvancedRows(
      selectedFiles(fileIds).flatMap((file) => collectCompactAdvancedRows(file, taipeiCurrentYear())),
      reference.table,
      keyColumnIndex,
      selectedColumnIndices,
    );
  }

  return {
    async handle(request: BatchRequest): Promise<BatchResponseValue> {
      switch (request.type) {
        case "cancel-source":
          cancelledSources.add(request.sourceId);
          return null;
        case "clear-files":
          files.clear();
          removedFiles.clear();
          return null;
        case "process-source": return processSource(request);
        case "preview-page": return queryPreviewPage(requireFile(request.fileId), request.filter, request.page, request.outputFormat);
        case "set-row-included": {
          const file = requireFile(request.fileId);
          setCompactRowsIncluded(file, new Set([request.sourceRow]), request.included);
          return compactFileRecord(file, request.outputFormat);
        }
        case "set-rows-included": {
          const file = requireFile(request.fileId);
          setCompactRowsIncluded(file, new Set(request.sourceRows), request.included);
          return compactFileRecord(file, request.outputFormat);
        }
        case "refresh-output": return selectedFiles(request.fileIds).map((file) => (
          compactFileRecord(file, request.outputFormat)
        ));
        case "create-output": return createCompactOutput(
          selectedFiles(request.fileIds),
          request.outputFormat,
          codecs,
          new Date(request.createdAt),
        );
        case "discard-files":
          request.fileIds.forEach((id) => {
            files.delete(id);
            removedFiles.delete(id);
          });
          return null;
        case "remove-files":
          request.fileIds.forEach((id) => {
            const file = files.get(id);
            if (file) removedFiles.set(id, file);
            files.delete(id);
          });
          return null;
        case "restore-files":
          request.fileIds.forEach((id) => {
            const file = removedFiles.get(id);
            if (file) files.set(id, file);
            removedFiles.delete(id);
          });
          return null;
        case "inspect-reference": {
          const bytes = cloneTransfer(request.bytes);
          const inspected = await advancedAdapter.inspect(bytes);
          const sheetName = inspected.sheetNames[0];
          if (!sheetName) throw new Error("參照 Excel 不含任何工作表。");
          const table = await advancedAdapter.parse(bytes, sheetName);
          reference = { bytes, table, sheetNames: inspected.sheetNames };
          return referenceSummary();
        }
        case "clear-reference":
          reference = null;
          return null;
        case "select-reference-sheet":
          if (!reference) throw new Error("請先選擇參照 Excel。");
          reference.table = await advancedAdapter.parse(reference.bytes, request.sheetName);
          return referenceSummary();
        case "advanced-result": {
          const result = advancedResult(request.fileIds, request.keyColumnIndex, request.selectedColumnIndices);
          return {
            matchedRowCount: result.matchedRowCount,
            resultRowCount: result.resultRowCount,
            selectedRowCount: result.selectedRowCount,
            unmatchedRowCount: result.unmatchedRowCount,
          } satisfies AdvancedResultSummary;
        }
        case "create-advanced-output": {
          const result = advancedResult(request.fileIds, request.keyColumnIndex, request.selectedColumnIndices);
          return advancedAdapter.create(result, new Date(request.createdAt));
        }
      }
    },
  };
}
