import type { OfflineCache } from "../../../browser/offline-cache";
import type { UnloadGuard } from "../../../browser/unload-guard";
import { createInternalFileWithRecovery } from "../../../core/conversion-pipeline";
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

function detailAfterColon(message: string): string {
  const colon = message.indexOf("：");
  return colon >= 0 ? message.slice(colon + 1).trim() : "";
}

function friendlyArchiveError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const detail = detailAfterColon(message);
  const withDetail = (text: string) => detail ? `${text}：${detail}` : `${text}。`;

  if (/路徑不安全|路徑超過/u.test(message)) {
    return "壓縮檔內有不安全的檔案位置，因此沒有加入。";
  }
  if (/加密/u.test(message)) {
    return withDetail("壓縮檔內有受密碼保護的檔案，請先解除密碼後再試");
  }
  if (/重複路徑/u.test(message)) {
    return withDetail("壓縮檔內有同名檔案，因此沒有加入");
  }
  if (/25 MiB/u.test(message)) {
    return withDetail("壓縮檔內有檔案超過 25 MB，因此沒有加入");
  }
  if (/100 MiB/u.test(message)) {
    return "壓縮檔解開後超過 100 MB，因此沒有加入。";
  }
  if (/項目.*上限|項目累計/u.test(message)) {
    return "壓縮檔內的檔案太多，因此沒有加入。";
  }
  if (/巢狀/u.test(message)) {
    return "壓縮檔內還有太多層壓縮檔，因此沒有加入。";
  }
  return "無法開啟這個壓縮檔，請確認檔案可正常開啟後再試一次。";
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

  function ignoredEntry(
    sourceId: string,
    relativePath: string,
    virtualPath: string,
    size: number,
    ignoredReason: "symlink" | "unsupported-type",
  ): void {
    options.model.add({
      id: `source-${nextFileId++}`,
      ignoredReason,
      size,
      sourceId,
      state: "ignored",
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
    if (options.model.hasPath(virtualPath)) return `清單中已有這個檔案，因此沒有重複加入：${virtualPath}`;
    const type = detectSourceFileType(virtualPath);
    if (!type) return `這種檔案格式目前不能加入：${virtualPath}`;
    if (size === 0 || size > MAX_SOURCE_FILE_BYTES) {
      rejectedEntry(
        sourceId,
        relativePath,
        virtualPath,
        size,
        size === 0
          ? "這個檔案是空的，請選擇有內容的檔案。"
          : "檔案超過 25 MB，請選擇較小的檔案。",
      );
      return null;
    }

    const entry: WorkspaceItem = {
      id: `source-${nextFileId++}`,
      size,
      sourceId,
      state: "processing",
      relativePath,
      unread: true,
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
      const internalFile = await createInternalFileWithRecovery(
        entry.id,
        virtualPath,
        adapter,
        validationDate ?? taipeiDateStamp(),
      );
      if (currentGeneration !== generation) return null;
      options.model.update(entry.id, (current) => {
        current.file = internalFile;
        current.state = "ready";
      });
    } catch {
      if (currentGeneration === generation) {
        options.model.update(entry.id, (current) => {
          current.error = "無法讀取檔案內容，請確認檔案可正常開啟且未受密碼保護。";
          current.state = "error";
          current.unread = false;
        });
      }
    }
    return null;
  }

  async function addFiles(files: readonly File[]): Promise<void> {
    const currentGeneration = generation;
    const notices: string[] = [];
    const initialFileIds = new Set(options.model.snapshot().files.map((file) => file.id));
    validationDate ??= taipeiDateStamp();
    options.view.clearMessage();
    options.status.announce(`正在加入 ${files.length} 個檔案。`);

    for (const sourceFile of files) {
      if (currentGeneration !== generation) return;
      const inputType = detectInputFileType(sourceFile.name);
      if (!inputType) {
        const source: WorkspaceSource = {
          id: `input-${nextSourceId++}`,
          kind: "file",
          name: sourceFile.name,
        };
        addSource(source);
        ignoredEntry(source.id, sourceFile.name, sourceFile.name, sourceFile.size, "unsupported-type");
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
          sourceFile.size === 0
            ? "這個檔案是空的，請選擇有內容的檔案。"
            : "檔案超過 25 MB，請選擇較小的檔案。",
        );
        continue;
      }

      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await sourceFile.arrayBuffer());
      } catch {
        addSource(source);
        rejectedEntry(
          source.id,
          "",
          sourceFile.name,
          sourceFile.size,
          "無法讀取這個檔案，請確認檔案仍在原本的位置後再試一次。",
        );
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
        if (extraction.files.length === 0 && extraction.skippedEntries.length === 0) {
          rejectedEntry(
            source.id,
            "",
            sourceFile.name,
            sourceFile.size,
            "壓縮檔內沒有可加入的 CSV、Excel 或 BIG-5E 文字檔。",
          );
        }
        for (const skipped of extraction.skippedEntries) {
          ignoredEntry(
            source.id,
            skipped.relativePath ?? skipped.virtualPath.split("/").slice(1).join("/"),
            skipped.virtualPath,
            0,
            skipped.reason,
          );
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
      } catch (error) {
        if (currentGeneration === generation) {
          addSource(source);
          rejectedEntry(
            source.id,
            "",
            sourceFile.name,
            sourceFile.size,
            friendlyArchiveError(error),
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
    const addedItems = options.model.snapshot().files.filter((file) => !initialFileIds.has(file.id));
    const addedCount = addedItems.filter((file) => file.state === "ready").length;
    if (notices.length > 0) {
      options.view.renderMessage("有些檔案未加入", notices, "error");
    }
    const ignoredCount = addedItems.filter((file) => file.state === "ignored").length;
    options.status.announce(notices.length > 0
      ? `已加入 ${addedCount} 個檔案，另有 ${notices.length} 個檔案未加入。`
      : ignoredCount > 0
        ? `已加入 ${addedCount} 個檔案，另有 ${ignoredCount} 個項目未加入。`
        : `已加入 ${addedCount} 個檔案。`);
  }

  function clear(): void {
    generation += 1;
    pendingArchiveCount = 0;
    validationDate = null;
    options.model.clear();
    options.view.clear();
    options.unloadGuard.setPendingFile(false);
    options.status.announce("檔案清單已清空；電腦中的原始檔案沒有變更。");
  }

  return {
    bind() {
      options.view.bind({
        onChooseFile: () => options.view.fileInput().click(),
        onClearWorkspace: () => {
          if (options.view.confirmClear()) clear();
        },
        onFilesChosen: (files) => {
          selectionQueue = selectionQueue.catch(() => undefined).then(() => addFiles(files));
          void selectionQueue.catch(() => options.status.announce("無法加入檔案。"));
        },
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
          if (removed) {
            options.status.announce(`${removed.virtualPath} 已從清單移除；電腦中的原始檔案沒有變更。`);
            options.view.renderUndo(
              `已從清單移除 ${removed.virtualPath}，電腦中的原始檔案沒有變更。`,
              () => {
                if (options.model.restore(removed, source, fileIndex, sourceIndex, wasSelected)) {
                  options.status.announce(`${removed.virtualPath} 已復原。`);
                }
              },
            );
          }
        },
        onRemoveSource: (sourceId) => {
          const snapshot = options.model.snapshot();
          const sourceIndex = snapshot.sources.findIndex((candidate) => candidate.id === sourceId);
          const source = snapshot.sources.find((candidate) => candidate.id === sourceId);
          if (!source) return;
          const restoreItems = snapshot.files.flatMap((item, index) => (
            item.sourceId === sourceId ? [{ index, item }] : []
          ));
          const previousSelectedFileId = snapshot.selectedFileId;
          const removed = options.model.removeSource(sourceId);
          options.status.announce(
            `${source.name} 已從清單移除，共 ${removed.length} 個項目；電腦中的原始檔案沒有變更。`,
          );
          options.view.renderUndo(
            `已從清單移除 ${source.name} 及其中 ${removed.length} 個項目，電腦中的原始檔案沒有變更。`,
            () => {
              if (options.model.restoreSource(
                source,
                restoreItems,
                sourceIndex,
                previousSelectedFileId,
              )) {
                options.status.announce(`${source.name} 及其中 ${removed.length} 個項目已復原。`);
              }
            },
          );
        },
        onMarkAllViewed: () => {
          const count = options.model.markAllViewed();
          options.status.announce(count > 0 ? `已將 ${count} 個檔案標示為已查看。` : "沒有尚未查看的檔案。");
        },
        onVisibleRowsIncludedChange: (sourceRows, included) => {
          const changedCount = options.model.setRowsIncluded(sourceRows, included);
          options.status.announce(changedCount > 0
            ? included
              ? `已選取本頁，共變更 ${changedCount} 列。`
              : `已取消選取本頁，共變更 ${changedCount} 列。`
            : included
              ? "本頁資料列已全部選取。"
              : "本頁資料列已全部取消選取。");
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
