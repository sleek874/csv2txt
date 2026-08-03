import type { OfflineCache } from "../browser/offline-cache";
import type { UnloadGuard } from "../browser/unload-guard";
import { createInternalFile } from "../core/conversion-pipeline";
import {
  hasBlockingFileIssues,
  summarizeInternalFile,
} from "../core/internal-model";
import { detectInputFileType, detectSourceFileType } from "../core/source";
import { taipeiDateStamp } from "../core/validation";
import type { ArchiveParser } from "./archive-loader";
import { prioritizeSourceResources } from "./resource-priority";
import type { OutputAdapter } from "./output-adapter";
import type { SourceAdapter } from "./source-adapter";
import type { SpreadsheetParser } from "./spreadsheet-loader";
import type { WorkspaceItem, WorkspaceView } from "./workspace-view";

const MAX_SOURCE_FILE_BYTES = 25 * 1024 * 1024;

interface WorkspaceControllerOptions {
  archive: ArchiveParser;
  offlineCache: OfflineCache;
  outputAdapter: OutputAdapter;
  sourceAdapter: SourceAdapter;
  spreadsheet: SpreadsheetParser;
  unloadGuard: UnloadGuard;
  view: WorkspaceView;
}

export function createWorkspaceController(options: WorkspaceControllerOptions) {
  const entries: WorkspaceItem[] = [];
  let selectedFileId: string | null = null;
  let generation = 0;
  let nextFileId = 1;
  let pendingArchiveCount = 0;
  let selectionQueue = Promise.resolve();
  let validationDate: string | null = null;

  function announce(message: string): void {
    options.view.announce(message);
  }

  function selectedEntry(): WorkspaceItem | null {
    return entries.find((entry) => entry.id === selectedFileId) ?? null;
  }

  function syncView(): void {
    if (selectedFileId && !entries.some((entry) => entry.id === selectedFileId)) {
      selectedFileId = entries[0]?.id ?? null;
    }
    selectedFileId ??= entries[0]?.id ?? null;
    options.view.renderInventory(entries, selectedFileId);
    options.view.setProcessing(
      pendingArchiveCount > 0 || entries.some((entry) => entry.state === "processing"),
    );
    options.unloadGuard.setPendingFile(entries.length > 0 || pendingArchiveCount > 0);

    const active = selectedEntry();
    if (!active) {
      options.view.syncDownload(null);
      return;
    }
    if (active.state === "processing") {
      options.view.renderActivePending(active.virtualPath);
      return;
    }
    if (active.state === "error" || !active.file) {
      options.view.renderActiveError(active.virtualPath, active.error ?? "檔案無法處理。");
      return;
    }
    options.view.renderFile(active.file);
  }

  function clear(): void {
    generation += 1;
    entries.splice(0);
    selectedFileId = null;
    pendingArchiveCount = 0;
    validationDate = null;
    options.view.clear();
    options.unloadGuard.setPendingFile(false);
    announce("工作區已全部清除；原始檔案沒有變更。");
  }

  function uniquePath(path: string): boolean {
    return !entries.some((entry) => entry.virtualPath === path);
  }

  function rejectedEntry(path: string, size: number, message: string): void {
    const entry: WorkspaceItem = {
      error: message,
      id: `source-${nextFileId++}`,
      size,
      state: "error",
      virtualPath: path,
    };
    entries.push(entry);
    selectedFileId ??= entry.id;
  }

  async function processRegularFile(
    virtualPath: string,
    size: number,
    bytes: Uint8Array,
    currentGeneration: number,
  ): Promise<string | null> {
    if (currentGeneration !== generation) {
      return null;
    }
    if (!uniquePath(virtualPath)) {
      return `未加入重複路徑：${virtualPath}`;
    }
    const type = detectSourceFileType(virtualPath);
    if (!type) {
      return `不支援的檔案類型：${virtualPath}`;
    }
    if (size === 0 || size > MAX_SOURCE_FILE_BYTES) {
      rejectedEntry(
        virtualPath,
        size,
        size === 0 ? "檔案沒有內容。" : "單檔目前支援 25 MiB 以下。",
      );
      syncView();
      return null;
    }

    const entry: WorkspaceItem = {
      id: `source-${nextFileId++}`,
      size,
      state: "processing",
      virtualPath,
    };
    entries.push(entry);
    selectedFileId ??= entry.id;
    syncView();

    try {
      const priority = prioritizeSourceResources(type, {
        prepareExcel: options.spreadsheet.prepare,
        prepareFont: options.offlineCache.prioritizePreviewFont,
      });
      void priority.fullyPrepared.catch(() => {
        // Parser errors remain visible; the table keeps its fallback font.
      });
      await priority.readyForParsing;
      if (currentGeneration !== generation || !entries.includes(entry)) {
        return null;
      }
      const adapter = await options.sourceAdapter.parse(type, bytes);
      if (currentGeneration !== generation || !entries.includes(entry)) {
        return null;
      }
      entry.file = createInternalFile(
        entry.id,
        virtualPath,
        adapter,
        validationDate ?? taipeiDateStamp(),
      );
      entry.state = "ready";
    } catch (error) {
      if (currentGeneration !== generation || !entries.includes(entry)) {
        return null;
      }
      entry.error = error instanceof Error ? error.message : "請確認檔案未損毀或加密。";
      entry.state = "error";
    }
    syncView();
    return null;
  }

  async function addFiles(files: readonly File[]): Promise<void> {
    const currentGeneration = generation;
    const notices: string[] = [];
    const initialEntryCount = entries.length;
    validationDate ??= taipeiDateStamp();
    announce(`正在加入 ${files.length} 個檔案。`);

    for (const sourceFile of files) {
      if (currentGeneration !== generation) {
        return;
      }
      const inputType = detectInputFileType(sourceFile.name);
      if (!inputType) {
        notices.push(`不支援的檔案類型：${sourceFile.name}`);
        continue;
      }
      if (sourceFile.size === 0 || sourceFile.size > MAX_SOURCE_FILE_BYTES) {
        rejectedEntry(
          sourceFile.name,
          sourceFile.size,
          sourceFile.size === 0 ? "檔案沒有內容。" : "來源檔案目前支援 25 MiB 以下。",
        );
        syncView();
        continue;
      }

      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await sourceFile.arrayBuffer());
      } catch {
        rejectedEntry(sourceFile.name, sourceFile.size, "瀏覽器無法讀取這個檔案。");
        syncView();
        continue;
      }
      if (currentGeneration !== generation) {
        return;
      }

      if (inputType !== "zip") {
        const notice = await processRegularFile(
          sourceFile.name,
          sourceFile.size,
          bytes,
          currentGeneration,
        );
        if (notice) {
          notices.push(notice);
        }
        continue;
      }

      pendingArchiveCount += 1;
      syncView();
      try {
        const extraction = await options.archive.extract(sourceFile.name, bytes);
        if (currentGeneration !== generation) {
          return;
        }
        if (extraction.files.length === 0) {
          rejectedEntry(sourceFile.name, sourceFile.size, "ZIP 內沒有支援的來源檔案。");
        }
        for (const extracted of extraction.files) {
          const notice = await processRegularFile(
            extracted.virtualPath,
            extracted.size,
            extracted.bytes,
            currentGeneration,
          );
          if (notice) {
            notices.push(notice);
          }
        }
        if (extraction.skippedEntries > 0) {
          notices.push(`ZIP 中有 ${extraction.skippedEntries} 個不支援的項目未加入。`);
        }
      } catch (error) {
        if (currentGeneration === generation) {
          rejectedEntry(
            sourceFile.name,
            sourceFile.size,
            error instanceof Error ? error.message : "ZIP 無法安全解壓。",
          );
        }
      } finally {
        if (currentGeneration === generation) {
          pendingArchiveCount = Math.max(0, pendingArchiveCount - 1);
          syncView();
        }
      }
    }

    if (currentGeneration !== generation) {
      return;
    }
    syncView();
    if (notices.length > 0) {
      options.view.renderError("部分檔案未加入", notices.join(" "));
    }
    const addedEntryCount = entries.length - initialEntryCount;
    announce(
      notices.length > 0
        ? `已加入 ${addedEntryCount} 個檔案，另有 ${notices.length} 項需要注意。`
        : `已加入 ${addedEntryCount} 個檔案。`,
    );
  }

  function removeFile(fileId: string): void {
    const index = entries.findIndex((entry) => entry.id === fileId);
    if (index < 0) {
      return;
    }
    const [removed] = entries.splice(index, 1);
    if (selectedFileId === fileId) {
      selectedFileId = entries[index]?.id ?? entries[index - 1]?.id ?? null;
    }
    syncView();
    announce(`${removed?.virtualPath ?? "檔案"} 已從工作區移除；原始檔案沒有變更。`);
  }

  function setRowIncluded(sourceRow: number, included: boolean): void {
    const entry = selectedEntry();
    const file = entry?.file;
    const row = file?.rows.find((candidate) => candidate.sourceRow === sourceRow);
    if (!entry || !file || entry.state !== "ready" || !row) {
      return;
    }
    row.included = included;
    file.summary = summarizeInternalFile(
      file,
      file.summary.sourceRows,
      file.summary.excludedBlankRows,
    );
    syncView();
    announce(`第 ${sourceRow} 列已${included ? "納入" : "排除"}輸出。`);
  }

  async function download(): Promise<void> {
    const entry = selectedEntry();
    const file = entry?.file;
    const currentGeneration = generation;
    if (
      !entry
      || !file
      || entry.state !== "ready"
      || hasBlockingFileIssues(file)
      || file.summary.includedRows === 0
    ) {
      return;
    }
    options.view.setDownloadBusy(true);
    announce("正在建立下載。");
    try {
      const output = await options.outputAdapter.create(file, options.view.outputFormat());
      if (currentGeneration !== generation || selectedEntry() !== entry) {
        return;
      }
      options.view.saveOutput(output);
      announce(`已建立 ${options.view.outputFormat() === "xlsx" ? "XLSX" : "Big5 TXT"} 下載。`);
    } catch (error) {
      if (currentGeneration === generation && selectedEntry() === entry) {
        options.view.renderError(
          "無法建立下載",
          error instanceof Error ? error.message : "請重新整理後再試。",
        );
        announce("無法建立下載。");
      }
    } finally {
      if (currentGeneration === generation && selectedEntry() === entry) {
        options.view.setDownloadBusy(false);
      }
    }
  }

  return {
    bind() {
      options.view.bind({
        onChooseFile: () => options.view.fileInput().click(),
        onClearWorkspace: clear,
        onFilesChosen: (files) => {
          selectionQueue = selectionQueue
            .catch(() => undefined)
            .then(() => addFiles(files));
          void selectionQueue.catch(() => {
            announce("無法加入檔案。");
          });
        },
        onRemoveFile: removeFile,
        onRowIncludedChange: setRowIncluded,
        onSelectFile: (fileId) => {
          if (entries.some((entry) => entry.id === fileId)) {
            selectedFileId = fileId;
            syncView();
          }
        },
        onDownload: () => void download(),
        onOutputFormatChange: () => options.view.syncDownload(selectedEntry()?.file ?? null),
      });
      options.view.clear();
    },
    whenIdle() {
      return selectionQueue;
    },
  };
}
