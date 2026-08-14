import type { UnloadGuard } from "../../../browser/unload-guard";
import {
  createAdvancedColumnPreferences,
  type AdvancedColumnPreferences,
} from "../../../browser/advanced-preferences";
import type { BatchClient } from "../../batch/batch-client";
import type { AdvancedReferenceSummary, AdvancedResultSummary } from "../../batch/protocol";
import type { AppStatus } from "../../shell/app-status";
import type { WorkspaceModel } from "../../state/workspace-model";
import { canonicalActiveWorkspaceItems } from "../../state/workspace-selectors";
import type { AdvancedView, AdvancedViewState } from "./advanced-view";

const MAX_REFERENCE_FILE_BYTES = 25 * 1024 * 1024;

interface ReferenceState extends AdvancedReferenceSummary {
  fileName: string;
}

interface AdvancedControllerOptions {
  batchClient: BatchClient;
  model: WorkspaceModel;
  preferences?: AdvancedColumnPreferences;
  status: AppStatus;
  unloadGuard: UnloadGuard;
  view: AdvancedView;
}

function defaultKeyColumn(headers: readonly string[]): number {
  const aliases = new Set(["id", "field11", "欄位11", "身分證字號", "身份證字號", "身分證號", "身份證號"]);
  const match = headers.findIndex((header) => aliases.has(header.trim().toLocaleLowerCase("en-US")));
  return match >= 0 ? match : 0;
}

export function createAdvancedController(options: AdvancedControllerOptions) {
  const preferences = options.preferences ?? createAdvancedColumnPreferences();
  let reference: ReferenceState | null = null;
  let result: AdvancedResultSummary | null = null;
  let keyColumnIndex = 0;
  let selectedColumnIndices = new Set<number>();
  let busy: AdvancedViewState["busy"] = null;
  let resultBusy = false;
  let error: string | null = null;
  let generation = 0;
  let pendingTask = Promise.resolve();
  let primaryDependencyKey = "";

  function activeFileIds(): string[] {
    return canonicalActiveWorkspaceItems(options.model.snapshot()).flatMap((item) => item.file ? [item.id] : []);
  }

  function selectedRowCount(): number {
    return canonicalActiveWorkspaceItems(options.model.snapshot())
      .reduce((total, item) => total + (item.file?.summary.includedRows ?? 0), 0);
  }

  function currentPrimaryDependencyKey(): string {
    const snapshot = options.model.snapshot();
    return JSON.stringify([
      snapshot.inputFormat,
      canonicalActiveWorkspaceItems(snapshot).map((item) => [item.id, item.file?.selectionRevision]),
    ]);
  }

  function requestKey(): string {
    const snapshot = options.model.snapshot();
    return JSON.stringify([
      generation,
      reference?.sheetName,
      keyColumnIndex,
      [...selectedColumnIndices].sort((left, right) => left - right),
      canonicalActiveWorkspaceItems(snapshot).map((item) => [item.id, item.file?.selectionRevision]),
    ]);
  }

  function render(): void {
    options.view.render({
      busy,
      canDownload: reference !== null && (result?.selectedRowCount ?? 0) > 0
        && busy === null && !resultBusy,
      error,
      fileCount: activeFileIds().length,
      headers: reference?.headers ?? [],
      issues: reference?.issues ?? [],
      keyColumnIndex,
      referenceFileName: reference?.fileName ?? null,
      resultBusy,
      resultRowCount: result?.resultRowCount ?? 0,
      selectedColumnIndices: [...selectedColumnIndices].sort((left, right) => left - right),
      selectedRowCount: result?.selectedRowCount ?? selectedRowCount(),
      sheetName: reference?.sheetName ?? null,
      sheetNames: reference?.sheetNames ?? [],
      unmatchedRowCount: result?.unmatchedRowCount ?? 0,
    });
    options.unloadGuard.setPendingFile(reference !== null, "advanced-reference");
  }

  async function refreshResult(): Promise<void> {
    if (!reference) {
      result = null;
      resultBusy = false;
      render();
      return;
    }
    const currentGeneration = generation;
    const currentKey = requestKey();
    resultBusy = true;
    render();
    try {
      const next = await options.batchClient.getAdvancedResult(
        activeFileIds(),
        keyColumnIndex,
        [...selectedColumnIndices].sort((left, right) => left - right),
      );
      if (generation === currentGeneration && requestKey() === currentKey) {
        result = next;
        render();
      }
    } catch (caught) {
      if (generation === currentGeneration && requestKey() === currentKey) {
        error = caught instanceof Error ? caught.message : "無法整理參照資料。";
        render();
      }
    } finally {
      if (generation === currentGeneration && requestKey() === currentKey) {
        resultBusy = false;
        render();
      }
    }
  }

  async function applyReference(
    fileName: string,
    summary: AdvancedReferenceSummary,
    currentGeneration: number,
  ): Promise<boolean> {
    const restored = await preferences.restore(summary.headers);
    if (generation !== currentGeneration) return false;
    reference = { ...summary, fileName };
    keyColumnIndex = restored.keyColumnIndex ?? defaultKeyColumn(summary.headers);
    selectedColumnIndices = new Set(restored.selectedColumnIndices);
    return true;
  }

  function savePreferences(): void {
    if (!reference) return;
    void preferences.save(
      reference.headers,
      keyColumnIndex,
      [...selectedColumnIndices].sort((left, right) => left - right),
    );
  }

  async function chooseReference(file: File): Promise<void> {
    const currentGeneration = ++generation;
    error = null;
    busy = "reference";
    resultBusy = false;
    render();
    try {
      if (!/\.(?:xls|xlsx)$/iu.test(file.name)) throw new Error("請選擇 XLS 或 XLSX 檔案。");
      if (file.size === 0 || file.size > MAX_REFERENCE_FILE_BYTES) {
        throw new Error(file.size === 0 ? "參照 Excel 是空的。" : "參照 Excel 超過 25 MB，請選擇較小的檔案。");
      }
      const summary = await options.batchClient.inspectReference(new Uint8Array(await file.arrayBuffer()));
      if (generation !== currentGeneration) return;
      if (!await applyReference(file.name, summary, currentGeneration)) return;
      busy = null;
      options.status.announce(`已讀取參照 Excel：${file.name}。`);
      await refreshResult();
    } catch (caught) {
      if (generation !== currentGeneration) return;
      reference = null;
      result = null;
      selectedColumnIndices.clear();
      void options.batchClient.clearReference().catch(() => undefined);
      error = caught instanceof Error ? caught.message : "無法讀取參照 Excel。";
      options.status.announce("無法讀取參照 Excel。");
    } finally {
      if (generation === currentGeneration) {
        busy = null;
        render();
      }
    }
  }

  async function selectSheet(sheetName: string): Promise<void> {
    if (!reference || busy !== null || resultBusy || reference.sheetName === sheetName) return;
    const currentGeneration = ++generation;
    const fileName = reference.fileName;
    busy = "reference";
    resultBusy = false;
    error = null;
    render();
    try {
      const summary = await options.batchClient.selectReferenceSheet(sheetName);
      if (generation !== currentGeneration) return;
      if (!await applyReference(fileName, summary, currentGeneration)) return;
      busy = null;
      options.status.announce(`已切換到工作表：${sheetName}。`);
      await refreshResult();
    } catch (caught) {
      if (generation !== currentGeneration) return;
      error = caught instanceof Error ? caught.message : "無法讀取這個工作表。";
      options.status.announce("無法讀取這個工作表。");
    } finally {
      if (generation === currentGeneration) {
        busy = null;
        render();
      }
    }
  }

  function clearReference(): void {
    generation += 1;
    reference = null;
    result = null;
    selectedColumnIndices.clear();
    error = null;
    busy = null;
    resultBusy = false;
    void options.batchClient.clearReference().catch(() => undefined);
    render();
    options.status.announce("參照 Excel 已從目前頁面移除；電腦中的檔案沒有變更。");
  }

  async function download(): Promise<void> {
    if (!reference || !result || result.selectedRowCount === 0 || busy !== null || resultBusy) return;
    const requestedState = requestKey();
    busy = "download";
    error = null;
    render();
    options.status.announce("正在建立進階 XLSX。");
    try {
      const output = await options.batchClient.createAdvancedOutput(
        activeFileIds(), keyColumnIndex, [...selectedColumnIndices].sort((left, right) => left - right),
      );
      if (requestKey() !== requestedState) {
        error = "資料已在建立下載期間變更，請重新下載。";
        options.status.announce("資料已變更，進階下載已取消。");
        return;
      }
      options.view.save(output);
      options.status.announce(`已建立進階 XLSX，共 ${result.resultRowCount} 列。`);
    } catch (caught) {
      if (requestKey() !== requestedState) {
        error = "資料已在建立下載期間變更，請重新下載。";
        options.status.announce("資料已變更，進階下載已取消。");
      } else {
        error = caught instanceof Error ? caught.message : "無法建立進階 XLSX。";
        options.status.announce("無法建立進階 XLSX。");
      }
    } finally {
      busy = null;
      render();
    }
  }

  return {
    bind() {
      options.view.bind({
        onChooseReference: () => options.view.fileInput().click(),
        onClearReference: clearReference,
        onDownload: () => { pendingTask = download(); void pendingTask; },
        onKeyColumnChange(index) {
          if (busy !== null || resultBusy) return;
          keyColumnIndex = index;
          savePreferences();
          error = null;
          pendingTask = refreshResult();
        },
        onReferenceChosen(file) { pendingTask = chooseReference(file); void pendingTask; },
        onSelectedColumnChange(index, selected) {
          if (busy !== null || resultBusy) return;
          if (selected) selectedColumnIndices.add(index);
          else selectedColumnIndices.delete(index);
          savePreferences();
          error = null;
          pendingTask = refreshResult();
        },
        onSheetChange(sheetName) {
          if (busy !== null || resultBusy) return;
          pendingTask = selectSheet(sheetName);
          void pendingTask;
        },
      });
      options.model.subscribe(() => {
        const nextDependencyKey = currentPrimaryDependencyKey();
        if (nextDependencyKey === primaryDependencyKey) return;
        primaryDependencyKey = nextDependencyKey;
        error = null;
        if (reference) {
          pendingTask = refreshResult();
          void pendingTask;
        } else render();
      });
      primaryDependencyKey = currentPrimaryDependencyKey();
      render();
    },
    whenIdle() { return pendingTask; },
  };
}
