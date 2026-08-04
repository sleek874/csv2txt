import {
  collectAdvancedPrimaryRows,
  joinAdvancedRows,
  type AdvancedLookupResult,
} from "../../../core/advanced/lookup";
import type { HeaderedSpreadsheet } from "../../../core/formats/spreadsheet";
import type { AdvancedOutputAdapter } from "../../adapters/advanced-output-adapter";
import type { AppStatus } from "../../shell/app-status";
import type { WorkspaceModel } from "../../state/workspace-model";
import type { UnloadGuard } from "../../../browser/unload-guard";
import type { AdvancedView, AdvancedViewState } from "./advanced-view";

const MAX_REFERENCE_FILE_BYTES = 25 * 1024 * 1024;

interface ReferenceWorkbookState {
  bytes: Uint8Array;
  fileName: string;
  sheetNames: readonly string[];
  table: HeaderedSpreadsheet;
}

interface AdvancedControllerOptions {
  model: WorkspaceModel;
  outputAdapter: AdvancedOutputAdapter;
  status: AppStatus;
  unloadGuard: UnloadGuard;
  view: AdvancedView;
}

function defaultKeyColumn(headers: readonly string[]): number {
  const aliases = new Set([
    "id",
    "field11",
    "欄位11",
    "身分證字號",
    "身份證字號",
    "身分證號",
    "身份證號",
  ]);
  const match = headers.findIndex((header) => aliases.has(header.trim().toLocaleLowerCase("en-US")));
  return match >= 0 ? match : 0;
}

export function createAdvancedController(options: AdvancedControllerOptions) {
  let reference: ReferenceWorkbookState | null = null;
  let keyColumnIndex = 0;
  let selectedColumnIndices = new Set<number>();
  let busy: AdvancedViewState["busy"] = null;
  let error: string | null = null;
  let generation = 0;
  let pendingTask = Promise.resolve();

  function primaryRows() {
    const files = options.model.snapshot().files.flatMap((item) => item.file ? [item.file] : []);
    return collectAdvancedPrimaryRows(files);
  }

  function result(): AdvancedLookupResult | null {
    if (!reference) return null;
    const orderedSelectedColumns = [...selectedColumnIndices].sort((left, right) => left - right);
    return joinAdvancedRows(
      primaryRows(),
      reference.table,
      keyColumnIndex,
      orderedSelectedColumns,
    );
  }

  function requestKey(): string {
    const snapshot = options.model.snapshot();
    return JSON.stringify([
      generation,
      reference?.table.sheetName,
      keyColumnIndex,
      [...selectedColumnIndices].sort((left, right) => left - right),
      snapshot.files.map((item) => [
        item.id,
        item.state,
        item.file?.rows.filter((row) => row.included).map((row) => row.sourceRow),
      ]),
    ]);
  }

  function render(): void {
    const lookupResult = result();
    const processingFileCount = options.model.snapshot().files
      .filter((item) => item.state === "processing").length;
    options.view.render({
      busy,
      canDownload: reference !== null
        && lookupResult !== null
        && lookupResult.selectedRowCount > 0
        && processingFileCount === 0
        && busy === null,
      error,
      headers: reference?.table.headers ?? [],
      issueCount: reference?.table.issues.length ?? 0,
      keyColumnIndex,
      matchedRowCount: lookupResult?.matchedRowCount ?? 0,
      processingFileCount,
      referenceFileName: reference?.fileName ?? null,
      resultRowCount: lookupResult?.resultRowCount ?? 0,
      selectedColumnIndices: [...selectedColumnIndices].sort((left, right) => left - right),
      selectedRowCount: lookupResult?.selectedRowCount ?? primaryRows().length,
      sheetName: reference?.table.sheetName ?? null,
      sheetNames: reference?.sheetNames ?? [],
      unmatchedRowCount: lookupResult?.unmatchedRowCount ?? 0,
    });
    options.unloadGuard.setPendingFile(reference !== null, "advanced-reference");
  }

  function applyTable(
    fileName: string,
    bytes: Uint8Array,
    sheetNames: readonly string[],
    table: HeaderedSpreadsheet,
  ): void {
    reference = { bytes, fileName, sheetNames, table };
    keyColumnIndex = defaultKeyColumn(table.headers);
    selectedColumnIndices = new Set(table.headers
      .map((_, index) => index)
      .filter((index) => index !== keyColumnIndex));
  }

  async function chooseReference(file: File): Promise<void> {
    const currentGeneration = generation + 1;
    generation = currentGeneration;
    error = null;
    busy = "reference";
    render();
    try {
      if (!/\.(?:xls|xlsx)$/iu.test(file.name)) {
        throw new Error("請選擇 XLS 或 XLSX 檔案。");
      }
      if (file.size === 0 || file.size > MAX_REFERENCE_FILE_BYTES) {
        throw new Error(file.size === 0
          ? "參照 Excel 是空的。"
          : "參照 Excel 超過 25 MB，請選擇較小的檔案。");
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const summary = await options.outputAdapter.inspect(bytes);
      const sheetName = summary.sheetNames[0];
      if (!sheetName) throw new Error("參照 Excel 不含任何工作表。");
      const table = await options.outputAdapter.parse(bytes, sheetName);
      if (generation !== currentGeneration) return;
      applyTable(file.name, bytes, summary.sheetNames, table);
      options.status.announce(`已讀取參照 Excel：${file.name}。`);
    } catch (caught) {
      if (generation !== currentGeneration) return;
      reference = null;
      selectedColumnIndices.clear();
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
    if (!reference || reference.table.sheetName === sheetName) return;
    const previous = reference;
    const currentGeneration = generation + 1;
    generation = currentGeneration;
    busy = "reference";
    error = null;
    render();
    try {
      const table = await options.outputAdapter.parse(previous.bytes, sheetName);
      if (generation !== currentGeneration) return;
      applyTable(previous.fileName, previous.bytes, previous.sheetNames, table);
      options.status.announce(`已切換到工作表：${sheetName}。`);
    } catch (caught) {
      if (generation !== currentGeneration) return;
      reference = previous;
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
    selectedColumnIndices.clear();
    error = null;
    busy = null;
    render();
    options.status.announce("參照 Excel 已從目前頁面移除；電腦中的檔案沒有變更。");
  }

  async function download(): Promise<void> {
    const lookupResult = result();
    if (!lookupResult || lookupResult.selectedRowCount === 0 || busy !== null) return;
    const requestedState = requestKey();
    busy = "download";
    error = null;
    render();
    options.status.announce("正在建立進階 XLSX。");
    try {
      const output = await options.outputAdapter.create(lookupResult);
      if (requestKey() !== requestedState) {
        error = "資料已在建立下載期間變更，請重新下載。";
        options.status.announce("資料已變更，進階下載已取消。");
        return;
      }
      options.view.save(output);
      options.status.announce(`已建立進階 XLSX，共 ${lookupResult.resultRowCount} 列。`);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "無法建立進階 XLSX。";
      options.status.announce("無法建立進階 XLSX。");
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
        onDownload: () => {
          pendingTask = download();
          void pendingTask;
        },
        onKeyColumnChange(index) {
          keyColumnIndex = index;
          error = null;
          render();
        },
        onReferenceChosen: (file) => {
          pendingTask = chooseReference(file);
          void pendingTask;
        },
        onSelectedColumnChange(index, selected) {
          if (selected) selectedColumnIndices.add(index);
          else selectedColumnIndices.delete(index);
          error = null;
          render();
        },
        onSheetChange: (sheetName) => {
          pendingTask = selectSheet(sheetName);
          void pendingTask;
        },
      });
      options.model.subscribe(() => {
        error = null;
        render();
      });
      render();
    },
    whenIdle() {
      return pendingTask;
    },
  };
}
