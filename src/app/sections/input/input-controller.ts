import type { OfflineCache } from "../../../browser/offline-cache";
import type { UnloadGuard } from "../../../browser/unload-guard";
import { createInternalFile } from "../../../core/conversion-pipeline";
import { detectInputFileType, detectSourceFileType } from "../../../core/file-formats";
import { taipeiDateStamp } from "../../../core/validation";
import type { InputAdapter } from "../../adapters/input-adapter";
import type { CodecManager } from "../../resources/codec-manager";
import { prepareSourceResources } from "../../resources/resource-policy";
import type { AppStatus } from "../../shell/app-status";
import type { WorkspaceModel } from "../../state/workspace-model";
import type { WorkspaceItem, WorkspaceSource } from "../../state/workspace-types";
import type { InputSectionView } from "./input-section-view";

const MAX_SOURCE_FILE_BYTES = 25 * 1024 * 1024;

interface InputControllerOptions {
  codecs: CodecManager;
  inputAdapter: InputAdapter;
  model: WorkspaceModel;
  offlineCache: OfflineCache;
  status: AppStatus;
  unloadGuard: UnloadGuard;
  view: InputSectionView;
}

export function createInputController(options: InputControllerOptions) {
  let generation = 0;
  let nextFileId = 1;
  let nextSourceId = 1;
  let pendingArchiveCount = 0;
  let selectionQueue = Promise.resolve();
  let validationDate: string | null = null;

  function render(): void {
    const snapshot = options.model.snapshot();
    options.view.render(snapshot, pendingArchiveCount);
    options.unloadGuard.setPendingFile(snapshot.sources.length > 0 || pendingArchiveCount > 0);
  }

  function rejectedEntry(
    sourceId: string,
    relativePath: string,
    virtualPath: string,
    size: number,
    message: string,
  ): void {
    options.model.add({
      error: message,
      id: `source-${nextFileId++}`,
      size,
      sourceId,
      state: "error",
      relativePath,
      virtualPath,
    });
  }

  function addSource(source: WorkspaceSource): void {
    if (!options.model.snapshot().sources.some((current) => current.id === source.id)) {
      options.model.addSource(source);
    }
  }

  async function processRegularFile(
    sourceId: string,
    relativePath: string,
    virtualPath: string,
    size: number,
    bytes: Uint8Array,
    currentGeneration: number,
  ): Promise<string | null> {
    if (currentGeneration !== generation) return null;
    if (options.model.hasPath(virtualPath)) return `未加入重複路徑：${virtualPath}`;
    const type = detectSourceFileType(virtualPath);
    if (!type) return `不支援的檔案類型：${virtualPath}`;
    if (size === 0 || size > MAX_SOURCE_FILE_BYTES) {
      rejectedEntry(
        sourceId,
        relativePath,
        virtualPath,
        size,
        size === 0 ? "檔案沒有內容。" : "單檔目前支援 25 MiB 以下。",
      );
      return null;
    }

    const entry: WorkspaceItem = {
      id: `source-${nextFileId++}`,
      size,
      sourceId,
      state: "processing",
      relativePath,
      virtualPath,
    };
    options.model.add(entry);

    try {
      const preparation = prepareSourceResources(type, {
        codecs: options.codecs,
        prepareFont: options.offlineCache.prioritizePreviewFont,
      });
      void preparation.fullyPrepared.catch(() => {
        // Parser errors remain visible; the table keeps its fallback font.
      });
      await preparation.readyForParsing;
      if (currentGeneration !== generation) return null;
      const adapter = await options.inputAdapter.parse(type, bytes);
      if (currentGeneration !== generation) return null;
      options.model.update(entry.id, (current) => {
        current.file = createInternalFile(
          current.id,
          virtualPath,
          adapter,
          validationDate ?? taipeiDateStamp(),
        );
        current.state = "ready";
      });
    } catch (error) {
      if (currentGeneration === generation) {
        options.model.update(entry.id, (current) => {
          current.error = error instanceof Error ? error.message : "請確認檔案未損毀或加密。";
          current.state = "error";
        });
      }
    }
    return null;
  }

  async function addFiles(files: readonly File[]): Promise<void> {
    const currentGeneration = generation;
    const notices: string[] = [];
    const initialCount = options.model.snapshot().files.length;
    validationDate ??= taipeiDateStamp();
    options.status.announce(`正在加入 ${files.length} 個檔案。`);

    for (const sourceFile of files) {
      if (currentGeneration !== generation) return;
      const inputType = detectInputFileType(sourceFile.name);
      if (!inputType) {
        notices.push(`不支援的檔案類型：${sourceFile.name}`);
        continue;
      }
      const source: WorkspaceSource = {
        id: `input-${nextSourceId++}`,
        kind: inputType === "zip" ? "archive" : "file",
        name: sourceFile.name,
      };
      if (sourceFile.size === 0 || sourceFile.size > MAX_SOURCE_FILE_BYTES) {
        addSource(source);
        rejectedEntry(
          source.id,
          "",
          sourceFile.name,
          sourceFile.size,
          sourceFile.size === 0 ? "檔案沒有內容。" : "來源檔案目前支援 25 MiB 以下。",
        );
        continue;
      }

      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await sourceFile.arrayBuffer());
      } catch {
        addSource(source);
        rejectedEntry(source.id, "", sourceFile.name, sourceFile.size, "瀏覽器無法讀取這個檔案。");
        continue;
      }
      if (currentGeneration !== generation) return;

      if (inputType !== "zip") {
        addSource(source);
        const notice = await processRegularFile(
          source.id,
          sourceFile.name,
          sourceFile.name,
          sourceFile.size,
          bytes,
          currentGeneration,
        );
        if (notice) {
          notices.push(notice);
          options.model.removeSource(source.id);
        }
        continue;
      }

      pendingArchiveCount += 1;
      render();
      try {
        const extraction = await (await options.codecs.zip()).extractZip(sourceFile.name, bytes);
        if (currentGeneration !== generation) return;
        addSource(source);
        if (extraction.files.length === 0) {
          rejectedEntry(source.id, "", sourceFile.name, sourceFile.size, "ZIP 內沒有支援的來源檔案。");
        }
        for (const extracted of extraction.files) {
          const notice = await processRegularFile(
            source.id,
            extracted.relativePath,
            extracted.virtualPath,
            extracted.size,
            extracted.bytes,
            currentGeneration,
          );
          if (notice) notices.push(notice);
        }
        if (extraction.files.length > 0 && !options.model.snapshot().files.some((file) => file.sourceId === source.id)) {
          options.model.removeSource(source.id);
        }
        if (extraction.skippedEntries > 0) {
          notices.push(`ZIP 中有 ${extraction.skippedEntries} 個不支援的項目未加入。`);
        }
      } catch (error) {
        if (currentGeneration === generation) {
          addSource(source);
          rejectedEntry(
            source.id,
            "",
            sourceFile.name,
            sourceFile.size,
            error instanceof Error ? error.message : "ZIP 無法安全解壓。",
          );
        }
      } finally {
        if (currentGeneration === generation) {
          pendingArchiveCount = Math.max(0, pendingArchiveCount - 1);
          render();
        }
      }
    }

    if (currentGeneration !== generation) return;
    if (notices.length > 0) options.view.renderError("部分檔案未加入", notices.join(" "));
    const addedCount = options.model.snapshot().files.length - initialCount;
    options.status.announce(notices.length > 0
      ? `已加入 ${addedCount} 個檔案，另有 ${notices.length} 項需要注意。`
      : `已加入 ${addedCount} 個檔案。`);
  }

  function clear(): void {
    generation += 1;
    pendingArchiveCount = 0;
    validationDate = null;
    options.model.clear();
    options.view.clear();
    options.unloadGuard.setPendingFile(false);
    options.status.announce("工作區已全部清除；原始檔案沒有變更。");
  }

  return {
    bind() {
      options.view.bind({
        onChooseFile: () => options.view.fileInput().click(),
        onClearWorkspace: clear,
        onFilesChosen: (files) => {
          selectionQueue = selectionQueue.catch(() => undefined).then(() => addFiles(files));
          void selectionQueue.catch(() => options.status.announce("無法加入檔案。"));
        },
        onRemoveFile: (fileId) => {
          const removed = options.model.remove(fileId);
          if (removed) options.status.announce(`${removed.virtualPath} 已從工作區移除；原始檔案沒有變更。`);
        },
        onRemoveSource: (sourceId) => {
          const source = options.model.snapshot().sources.find((candidate) => candidate.id === sourceId);
          const removed = options.model.removeSource(sourceId);
          if (source) {
            options.status.announce(`${source.name} 已從工作區移除，共 ${removed.length} 個檔案；原始檔案沒有變更。`);
          }
        },
        onRowIncludedChange: (sourceRow, included) => {
          if (options.model.setRowIncluded(sourceRow, included)) {
            options.status.announce(`第 ${sourceRow} 列已${included ? "納入" : "排除"}輸出。`);
          }
        },
        onSelectFile: (fileId) => { options.model.select(fileId); },
      });
      options.model.subscribe(render);
      options.view.clear();
      render();
    },
    whenIdle() {
      return selectionQueue;
    },
  };
}
