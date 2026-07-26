import { renderColumnEditor } from "./app/column-editor";
import { prioritizeSourceResources } from "./app/resource-priority";
import { createResultsView } from "./app/results-view";
import { createSettingsController } from "./app/settings-controller";
import { createSpreadsheetParser } from "./app/spreadsheet-loader";
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
  ValidationIssue,
} from "./core/types";
import {
  MAX_FILE_BYTES,
  PRESET_WIDTHS,
} from "./settings/profile";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`找不到必要的畫面元件：${selector}`);
  }
  return element;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function renderNotice(
  container: HTMLElement,
  title: string,
  detail: string,
  error = false,
): void {
  const notice = document.createElement("div");
  notice.className = error ? "notice error-notice" : "notice neutral-notice";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const description = document.createElement("span");
  description.textContent = detail;
  notice.append(strong, description);
  container.replaceChildren(notice);
}

renderColumnEditor(
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
const encodingStatus = requireElement<HTMLElement>("#encoding-status");
const previewResults = requireElement<HTMLElement>("#preview-results");
const issueResults = requireElement<HTMLElement>("#issue-results");
const issueTableBody = requireElement<HTMLTableSectionElement>("#issue-table-body");
const convertButton = requireElement<HTMLButtonElement>("#convert-button");
const startOverButton = requireElement<HTMLButtonElement>("#start-over-button");
const showWhitespaceInput = requireElement<HTMLInputElement>("#show-whitespace");
const previewRowLimitSelect = requireElement<HTMLSelectElement>("#preview-row-limit");
const alignmentSelect = requireElement<HTMLSelectElement>("#alignment");
const offlineStatus = requireElement<HTMLElement>("#offline-status");

const { renderIssues, renderPreview } = createResultsView({
  alignment: () => alignmentSelect.value === "right" ? "right" : "left",
  issueTableBody,
  previewResults,
  previewRowLimitSelect,
  showWhitespaceInput,
});

function renderOfflineStatus(state: OfflineCacheState): void {
  const messages: Record<OfflineCacheState, string> = {
    development: "開發模式",
    unsupported: "無法建立離線版本",
    preparing: "正在準備離線使用…",
    ready: "已可離線使用",
    error: "無法完成離線準備",
  };
  offlineStatus.textContent = messages[state];
  offlineStatus.classList.toggle("offline-status-ready", state === "ready");
  offlineStatus.classList.toggle(
    "offline-status-error",
    state === "error" || state === "unsupported",
  );
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
  if (processing) {
    sourceFilePicker.setAttribute("aria-busy", "true");
  } else {
    sourceFilePicker.removeAttribute("aria-busy");
  }
  fileProcessingIndicator.hidden = !processing;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

const settingsController = createSettingsController({
  appStatus,
  hasSource: () => sourceBytes !== null,
  onReparse: () => void parseAndValidate(),
  onRevalidate: validateAndRender,
});

function renderParseErrors(rows: readonly string[][], errors: readonly string[]): void {
  const formatLabel = sourceFileType === "csv" ? "CSV" : "Excel";
  lastResult = null;
  convertButton.disabled = true;
  actualRowSummary.textContent = String(rows.length);
  validRowSummary.textContent = "—";
  invalidRowSummary.textContent = "—";
  warningSummary.textContent = "—";

  const issues: ValidationIssue[] = errors.map((message) => ({
    severity: "error",
    code: sourceFileType === "csv" ? "MALFORMED_CSV" : "MALFORMED_SPREADSHEET",
    message,
  }));
  renderIssues(issues);
  renderNotice(
    previewResults,
    `${formatLabel} 格式無法解析`,
    "請修正下方問題後重新選擇檔案。",
    true,
  );
  appStatus.textContent = `驗證失敗：找到 ${errors.length} 項 ${formatLabel} 格式錯誤。`;
}

function validateAndRender(): void {
  const settings = settingsController.collect();
  if (!parsedRows) {
    return;
  }
  if (parseErrorMessages.length > 0) {
    renderParseErrors(parsedRows, parseErrorMessages);
    return;
  }
  if (!settings) {
    lastResult = null;
    convertButton.disabled = true;
    appStatus.textContent = "請將預期筆數與所有欄寬設為大於 0 的整數。";
    return;
  }

  const result = convertRows(parsedRows, settings);
  lastResult = result;
  actualRowSummary.textContent = String(parsedRows.length);
  validRowSummary.textContent = String(result.validRows);
  invalidRowSummary.textContent = String(result.invalidRows);
  warningSummary.textContent = String(result.warningCount);
  convertButton.disabled = result.outputBytes === null;
  renderPreview(result);
  renderIssues(result.issues);

  const errorCount = result.issues.filter((issue) => issue.severity === "error").length;
  appStatus.textContent = result.outputBytes
    ? `驗證完成：${result.validRows} 筆資料可轉換，輸出大小 ${result.outputBytes.length.toLocaleString("zh-Hant-TW")} 位元組。`
    : `目前無法下載：找到 ${errorCount} 項錯誤與 ${result.warningCount} 項空白提醒。`;
}

async function parseAndValidate(focusErrors = false): Promise<void> {
  const settings = settingsController.collect();
  const bytes = sourceBytes;
  const fileType = sourceFileType;
  const sequence = ++parseSequence;
  if (!bytes || !fileType || !settings) {
    setSourceProcessing(false);
    return;
  }

  setSourceProcessing(true);
  if (fileType !== "csv") {
    encodingStatus.textContent = "正在載入 Excel 解析元件…";
    appStatus.textContent = "正在載入 Excel 解析元件並準備驗證…";
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
      const decoded = decodeSource(bytes, settings.sourceEncoding);
      parsed = parseCsv(decoded.text);
      encodingStatus.textContent =
        `來源編碼：${decoded.label}${decoded.ambiguous ? "。請確認預覽內容是否正確。" : "。"}`;
    } else {
      const spreadsheet = await spreadsheetParser.parse(bytes, settings.columns.length);
      if (sequence !== parseSequence) {
        return;
      }
      parsed = spreadsheet;
      encodingStatus.textContent =
        `來源格式：${fileType.toUpperCase()}；使用第一個工作表「${spreadsheet.sheetName}」的格式化顯示值。`;
    }
    if (sequence !== parseSequence) {
      return;
    }

    parsedRows = parsed.rows;
    parseErrorMessages = parsed.errors;
    if (parsed.errors.length > 0) {
      renderParseErrors(parsed.rows, parsed.errors);
      if (focusErrors) {
        issueResults.focus();
      }
    } else {
      validateAndRender();
      if (focusErrors && !lastResult?.outputBytes) {
        issueResults.focus();
      }
    }
  } catch (error) {
    if (sequence !== parseSequence) {
      return;
    }
    parsedRows = null;
    parseErrorMessages = [];
    lastResult = null;
    convertButton.disabled = true;
    actualRowSummary.textContent = "—";
    validRowSummary.textContent = "—";
    invalidRowSummary.textContent = "—";
    warningSummary.textContent = "—";
    const message = error instanceof Error ? error.message : "無法讀取來源檔案。";
    encodingStatus.textContent = message;
    renderIssues([{
      severity: "error",
      code: fileType === "csv" ? "MALFORMED_CSV" : "MALFORMED_SPREADSHEET",
      message,
    }]);
    renderNotice(
      previewResults,
      "檔案無法讀取",
      fileType === "csv"
        ? "請指定正確的來源編碼，或改選其他檔案。"
        : "請確認檔案可正常開啟且未受密碼保護，或改選其他檔案。",
      true,
    );
    appStatus.textContent = message;
    if (focusErrors) {
      issueResults.focus();
    }
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
  lastResult = null;
  setSourceProcessing(false);
  unloadGuard.setPendingFile(false);
  fileInput.value = "";
  settingsController.encodingSelect.disabled = false;
  fileStatus.textContent = "尚未選擇檔案";
  encodingStatus.textContent = "尚未判斷來源格式。";
  actualRowSummary.textContent = "—";
  validRowSummary.textContent = "—";
  invalidRowSummary.textContent = "—";
  warningSummary.textContent = "—";
  convertButton.disabled = true;
  startOverButton.disabled = true;
  renderNotice(
    previewResults,
    "尚未驗證",
    "選擇 CSV 或 Excel 檔案後，這裡會顯示可輸出的資料列。",
  );
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 4;
  cell.className = "empty-table-message";
  cell.textContent = "選擇檔案後顯示驗證結果";
  row.append(cell);
  issueTableBody.replaceChildren(row);
  appStatus.textContent = "尚未選擇來源檔案。";
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
    fileStatus.textContent = "不支援這個檔案類型；請選擇 .csv、.xls 或 .xlsx 檔案。";
    appStatus.textContent = fileStatus.textContent;
    return;
  }
  if (file.size === 0 || file.size > MAX_FILE_BYTES) {
    clearFileState();
    fileStatus.textContent = file.size === 0 ? "無法使用空檔案。" : "檔案超過 25 MiB 上限。";
    appStatus.textContent = fileStatus.textContent;
    return;
  }

  sourceFile = file;
  sourceFileType = fileType;
  unloadGuard.setPendingFile(true);
  settingsController.encodingSelect.disabled = fileType !== "csv";
  startOverButton.disabled = false;
  setSourceProcessing(true);
  fileStatus.textContent = `正在讀取 ${file.name}…`;
  appStatus.textContent = "正在讀取並驗證檔案…";

  try {
    const buffer = await file.arrayBuffer();
    if (sequence !== fileReadSequence) {
      return;
    }
    sourceBytes = new Uint8Array(buffer);
    fileStatus.textContent =
      `${file.name} · ${file.size.toLocaleString("zh-Hant-TW")} 位元組`;
    await parseAndValidate(true);
  } catch {
    if (sequence === fileReadSequence) {
      clearFileState();
      fileStatus.textContent = "瀏覽器無法讀取這個檔案。";
      appStatus.textContent = fileStatus.textContent;
    }
  }
}

fileInput.addEventListener("change", () => void handleSourceFileSelection());
selectSourceButton.addEventListener("click", () => fileInput.click());

showWhitespaceInput.addEventListener("change", () => {
  if (lastResult) {
    renderPreview(lastResult);
  }
});
previewRowLimitSelect.addEventListener("change", () => {
  if (lastResult) {
    renderPreview(lastResult);
  }
});
startOverButton.addEventListener("click", clearFileState);
convertButton.addEventListener("click", () => {
  validateAndRender();
  if (!sourceFile || !lastResult?.outputBytes) {
    return;
  }

  const bytes = lastResult.outputBytes;
  const filename = sourceFile.name.replace(/\.(?:csv|xlsx?)$/iu, "") + ".txt";
  downloadBlob(new Blob([bytes.slice().buffer], { type: "text/plain" }), filename);
  appStatus.textContent =
    `已產生 ${filename}（Big5、${bytes.length.toLocaleString("zh-Hant-TW")} 位元組）。`;
});

settingsController.bind();
settingsController.restore();
void offlineCache.prepareOfflineUse();
