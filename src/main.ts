import { createColumnEditor } from "./app/column-editor";
import { prioritizeSourceResources } from "./app/resource-priority";
import { createResultsView } from "./app/results-view";
import { createSettingsController } from "./app/settings-controller";
import { createSpreadsheetParser } from "./app/spreadsheet-loader";
import { downloadBlob, requireElement } from "./browser/dom";
import {
  createOfflineCache,
  type OfflineCacheState,
} from "./browser/offline-cache";
import { createUnloadGuard } from "./browser/unload-guard";
import { parseCsv } from "./core/csv";
import { decodeSource } from "./core/encoding";
import { convertRows } from "./core/fixed-width";
import { detectSourceFileType, type SourceFileType } from "./core/source";
import type {
  ConversionResult,
  SourceEncodingPreference,
} from "./core/types";
import { SOURCE_ENCODINGS } from "./core/types";
import {
  MAX_FILE_BYTES,
  PRESET_WIDTHS,
} from "./settings/profile";

function renderNotice(
  container: HTMLElement,
  title: string,
  detail: string,
): void {
  const notice = document.createElement("div");
  notice.className = "notice info-notice";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const description = document.createElement("span");
  description.textContent = detail;
  notice.append(strong, description);
  container.replaceChildren(notice);
}

const columnEditor = createColumnEditor(
  requireElement<HTMLTableSectionElement>("#column-settings-body"),
  PRESET_WIDTHS,
);

const appStatus = requireElement<HTMLElement>("#app-status");
const actualRowSummary = requireElement<HTMLElement>("#actual-row-summary");
const validRowSummary = requireElement<HTMLElement>("#valid-row-summary");
const invalidRowSummary = requireElement<HTMLElement>("#invalid-row-summary");
const warningSummary = requireElement<HTMLElement>("#whitespace-warning-summary");
const fileInput = requireElement<HTMLInputElement>("#source-file");
const selectSourceButton = requireElement<HTMLButtonElement>("#select-source-button");
const sourceFilePicker = requireElement<HTMLElement>("#source-file-picker");
const fileProcessingIndicator =
  requireElement<HTMLElement>("#file-processing-indicator");
const fileStatus = requireElement<HTMLElement>("#file-status");
const fileStatusName = requireElement<HTMLElement>("#file-status-name");
const fileStatusMeta = requireElement<HTMLElement>("#file-status-meta");
const sourceEncodingSelect = requireElement<HTMLSelectElement>("#source-encoding");
const encodingStatus = requireElement<HTMLElement>("#encoding-status");
const sourceFileError = requireElement<HTMLElement>("#source-file-error");
const previewResults = requireElement<HTMLElement>("#preview-results");
const issueTableBody = requireElement<HTMLTableSectionElement>("#issue-table-body");
const convertButton = requireElement<HTMLButtonElement>("#convert-button");
const deselectSourceButton =
  requireElement<HTMLButtonElement>("#deselect-source-button");
const previewRowLimitSelect = requireElement<HTMLSelectElement>("#preview-row-limit");
const alignmentSelect = requireElement<HTMLSelectElement>("#alignment");
const readinessStatus = requireElement<HTMLElement>("#readiness-status");
const readinessText =
  requireElement<HTMLElement>("#readiness-status .readiness-status__text");

const { renderIssues, renderPreview } = createResultsView({
  alignment: () => alignmentSelect.value === "right" ? "right" : "left",
  issueTableBody,
  previewResults,
  previewRowLimitSelect,
});

function renderOfflineStatus(state: OfflineCacheState): void {
  const presentations: Record<
    OfflineCacheState,
    { state: string; text: string }
  > = {
    development: { state: "development", text: "開發模式" },
    unsupported: { state: "limited", text: "需連線使用" },
    preparing: { state: "offline", text: "準備離線使用" },
    ready: { state: "ready", text: "已可離線使用" },
    error: { state: "limited", text: "需連線使用" },
  };
  const presentation = presentations[state];
  readinessStatus.dataset.state = presentation.state;
  readinessText.textContent = presentation.text;
}

const offlineCache = createOfflineCache({
  baseUrl: import.meta.env.BASE_URL,
  production: import.meta.env.PROD,
  onStateChange: renderOfflineStatus,
});
const unloadGuard = createUnloadGuard();
const spreadsheetParser = createSpreadsheetParser();

let sourceFile: File | null = null;
let sourceFileType: SourceFileType | null = null;
let sourceBytes: Uint8Array | null = null;
let parsedRows: string[][] | null = null;
let parseErrorMessages: string[] = [];
let lastResult: ConversionResult | null = null;
let fileReadSequence = 0;
let parseSequence = 0;

function setSourceProcessing(processing: boolean): void {
  sourceFilePicker.dataset.processing = String(processing);
  if (processing) {
    sourceFilePicker.setAttribute("aria-busy", "true");
  } else {
    sourceFilePicker.removeAttribute("aria-busy");
  }
  fileProcessingIndicator.hidden = !processing;
}

function renderFileStatus(
  name: string,
  options: { meta?: string; title?: string } = {},
): void {
  const meta = options.meta ?? "";
  fileStatusName.textContent = name;
  fileStatusMeta.textContent = meta;
  fileStatusMeta.hidden = meta.length === 0;
  if (options.title) {
    fileStatus.title = options.title;
  } else {
    fileStatus.removeAttribute("title");
  }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

const settingsController = createSettingsController({
  appStatus,
  columnEditor,
  hasSource: () => sourceBytes !== null,
  onRevalidate: validateAndRender,
});

function sourceEncoding(): SourceEncodingPreference {
  return SOURCE_ENCODINGS.includes(sourceEncodingSelect.value as SourceEncodingPreference)
    ? sourceEncodingSelect.value as SourceEncodingPreference
    : "auto";
}

function clearSourceError(): void {
  sourceFileError.hidden = true;
  sourceFileError.replaceChildren();
}

function renderSourceError(title: string, details: string | readonly string[]): void {
  sourceFilePicker.dataset.tone = "error";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const messages = typeof details === "string" ? [details] : details;

  if (messages.length === 1) {
    const description = document.createElement("span");
    description.textContent = messages[0] ?? "";
    sourceFileError.replaceChildren(strong, description);
  } else {
    const list = document.createElement("ul");
    messages.forEach((message) => {
      const item = document.createElement("li");
      item.textContent = message;
      list.append(item);
    });
    sourceFileError.replaceChildren(strong, list);
  }

  sourceFileError.hidden = false;
  appStatus.textContent = "";
}

function resetValidationView(detail: string): void {
  lastResult = null;
  convertButton.disabled = true;
  actualRowSummary.textContent = "—";
  validRowSummary.textContent = "—";
  invalidRowSummary.textContent = "—";
  warningSummary.textContent = "—";
  validRowSummary.removeAttribute("data-tone");
  invalidRowSummary.removeAttribute("data-tone");
  warningSummary.removeAttribute("data-tone");
  renderNotice(previewResults, "尚未驗證", detail);
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 4;
  cell.className = "empty-table-message";
  cell.textContent = "尚未驗證";
  row.append(cell);
  issueTableBody.replaceChildren(row);
}

function renderParseErrors(errors: readonly string[]): void {
  const formatLabel = sourceFileType === "csv" ? "CSV" : "Excel";
  resetValidationView("成功讀取來源檔案後顯示。");
  renderSourceError(`${formatLabel} 格式錯誤`, errors);
}

function validateAndRender(announce = true): void {
  appStatus.textContent = "";
  const settings = settingsController.collect();
  if (!parsedRows) {
    return;
  }
  if (parseErrorMessages.length > 0) {
    return;
  }
  if (!settings) {
    lastResult = null;
    convertButton.disabled = true;
    sourceFilePicker.dataset.tone = "warning";
    if (announce) {
      appStatus.textContent = "請修正標示的預期筆數或欄寬。";
    }
    return;
  }

  const result = convertRows(parsedRows, settings);
  lastResult = result;
  actualRowSummary.textContent = String(parsedRows.length);
  validRowSummary.textContent = String(result.validRows);
  invalidRowSummary.textContent = String(result.invalidRows);
  warningSummary.textContent = String(result.warningCount);
  validRowSummary.dataset.tone = result.validRows > 0 ? "success" : "neutral";
  invalidRowSummary.dataset.tone = result.invalidRows > 0 ? "error" : "success";
  warningSummary.dataset.tone = result.warningCount > 0 ? "warning" : "success";
  sourceFilePicker.dataset.tone = result.outputBytes ? "success" : "warning";
  convertButton.disabled = result.outputBytes === null;
  renderPreview(result);
  renderIssues(result.issues);

  const errorCount = result.issues.filter((issue) => issue.severity === "error").length;
  if (announce) {
    appStatus.textContent = result.outputBytes
      ? "驗證完成，可以下載。"
      : `驗證未通過，共 ${errorCount} 項錯誤。`;
  }
}

async function parseAndValidate(): Promise<void> {
  const bytes = sourceBytes;
  const fileType = sourceFileType;
  const sequence = ++parseSequence;
  if (!bytes || !fileType) {
    setSourceProcessing(false);
    return;
  }

  clearSourceError();
  setSourceProcessing(true);
  if (fileType !== "csv") {
    encodingStatus.textContent = "正在載入 Excel…";
    appStatus.textContent = "正在載入 Excel…";
  }

  try {
    const resourcePriority = prioritizeSourceResources(fileType, {
      prepareExcel: spreadsheetParser.prepare,
      prepareFont: offlineCache.prioritizePreviewFont,
    });
    void resourcePriority.fullyPrepared.catch(() => {
      // Parsing reports Excel load failures; the preview keeps its fallback font.
    });
    if (fileType !== "csv") {
      await yieldToBrowser();
    }
    await resourcePriority.readyForParsing;
    if (sequence !== parseSequence) {
      return;
    }

    let parsed: { rows: string[][]; errors: string[] };
    if (fileType === "csv") {
      const decoded = decodeSource(bytes, sourceEncoding());
      parsed = parseCsv(decoded.text);
      encodingStatus.textContent = decoded.ambiguous
        ? `${decoded.label} · 請確認預覽`
        : decoded.label;
    } else {
      const spreadsheet = await spreadsheetParser.parse(
        bytes,
        columnEditor.columnCount,
      );
      if (sequence !== parseSequence) {
        return;
      }
      parsed = spreadsheet;
      encodingStatus.textContent =
        `${fileType.toUpperCase()} · 工作表「${spreadsheet.sheetName}」`;
    }
    encodingStatus.title = encodingStatus.textContent;
    if (sequence !== parseSequence) {
      return;
    }

    parsedRows = parsed.rows;
    parseErrorMessages = parsed.errors;
    if (parsed.errors.length > 0) {
      renderParseErrors(parsed.errors);
    } else {
      validateAndRender();
    }
  } catch (error) {
    if (sequence !== parseSequence) {
      return;
    }
    parsedRows = null;
    parseErrorMessages = [];
    const message = error instanceof Error ? error.message : "無法讀取來源檔案。";
    encodingStatus.textContent = "無法判斷";
    resetValidationView("成功讀取來源檔案後顯示。");
    renderSourceError(
      "無法處理檔案",
      fileType === "csv"
        ? `${message} 請確認來源編碼或改選檔案。`
        : `${message} 請確認檔案未損毀或加密。`,
    );
  } finally {
    if (sequence === parseSequence) {
      setSourceProcessing(false);
    }
  }
}

function clearFileState(): void {
  fileReadSequence += 1;
  parseSequence += 1;
  sourceFile = null;
  sourceFileType = null;
  sourceBytes = null;
  parsedRows = null;
  parseErrorMessages = [];
  setSourceProcessing(false);
  unloadGuard.setPendingFile(false);
  fileInput.value = "";
  sourceEncodingSelect.disabled = true;
  renderFileStatus("尚未選擇檔案");
  sourceFilePicker.dataset.tone = "neutral";
  encodingStatus.textContent = "尚未判斷";
  encodingStatus.removeAttribute("title");
  deselectSourceButton.disabled = true;
  clearSourceError();
  resetValidationView("選擇來源檔案。");
  appStatus.textContent = "";
}

async function handleSourceFileSelection(): Promise<void> {
  const file = fileInput.files?.[0];
  const sequence = ++fileReadSequence;
  if (!file) {
    clearFileState();
    return;
  }

  const fileType = detectSourceFileType(file.name);
  if (!fileType) {
    clearFileState();
    renderSourceError(
      "不支援此檔案類型",
      "請選擇副檔名為 .csv、.xls 或 .xlsx 的檔案。",
    );
    return;
  }
  if (file.size === 0 || file.size > MAX_FILE_BYTES) {
    clearFileState();
    if (file.size === 0) {
      renderSourceError("檔案沒有內容", "請選擇含有資料的檔案。");
    } else {
      renderSourceError("檔案超過大小上限", "請選擇 25 MiB 以下的檔案。");
    }
    return;
  }

  clearSourceError();
  sourceFile = file;
  sourceFileType = fileType;
  unloadGuard.setPendingFile(true);
  sourceEncodingSelect.disabled = fileType !== "csv";
  deselectSourceButton.disabled = false;
  setSourceProcessing(true);
  sourceFilePicker.dataset.tone = "info";
  renderFileStatus(file.name, {
    meta: "正在讀取檔案…",
    title: file.name,
  });
  appStatus.textContent = "正在驗證檔案…";

  try {
    const buffer = await file.arrayBuffer();
    if (sequence !== fileReadSequence) {
      return;
    }
    sourceBytes = new Uint8Array(buffer);
    const fileSize = `${file.size.toLocaleString("zh-Hant-TW")} 位元組`;
    renderFileStatus(file.name, {
      meta: fileSize,
      title: `${file.name} · ${fileSize}`,
    });
    await parseAndValidate();
  } catch {
    if (sequence === fileReadSequence) {
      clearFileState();
      renderSourceError("無法存取檔案", "請確認檔案仍可使用，或改選其他檔案。");
    }
  }
}

fileInput.addEventListener("change", () => void handleSourceFileSelection());
selectSourceButton.addEventListener("click", () => fileInput.click());

sourceEncodingSelect.addEventListener("change", () => {
  if (sourceFileType === "csv") {
    void parseAndValidate();
  }
});
previewRowLimitSelect.addEventListener("change", () => {
  if (lastResult) {
    renderPreview(lastResult);
  }
});
deselectSourceButton.addEventListener("click", clearFileState);
convertButton.addEventListener("click", () => {
  validateAndRender();
  if (!sourceFile || !lastResult?.outputBytes) {
    return;
  }

  const bytes = lastResult.outputBytes;
  const filename = sourceFile.name.replace(/\.(?:csv|xlsx?)$/iu, "") + ".txt";
  downloadBlob(new Blob([bytes.slice().buffer], { type: "text/plain" }), filename);
  appStatus.textContent = "已建立下載。";
});

settingsController.bind();
settingsController.restore();
void offlineCache.prepareOfflineUse();
