import { createAdvancedOutputAdapter } from "../adapters/advanced-output-adapter";
import { createInputAdapter } from "../adapters/input-adapter";
import { createCodecManager } from "../resources/codec-manager";
import {
  createAdvancedReferenceIndex,
  taipeiCurrentYear,
  type AdvancedReferenceIndex,
} from "../../core/advanced/lookup";
import { compareCanonicalVirtualPaths } from "../../core/archive/policy";
import { createInternalFileWithRecovery } from "../../core/conversion-pipeline";
import { detectSourceFileType, fileFormatForSourceType } from "../../core/file-formats";
import type {
  AdvancedReferenceSummary,
  AdvancedResultSummary,
  BatchRequest,
  BatchResponseValue,
  OutputProgress,
  ProcessSourceResult,
  ProcessingProgress,
  SkippedEntry,
  StoredReference,
} from "./protocol";
import {
  compactInternalFile,
  setCompactRowsIncluded,
  type CompactFile,
} from "./compact-workspace";
import {
  createCompactAdvancedResult,
  summarizeCompactAdvanced,
} from "./advanced-data";
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
  let outputGeneration = 0;
  let workspaceEpoch = 0;
  let reference: StoredReference | null = null;
  let referenceIndex: {
    keyColumnIndex: number;
    table: StoredReference["table"];
    value: AdvancedReferenceIndex;
  } | null = null;

  function assertWorkspaceEpoch(requestEpoch: number): void {
    if (requestEpoch === workspaceEpoch) return;
    if (requestEpoch > workspaceEpoch && files.size === 0 && removedFiles.size === 0) {
      workspaceEpoch = requestEpoch;
      return;
    }
    throw new Error("工作區已重設。");
  }

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
    assertWorkspaceEpoch(request.workspaceEpoch);
    const existingPaths = new Set(request.existingPaths);
    const entries = [];
    try {
      assertSourceActive(request.sourceId);
      assertWorkspaceEpoch(request.workspaceEpoch);
      if (request.inputType !== "zip") {
        if (existingPaths.has(request.sourceName)) throw new Error(`清單中已有這個檔案，因此沒有重複加入：${request.sourceName}`);
        progress.publish({ current: 0, phase: "processing", sourceId: request.sourceId, total: 1, virtualPath: request.sourceName }, true);
        const id = `${request.sourceId}:file`;
        const file = await parseFile(id, request.sourceName, request.bytes, request.today);
        assertSourceActive(request.sourceId);
        assertWorkspaceEpoch(request.workspaceEpoch);
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
        assertWorkspaceEpoch(request.workspaceEpoch);
        progress.publish({ current: 1, phase: "finalizing", sourceId: request.sourceId, total: 1, virtualPath: request.sourceName }, true);
        return { entries, skippedEntries: [] };
      }

      progress.publish({ current: 0, phase: "extracting", sourceId: request.sourceId, total: 0, virtualPath: request.sourceName }, true);
      const archive = await codecs.zip();
      assertSourceActive(request.sourceId);
      const skippedEntries: SkippedEntry[] = [];
      let candidateIndex = 0;
      let candidateCount = 0;
      let candidateProgressPublished = false;
      let excludedCandidateCount = 0;
      let processedCount = 0;
      for await (const visit of archive.walkZip(request.sourceName, request.bytes)) {
        assertSourceActive(request.sourceId);
        assertWorkspaceEpoch(request.workspaceEpoch);
        candidateCount = Math.max(0, visit.candidateCount - excludedCandidateCount);
        if (visit.kind === "candidates") {
          progress.publish(
            { current: processedCount, phase: "processing", sourceId: request.sourceId, total: candidateCount, virtualPath: visit.virtualPath },
            !candidateProgressPublished,
          );
          candidateProgressPublished = true;
          continue;
        }
        if (visit.kind === "discarded") {
          const { candidateCount: _candidateCount, kind: _kind, ...skipped } = visit;
          skippedEntries.push(skipped);
          progress.publish({ current: processedCount, phase: "processing", sourceId: request.sourceId, total: candidateCount, virtualPath: visit.virtualPath });
          await yieldToWorker();
          continue;
        }
        candidateIndex += 1;
        progress.publish({ current: processedCount, phase: "processing", sourceId: request.sourceId, total: candidateCount, virtualPath: visit.virtualPath });
        let processedCandidate = true;
        try {
          if (existingPaths.has(visit.virtualPath)) {
            skippedEntries.push({
              reason: "duplicate-path",
              relativePath: visit.relativePath,
              virtualPath: visit.virtualPath,
            });
            excludedCandidateCount += 1;
            candidateCount = Math.max(0, visit.candidateCount - excludedCandidateCount);
            processedCandidate = false;
            continue;
          }
          const type = detectSourceFileType(visit.virtualPath);
          if (!type) {
            excludedCandidateCount += 1;
            candidateCount = Math.max(0, visit.candidateCount - excludedCandidateCount);
            processedCandidate = false;
            continue;
          }
          const id = `${request.sourceId}:entry:${candidateIndex}`;
          let file: CompactFile;
          try {
            file = await parseFile(id, visit.virtualPath, visit.bytes, request.today);
          } catch {
            skippedEntries.push({
              reason: "invalid-file",
              relativePath: visit.relativePath,
              virtualPath: visit.virtualPath,
            });
            continue;
          }
          assertSourceActive(request.sourceId);
          assertWorkspaceEpoch(request.workspaceEpoch);
          files.set(id, file);
          entries.push({
            file: compactFileRecord(file, request.outputFormat),
            id,
            relativePath: visit.relativePath,
            size: visit.size,
            sourceFormat: fileFormatForSourceType(type),
            virtualPath: visit.virtualPath,
          });
          existingPaths.add(visit.virtualPath);
        } finally {
          visit.bytes = new Uint8Array(0);
          if (processedCandidate) processedCount += 1;
          progress.publish({ current: processedCount, phase: "processing", sourceId: request.sourceId, total: candidateCount, virtualPath: visit.virtualPath });
          await yieldToWorker();
        }
        assertSourceActive(request.sourceId);
        assertWorkspaceEpoch(request.workspaceEpoch);
      }
      progress.publish({ current: processedCount, phase: "finalizing", sourceId: request.sourceId, total: candidateCount, virtualPath: request.sourceName }, true);
      assertSourceActive(request.sourceId);
      return { entries, skippedEntries };
    } catch (error) {
      entries.forEach((entry) => files.delete(entry.id));
      throw error;
    } finally {
      cancelledSources.delete(request.sourceId);
    }
  }

  function selectedFiles(fileIds: readonly string[]): CompactFile[] {
    return fileIds.map(requireFile)
      .sort((left, right) => compareCanonicalVirtualPaths(left.virtualPath, right.virtualPath));
  }

  function referenceSummary(): AdvancedReferenceSummary {
    if (!reference) throw new Error("請先選擇參照 Excel。");
    const counts = new Map<string, number>();
    reference.table.issues.forEach((issue) => {
      const code = issue.code ?? "OTHER";
      counts.set(code, (counts.get(code) ?? 0) + 1);
    });
    const emptyHeaderCount = counts.get("EMPTY_HEADER") ?? 0;
    const duplicateHeaderCount = counts.get("DUPLICATE_HEADER") ?? 0;
    const formulaResultCount = counts.get("FORMULA_RESULT_MISSING") ?? 0;
    const otherCount = reference.table.issues.length
      - emptyHeaderCount - duplicateHeaderCount - formulaResultCount;
    const issues = [
      ...(emptyHeaderCount > 0
        ? [`有 ${emptyHeaderCount.toLocaleString("zh-TW")} 個欄位沒有標題，已用欄位序號補上。`]
        : []),
      ...(duplicateHeaderCount > 0
        ? [`有 ${duplicateHeaderCount.toLocaleString("zh-TW")} 個重複標題，已加上序號區分。`]
        : []),
      ...(formulaResultCount > 0
        ? [`有 ${formulaResultCount.toLocaleString("zh-TW")} 個公式沒有可讀取的結果，請在 Excel 重新計算並儲存。`]
        : []),
      ...(otherCount > 0
        ? [`另有 ${otherCount.toLocaleString("zh-TW")} 個讀取提醒，請核對參照 Excel。`]
        : []),
    ];
    return {
      headers: reference.table.headers,
      issues,
      sheetName: reference.table.sheetName,
      sheetNames: reference.sheetNames,
    };
  }

  function indexedReference(keyColumnIndex: number): AdvancedReferenceIndex {
    if (!reference) throw new Error("請先選擇參照 Excel。");
    if (referenceIndex?.table === reference.table && referenceIndex.keyColumnIndex === keyColumnIndex) {
      return referenceIndex.value;
    }
    const value = createAdvancedReferenceIndex(reference.table, keyColumnIndex);
    referenceIndex = { keyColumnIndex, table: reference.table, value };
    return value;
  }

  return {
    async handle(
      request: BatchRequest,
      onOutputProgress: (progress: OutputProgress) => void = () => undefined,
    ): Promise<BatchResponseValue> {
      switch (request.type) {
        case "ping": return null;
        case "cancel-source":
          assertWorkspaceEpoch(request.workspaceEpoch);
          cancelledSources.add(request.sourceId);
          return null;
        case "reset-workspace":
          if (request.workspaceEpoch < workspaceEpoch) throw new Error("工作區已重設。");
          workspaceEpoch = request.workspaceEpoch;
          files.clear();
          removedFiles.clear();
          cancelledSources.clear();
          outputGeneration += 1;
          return null;
        case "process-source": return processSource(request);
        case "preview-page":
          assertWorkspaceEpoch(request.workspaceEpoch);
          return queryPreviewPage(requireFile(request.fileId), request.filter, request.page, request.outputFormat);
        case "set-row-included": {
          assertWorkspaceEpoch(request.workspaceEpoch);
          const file = requireFile(request.fileId);
          setCompactRowsIncluded(file, new Set([request.sourceRow]), request.included);
          return compactFileRecord(file, request.outputFormat);
        }
        case "set-rows-included": {
          assertWorkspaceEpoch(request.workspaceEpoch);
          const file = requireFile(request.fileId);
          setCompactRowsIncluded(file, new Set(request.sourceRows), request.included);
          return compactFileRecord(file, request.outputFormat);
        }
        case "refresh-output":
          assertWorkspaceEpoch(request.workspaceEpoch);
          return selectedFiles(request.fileIds).map((file) => compactFileRecord(file, request.outputFormat));
        case "cancel-output":
          assertWorkspaceEpoch(request.workspaceEpoch);
          outputGeneration += 1;
          return null;
        case "create-output": {
          assertWorkspaceEpoch(request.workspaceEpoch);
          const generation = ++outputGeneration;
          return createCompactOutput(
            selectedFiles(request.fileIds),
            request.outputFormat,
            codecs,
            new Date(request.createdAt),
            {
              isCancelled: () => generation !== outputGeneration,
              onProgress: onOutputProgress,
              yieldAfterFile: yieldToWorker,
            },
          );
        }
        case "discard-files":
          assertWorkspaceEpoch(request.workspaceEpoch);
          request.fileIds.forEach((id) => {
            files.delete(id);
            removedFiles.delete(id);
          });
          return null;
        case "remove-files":
          assertWorkspaceEpoch(request.workspaceEpoch);
          request.fileIds.forEach((id) => {
            const file = files.get(id);
            if (file) removedFiles.set(id, file);
            files.delete(id);
          });
          return null;
        case "restore-files":
          assertWorkspaceEpoch(request.workspaceEpoch);
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
          referenceIndex = null;
          return referenceSummary();
        }
        case "clear-reference":
          reference = null;
          referenceIndex = null;
          return null;
        case "select-reference-sheet":
          if (!reference) throw new Error("請先選擇參照 Excel。");
          reference.table = await advancedAdapter.parse(reference.bytes, request.sheetName);
          referenceIndex = null;
          return referenceSummary();
        case "advanced-result": {
          assertWorkspaceEpoch(request.workspaceEpoch);
          return summarizeCompactAdvanced(
            selectedFiles(request.fileIds),
            indexedReference(request.keyColumnIndex),
          ) satisfies AdvancedResultSummary;
        }
        case "create-advanced-output": {
          assertWorkspaceEpoch(request.workspaceEpoch);
          const selected = selectedFiles(request.fileIds);
          const total = selected.length;
          let completed = 0;
          if (selected[0]) {
            onOutputProgress({
              current: 0,
              phase: "processing",
              total,
              virtualPath: selected[0].virtualPath,
            });
          }
          const result = createCompactAdvancedResult(
            selected,
            indexedReference(request.keyColumnIndex),
            request.selectedColumnIndices,
            taipeiCurrentYear(),
            (file) => {
              completed += 1;
              const next = selected[completed];
              onOutputProgress({
                current: completed,
                phase: next ? "processing" : "finalizing",
                total,
                virtualPath: next?.virtualPath ?? file.virtualPath,
              });
            },
          );
          await yieldToWorker();
          return advancedAdapter.create(result, new Date(request.createdAt));
        }
      }
    },
  };
}
