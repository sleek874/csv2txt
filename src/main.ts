import "./styles.css";

import {
  COLUMN_COUNT,
  MAX_FILE_BYTES,
  PRESET_WIDTHS,
  createDefaultSettings,
} from "./config/profile";
import { parseCsv } from "./core/csv";
import { decodeSource } from "./core/encoding";
import { convertRows } from "./core/fixed-width";
import { detectSourceFileType, type SourceFileType } from "./core/source";
import { parseSpreadsheet } from "./core/spreadsheet";
import {
  ALIGNMENTS,
  SOURCE_ENCODINGS,
  type Alignment,
  type ConversionResult,
  type ConverterSettings,
  type SourceEncodingPreference,
  type ValidationIssue,
} from "./core/types";

const STORAGE_KEY = "csv2txt.settings.v2";
const THEME_STORAGE_KEY = "csv2txt.theme";
const ISSUE_DISPLAY_LIMIT = 200;

type Theme = "light" | "dark";

const systemDarkTheme = window.matchMedia("(prefers-color-scheme: dark)");
let manualTheme: Theme | null = null;

try {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    manualTheme = storedTheme;
  }
} catch {
  // The in-memory toggle still works when persistent storage is unavailable.
}

function resolvedTheme(): Theme {
  return manualTheme ?? (systemDarkTheme.matches ? "dark" : "light");
}

function applyTheme(): void {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#10171c" : "#f4f7f8");

  const toggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
  if (toggle) {
    const source = manualTheme ? "手動" : "系統";
    toggle.setAttribute("aria-checked", String(theme === "dark"));
    toggle.setAttribute("aria-label", `深色模式，目前${theme === "dark" ? "開啟" : "關閉"}，${source}設定`);
    toggle.title = manualTheme
      ? `目前為${theme === "dark" ? "深色" : "淺色"}模式（手動設定）`
      : `目前為${theme === "dark" ? "深色" : "淺色"}模式（跟隨系統）`;
    const mode = toggle.querySelector<HTMLElement>(".theme-toggle-mode");
    if (mode) {
      mode.textContent = source;
    }
  }
}

applyTheme();

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`找不到必要的畫面元件：${selector}`);
  }
  return element;
}

function buildColumnRows(): string {
  let cumulative = 0;

  return PRESET_WIDTHS.map((width, index) => {
    const position = index + 1;
    cumulative += width;

    return `
      <tr>
        <th scope="row">欄位${position}</th>
        <td class="center-cell">
          <input id="required-${index}" class="required-input" type="checkbox"
            aria-label="欄位${position}不可空白" />
        </td>
        <td>
          <input id="default-${index}" class="default-input" type="text"
            aria-label="欄位${position}空值預設" autocomplete="off" placeholder="選填" />
        </td>
        <td>
          <input id="width-${index}" class="width-input" type="number" min="1"
            step="1" inputmode="numeric" value="${width}" aria-label="欄位${position}欄寬" />
        </td>
        <td class="number-cell cumulative-width">${cumulative}</td>
      </tr>
    `;
  }).join("");
}

const app = requireElement<HTMLElement>("#app");

app.innerHTML = `
  <div class="page-shell">
    <header class="page-header">
      <div>
        <p class="eyebrow">全程離線處理</p>
        <h1>CSV / Excel 轉 Big5 定長文字檔</h1>
        <p>檔案只在這個瀏覽器中讀取、驗證與轉換，不會上傳。</p>
      </div>
      <div class="header-badges">
        <button id="theme-toggle" class="theme-toggle" type="button" role="switch" aria-checked="false">
          <span>深色模式</span>
          <span class="theme-toggle-mode">系統</span>
          <span class="theme-toggle-track" aria-hidden="true"></span>
        </button>
        <div class="privacy-badge" aria-label="資料不離開裝置">資料不離開裝置</div>
        <div id="offline-status" class="offline-status" role="status">正在準備離線使用…</div>
      </div>
    </header>

    <main>
      <section class="panel" aria-labelledby="file-heading">
        <div class="step-heading">
          <span aria-hidden="true">1</span>
          <div>
            <h2 id="file-heading">選擇來源檔案</h2>
            <p class="help-text">來源必須正好有 15 欄，第一列也會視為資料。</p>
          </div>
        </div>
        <div class="file-picker">
          <label class="file-button" for="source-file">選擇來源檔案</label>
          <input id="source-file" class="visually-hidden-file" type="file" accept=".csv,.xls,.xlsx" />
          <div>
            <p id="file-status" class="file-status">尚未選擇檔案</p>
            <p id="encoding-status" class="help-text">支援 CSV、XLS 與 XLSX；檔案上限 25 MiB。</p>
          </div>
        </div>
      </section>

      <section class="panel" aria-labelledby="global-heading">
        <div class="step-heading">
          <span aria-hidden="true">2</span>
          <h2 id="global-heading">全域設定</h2>
        </div>
        <div class="global-options">
          <label class="control-group" for="source-encoding">
            <span>來源編碼（僅 CSV）</span>
            <select id="source-encoding">
              <option value="auto">自動判斷（預設）</option>
              <option value="utf-8">UTF-8</option>
              <option value="utf-16">UTF-16</option>
              <option value="big5">Big5</option>
            </select>
          </label>
          <label class="control-group" for="alignment">
            <span>全部欄位對齊</span>
            <select id="alignment">
              <option value="left">靠左（預設）</option>
              <option value="right">靠右</option>
            </select>
          </label>
          <label class="control-group" for="expected-rows">
            <span>預期資料筆數</span>
            <input id="expected-rows" class="expected-rows-input" type="number"
              min="1" step="1" inputmode="numeric" value="200" />
          </label>
        </div>
      </section>

      <section class="panel" aria-labelledby="columns-heading">
        <div class="section-heading-row">
          <div class="step-heading">
            <span aria-hidden="true">3</span>
            <div>
              <h2 id="columns-heading">欄位設定</h2>
              <p class="help-text">欄寬以 Big5 位元組計算；空值預設只套用到完全空白的儲存格。</p>
            </div>
          </div>
          <button id="restore-button" class="secondary-button" type="button">恢復預設值</button>
        </div>
        <div class="table-scroll" tabindex="0" aria-label="欄位設定表格，可左右捲動">
          <table>
            <thead>
              <tr>
                <th scope="col">欄位</th>
                <th scope="col">不可空白</th>
                <th scope="col">空值預設</th>
                <th scope="col">欄寬（位元組）</th>
                <th scope="col">累計寬度</th>
              </tr>
            </thead>
            <tbody>${buildColumnRows()}</tbody>
            <tfoot>
              <tr>
                <th colspan="4" scope="row">每筆總寬度</th>
                <td id="total-width" class="number-cell">208</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section class="panel" aria-labelledby="preview-heading">
        <div class="section-heading-row">
          <div class="step-heading">
            <span aria-hidden="true">4</span>
            <h2 id="preview-heading">驗證與預覽</h2>
          </div>
          <div class="preview-options">
            <label class="preview-row-count" for="preview-row-limit">
              <span>預覽筆數</span>
              <select id="preview-row-limit">
                <option value="all" selected>全部</option>
                <option value="20">20 筆</option>
                <option value="50">50 筆</option>
                <option value="100">100 筆</option>
                <option value="200">200 筆</option>
              </select>
            </label>
            <label class="preview-option">
              <input id="show-whitespace" type="checkbox" checked />
              顯示來源空白標記
            </label>
          </div>
        </div>
        <dl class="validation-summary" aria-label="驗證摘要">
          <div><dt>預期筆數</dt><dd id="expected-row-summary">200</dd></div>
          <div><dt>實際筆數</dt><dd id="actual-row-summary">—</dd></div>
          <div><dt>正確筆數</dt><dd id="valid-row-summary">—</dd></div>
          <div><dt>錯誤筆數</dt><dd id="invalid-row-summary">—</dd></div>
          <div><dt>空白提醒</dt><dd id="whitespace-warning-summary">—</dd></div>
        </dl>
        <p class="whitespace-legend">
          <span class="legend-line">來源標記：空格 <code>·</code>、全形空格 <code>□</code>、定位 <code>→</code>、換行 <code>↵</code>；</span>
          <span class="legend-line"><span class="padding-key">藍色圓點 <span aria-hidden="true">·</span></span>代表輸出補齊空格。實際欄寬以 Big5 位元組為準。</span>
        </p>
        <div id="preview-results" class="preview-results" role="region" aria-live="polite" aria-label="轉換預覽">
          <div class="notice neutral-notice">
            <strong>尚未驗證</strong>
            <span>選擇 CSV 或 Excel 檔案後，這裡會顯示可輸出的資料列。</span>
          </div>
        </div>
        <div class="table-scroll issue-scroll" tabindex="0" aria-label="驗證問題表格，可左右捲動">
          <table class="error-table">
            <thead>
              <tr><th scope="col">資料列</th><th scope="col">欄位</th><th scope="col">類型</th><th scope="col">問題</th></tr>
            </thead>
            <tbody id="issue-table-body">
              <tr><td colspan="4" class="empty-table-message">選擇檔案後顯示驗證結果</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="actions" aria-label="設定與轉換操作">
        <button id="start-over-button" class="text-button" type="button" disabled>清除檔案</button>
        <span class="action-spacer"></span>
        <button id="save-button" class="secondary-button" type="button">儲存設定</button>
        <button id="convert-button" class="primary-button" type="button" disabled>轉換並下載</button>
      </section>

      <p id="app-status" class="app-status" role="status" aria-live="polite">請先選擇一個 CSV、XLS 或 XLSX 檔案。</p>
    </main>
  </div>
`;

const encodingSelect = requireElement<HTMLSelectElement>("#source-encoding");
const alignmentSelect = requireElement<HTMLSelectElement>("#alignment");
const expectedRowsInput = requireElement<HTMLInputElement>("#expected-rows");
const expectedRowSummary = requireElement<HTMLElement>("#expected-row-summary");
const actualRowSummary = requireElement<HTMLElement>("#actual-row-summary");
const validRowSummary = requireElement<HTMLElement>("#valid-row-summary");
const invalidRowSummary = requireElement<HTMLElement>("#invalid-row-summary");
const warningSummary = requireElement<HTMLElement>("#whitespace-warning-summary");
const totalWidth = requireElement<HTMLElement>("#total-width");
const appStatus = requireElement<HTMLElement>("#app-status");
const fileInput = requireElement<HTMLInputElement>("#source-file");
const fileStatus = requireElement<HTMLElement>("#file-status");
const encodingStatus = requireElement<HTMLElement>("#encoding-status");
const previewResults = requireElement<HTMLElement>("#preview-results");
const issueTableBody = requireElement<HTMLTableSectionElement>("#issue-table-body");
const convertButton = requireElement<HTMLButtonElement>("#convert-button");
const startOverButton = requireElement<HTMLButtonElement>("#start-over-button");
const showWhitespaceInput = requireElement<HTMLInputElement>("#show-whitespace");
const previewRowLimitSelect = requireElement<HTMLSelectElement>("#preview-row-limit");
const offlineStatus = requireElement<HTMLElement>("#offline-status");
const themeToggle = requireElement<HTMLButtonElement>("#theme-toggle");

applyTheme();

themeToggle.addEventListener("click", () => {
  manualTheme = resolvedTheme() === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(THEME_STORAGE_KEY, manualTheme);
  } catch {
    // The selected theme remains active for this page session.
  }
  applyTheme();
});

systemDarkTheme.addEventListener("change", () => {
  if (!manualTheme) {
    applyTheme();
  }
});

let sourceFile: File | null = null;
let sourceFileType: SourceFileType | null = null;
let sourceBytes: Uint8Array | null = null;
let parsedRows: string[][] | null = null;
let parseErrorMessages: string[] = [];
let lastResult: ConversionResult | null = null;
let fileReadSequence = 0;

async function enableOfflineUse(): Promise<void> {
  if (!import.meta.env.PROD) {
    offlineStatus.textContent = "開發模式不建立離線快取";
    return;
  }

  if (!("serviceWorker" in navigator)) {
    offlineStatus.textContent = "此瀏覽器不支援離線快取";
    offlineStatus.classList.add("offline-status-error");
    return;
  }

  try {
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;
    offlineStatus.textContent = "已可離線使用";
    offlineStatus.classList.add("offline-status-ready");
  } catch {
    offlineStatus.textContent = "離線快取準備失敗";
    offlineStatus.classList.add("offline-status-error");
  }
}

void enableOfflineUse();

function widthInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(".width-input"));
}

function syncDefaultInput(index: number): void {
  const requiredInput = requireElement<HTMLInputElement>(`#required-${index}`);
  const defaultInput = requireElement<HTMLInputElement>(`#default-${index}`);
  defaultInput.disabled = requiredInput.checked;
  defaultInput.placeholder = requiredInput.checked ? "已停用" : "選填";

  if (requiredInput.checked) {
    defaultInput.value = "";
  }
}

function updateCumulativeWidths(): boolean {
  const outputs = Array.from(document.querySelectorAll<HTMLElement>(".cumulative-width"));
  let cumulative = 0;
  let valid = true;

  widthInputs().forEach((input, index) => {
    const width = Number(input.value);
    const output = outputs[index];
    const widthIsValid = Number.isInteger(width) && width >= 1;

    input.toggleAttribute("aria-invalid", !widthIsValid);
    if (!widthIsValid) {
      valid = false;
    }

    if (!valid) {
      if (output) {
        output.textContent = "—";
      }
      return;
    }

    cumulative += width;
    if (output) {
      output.textContent = String(cumulative);
    }
  });

  totalWidth.textContent = valid ? String(cumulative) : "—";
  return valid;
}

function validateExpectedRows(): number | null {
  const expectedRows = Number(expectedRowsInput.value);
  const valid = Number.isInteger(expectedRows) && expectedRows > 0;
  expectedRowsInput.toggleAttribute("aria-invalid", !valid);
  expectedRowSummary.textContent = valid ? String(expectedRows) : "—";
  return valid ? expectedRows : null;
}

function collectSettings(): ConverterSettings | null {
  const widthsAreValid = updateCumulativeWidths();
  const expectedRows = validateExpectedRows();
  if (!widthsAreValid || expectedRows === null) {
    return null;
  }

  const sourceEncoding = SOURCE_ENCODINGS.includes(encodingSelect.value as SourceEncodingPreference)
    ? encodingSelect.value as SourceEncodingPreference
    : "auto";
  const alignment = ALIGNMENTS.includes(alignmentSelect.value as Alignment)
    ? alignmentSelect.value as Alignment
    : "left";

  return {
    version: 2,
    sourceEncoding,
    alignment,
    expectedRows,
    columns: PRESET_WIDTHS.map((_, index) => {
      const required = requireElement<HTMLInputElement>(`#required-${index}`).checked;
      return {
        required,
        defaultValue: required ? "" : requireElement<HTMLInputElement>(`#default-${index}`).value,
        widthBytes: Number(requireElement<HTMLInputElement>(`#width-${index}`).value),
      };
    }),
  };
}

function isSavedSettings(value: unknown): value is ConverterSettings {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ConverterSettings>;
  return candidate.version === 2
    && SOURCE_ENCODINGS.includes(candidate.sourceEncoding as SourceEncodingPreference)
    && ALIGNMENTS.includes(candidate.alignment as Alignment)
    && Number.isInteger(candidate.expectedRows)
    && (candidate.expectedRows ?? 0) > 0
    && Array.isArray(candidate.columns)
    && candidate.columns.length === COLUMN_COUNT
    && candidate.columns.every((column) => (
      typeof column === "object"
      && column !== null
      && typeof column.required === "boolean"
      && typeof column.defaultValue === "string"
      && Number.isInteger(column.widthBytes)
      && column.widthBytes > 0
    ));
}

function applySettings(settings: ConverterSettings): void {
  encodingSelect.value = settings.sourceEncoding;
  alignmentSelect.value = settings.alignment;
  expectedRowsInput.value = String(settings.expectedRows);

  settings.columns.forEach((column, index) => {
    requireElement<HTMLInputElement>(`#required-${index}`).checked = column.required;
    requireElement<HTMLInputElement>(`#default-${index}`).value = column.defaultValue;
    requireElement<HTMLInputElement>(`#width-${index}`).value = String(column.widthBytes);
    syncDefaultInput(index);
  });

  updateCumulativeWidths();
  validateExpectedRows();
}

function markWhitespace(value: string): string {
  if (!showWhitespaceInput.checked) {
    return value;
  }

  return value
    .replaceAll(" ", "·")
    .replaceAll("　", "□")
    .replaceAll("\t", "→")
    .replaceAll("\r\n", "↵")
    .replaceAll("\r", "↵")
    .replaceAll("\n", "↵")
    .replaceAll("\u00a0", "⍽");
}

function renderPreview(result: ConversionResult): void {
  const previousScrollLeft = previewResults.querySelector<HTMLElement>(".preview-chunk")?.scrollLeft ?? 0;
  previewResults.replaceChildren();
  const allValidRows = result.rows.filter((row) => row.valid);
  const selectedLimit = previewRowLimitSelect.value === "all"
    ? allValidRows.length
    : Number(previewRowLimitSelect.value);
  const validRows = allValidRows.slice(0, selectedLimit);

  if (validRows.length === 0) {
    const notice = document.createElement("div");
    notice.className = "notice error-notice";
    const strong = document.createElement("strong");
    strong.textContent = "沒有可預覽的正確資料列";
    const detail = document.createElement("span");
    detail.textContent = "請依下方問題修正來源檔案或設定。";
    notice.append(strong, detail);
    previewResults.append(notice);
    return;
  }

  const heading = document.createElement("p");
  heading.className = "preview-heading";
  heading.textContent = validRows.length === allValidRows.length
    ? `全部 ${allValidRows.length} 筆正確資料預覽（每筆 ${result.recordWidthBytes} 位元組）`
    : `前 ${validRows.length} / ${allValidRows.length} 筆正確資料預覽（每筆 ${result.recordWidthBytes} 位元組）`;
  previewResults.append(heading);

  const previewChunk = document.createElement("div");
  previewChunk.className = "preview-chunk";
  previewChunk.tabIndex = 0;
  previewChunk.setAttribute("aria-label", "正確資料預覽，可上下及左右捲動");
  const previewChunkRows = document.createElement("div");
  previewChunkRows.className = "preview-chunk-rows";

  const columnGuide = document.createElement("div");
  columnGuide.className = "preview-column-guide";
  const columnGuideLabel = document.createElement("span");
  columnGuideLabel.className = "preview-column-guide-label";
  columnGuideLabel.textContent = "欄位";
  const columnGuideFields = document.createElement("div");
  columnGuideFields.className = "preview-column-guide-fields big5-text";

  const guideSourceFields = validRows[0]?.fields ?? [];
  guideSourceFields.forEach((field) => {
    const widthBytes = field.valueBytes + field.paddingBytes;
    const guideField = document.createElement("span");
    guideField.className = "column-guide-fragment";
    guideField.style.width = `${widthBytes}ch`;
    guideField.title = `欄位${field.fieldIndex}：欄寬 ${widthBytes} 位元組`;

    const number = document.createElement("span");
    number.className = "column-guide-number";
    number.textContent = String(field.fieldIndex);
    guideField.append(number);
    columnGuideFields.append(guideField);
  });

  columnGuide.append(columnGuideLabel, columnGuideFields);
  previewChunkRows.append(columnGuide);

  validRows.forEach((row) => {
    const record = document.createElement("div");
    record.className = "preview-record";
    const label = document.createElement("span");
    label.className = "preview-row-label";
    label.textContent = `第 ${row.sourceRow} 筆`;
    const output = document.createElement("pre");
    output.className = "big5-text";

    row.fields.forEach((field) => {
      const fieldFragment = document.createElement("span");
      fieldFragment.className = "field-fragment";
      fieldFragment.style.width = `${field.valueBytes + field.paddingBytes}ch`;

      const source = document.createElement("span");
      source.className = field.usedDefault ? "value-fragment default-fragment" : "value-fragment";
      source.style.width = `${field.valueBytes}ch`;
      source.title = field.usedDefault
        ? `欄位${field.fieldIndex}：使用空值預設，${field.valueBytes} 位元組`
        : `欄位${field.fieldIndex}：${field.valueBytes} 位元組`;
      source.textContent = markWhitespace(field.resolvedValue);

      const padding = document.createElement("span");
      padding.className = "padding-fragment";
      padding.style.width = `${field.paddingBytes}ch`;
      padding.title = `欄位${field.fieldIndex}：補 ${field.paddingBytes} 個空格`;
      padding.textContent = "·".repeat(field.paddingBytes);

      if (alignmentSelect.value === "right") {
        fieldFragment.append(padding, source);
      } else {
        fieldFragment.append(source, padding);
      }

      output.append(fieldFragment);
    });

    record.append(label, output);
    previewChunkRows.append(record);
  });

  previewChunk.append(previewChunkRows);
  previewResults.append(previewChunk);
  previewChunk.scrollLeft = previousScrollLeft;
}

function renderIssues(issues: readonly ValidationIssue[]): void {
  issueTableBody.replaceChildren();

  if (issues.length === 0) {
    const row = issueTableBody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 4;
    cell.className = "empty-table-message success-message";
    cell.textContent = "沒有發現問題，可以下載。";
    return;
  }

  issues.slice(0, ISSUE_DISPLAY_LIMIT).forEach((currentIssue) => {
    const row = issueTableBody.insertRow();
    row.className = currentIssue.severity === "error" ? "issue-error" : "issue-warning";
    row.insertCell().textContent = currentIssue.sourceRow ? String(currentIssue.sourceRow) : "—";
    row.insertCell().textContent = currentIssue.fieldIndex ? `欄位${currentIssue.fieldIndex}` : "—";
    row.insertCell().textContent = currentIssue.severity === "error" ? "錯誤" : "提醒";
    row.insertCell().textContent = currentIssue.message;
  });

  if (issues.length > ISSUE_DISPLAY_LIMIT) {
    const row = issueTableBody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 4;
    cell.className = "empty-table-message";
    cell.textContent = `另有 ${issues.length - ISSUE_DISPLAY_LIMIT} 項問題未顯示。`;
  }
}

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
  previewResults.innerHTML = `
    <div class="notice error-notice">
      <strong>${formatLabel} 格式無法解析</strong>
      <span>請修正下方問題後重新選擇檔案。</span>
    </div>
  `;
  appStatus.textContent = `驗證失敗：找到 ${errors.length} 項 ${formatLabel} 格式錯誤。`;
}

function validateAndRender(): void {
  const settings = collectSettings();

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

  const errorCount = result.issues.filter((currentIssue) => currentIssue.severity === "error").length;
  appStatus.textContent = result.outputBytes
    ? `驗證完成：${result.validRows} 筆資料可轉換，輸出大小 ${result.outputBytes.length.toLocaleString("zh-Hant-TW")} 位元組。`
    : `目前無法下載：找到 ${errorCount} 項錯誤與 ${result.warningCount} 項空白提醒。`;
}

function parseAndValidate(): void {
  const settings = collectSettings();
  if (!sourceBytes || !sourceFileType || !settings) {
    return;
  }

  try {
    let parsed: { rows: string[][]; errors: string[] };
    if (sourceFileType === "csv") {
      const decoded = decodeSource(sourceBytes, settings.sourceEncoding);
      parsed = parseCsv(decoded.text);
      encodingStatus.textContent = `來源編碼：${decoded.label}${decoded.ambiguous ? "。請確認預覽內容是否正確。" : "。"}`;
    } else {
      const spreadsheet = parseSpreadsheet(sourceBytes, settings.columns.length);
      parsed = spreadsheet;
      encodingStatus.textContent = `來源格式：${sourceFileType.toUpperCase()}；使用第一個工作表「${spreadsheet.sheetName}」的格式化顯示值。`;
    }
    parsedRows = parsed.rows;
    parseErrorMessages = parsed.errors;

    if (parsed.errors.length > 0) {
      renderParseErrors(parsed.rows, parsed.errors);
    } else {
      validateAndRender();
    }
  } catch (error) {
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
      code: sourceFileType === "csv" ? "MALFORMED_CSV" : "MALFORMED_SPREADSHEET",
      message,
    }]);
    const help = sourceFileType === "csv"
      ? "請指定正確的來源編碼，或改選其他檔案。"
      : "請確認檔案可正常開啟且未受密碼保護，或改選其他檔案。";
    previewResults.innerHTML = `<div class="notice error-notice"><strong>檔案無法讀取</strong><span>${help}</span></div>`;
    appStatus.textContent = message;
  }
}

function clearFileState(): void {
  fileReadSequence += 1;
  sourceFile = null;
  sourceFileType = null;
  sourceBytes = null;
  parsedRows = null;
  parseErrorMessages = [];
  lastResult = null;
  fileInput.value = "";
  encodingSelect.disabled = false;
  fileStatus.textContent = "尚未選擇檔案";
  encodingStatus.textContent = "支援 CSV、XLS 與 XLSX；檔案上限 25 MiB。";
  actualRowSummary.textContent = "—";
  validRowSummary.textContent = "—";
  invalidRowSummary.textContent = "—";
  warningSummary.textContent = "—";
  convertButton.disabled = true;
  startOverButton.disabled = true;
  previewResults.innerHTML = `<div class="notice neutral-notice"><strong>尚未驗證</strong><span>選擇 CSV 或 Excel 檔案後，這裡會顯示可輸出的資料列。</span></div>`;
  issueTableBody.innerHTML = `<tr><td colspan="4" class="empty-table-message">選擇檔案後顯示驗證結果</td></tr>`;
  appStatus.textContent = "請先選擇一個 CSV、XLS 或 XLSX 檔案。";
}

function restoreDefaults(): void {
  applySettings(createDefaultSettings());
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // In-memory defaults still apply when persistent storage is unavailable.
  }
  if (sourceBytes) {
    parseAndValidate();
  }
  appStatus.textContent = sourceBytes ? "已恢復預設設定並重新驗證。" : "已恢復預設設定。";
}

fileInput.addEventListener("change", async () => {
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
  encodingSelect.disabled = fileType !== "csv";
  startOverButton.disabled = false;
  fileStatus.textContent = `正在讀取 ${file.name}…`;
  appStatus.textContent = "正在讀取並驗證檔案…";

  try {
    const buffer = await file.arrayBuffer();
    if (sequence !== fileReadSequence) {
      return;
    }
    sourceBytes = new Uint8Array(buffer);
    fileStatus.textContent = `${file.name} · ${file.size.toLocaleString("zh-Hant-TW")} 位元組`;
    parseAndValidate();
  } catch {
    if (sequence === fileReadSequence) {
      clearFileState();
      fileStatus.textContent = "瀏覽器無法讀取這個檔案。";
      appStatus.textContent = fileStatus.textContent;
    }
  }
});

encodingSelect.addEventListener("change", parseAndValidate);
alignmentSelect.addEventListener("change", validateAndRender);
expectedRowsInput.addEventListener("input", validateAndRender);
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

widthInputs().forEach((input) => input.addEventListener("input", validateAndRender));
document.querySelectorAll<HTMLInputElement>(".required-input").forEach((input, index) => {
  input.addEventListener("change", () => {
    syncDefaultInput(index);
    validateAndRender();
  });
});
document.querySelectorAll<HTMLInputElement>(".default-input").forEach((input) => {
  input.addEventListener("input", validateAndRender);
});

requireElement<HTMLButtonElement>("#save-button").addEventListener("click", () => {
  const settings = collectSettings();
  if (!settings) {
    appStatus.textContent = "設定尚未儲存：請先修正無效的數字。";
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    appStatus.textContent = "設定已儲存在這個瀏覽器中；來源檔案與預覽不會被儲存。";
  } catch {
    appStatus.textContent = "瀏覽器不允許儲存設定；目前設定只會保留到關閉頁面為止。";
  }
});

requireElement<HTMLButtonElement>("#restore-button").addEventListener("click", restoreDefaults);
startOverButton.addEventListener("click", clearFileState);

convertButton.addEventListener("click", () => {
  validateAndRender();
  if (!sourceFile || !lastResult?.outputBytes) {
    return;
  }

  const bytes = lastResult.outputBytes;
  const blob = new Blob([bytes.slice().buffer], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = sourceFile.name.replace(/\.(?:csv|xlsx?)$/iu, "") + ".txt";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  appStatus.textContent = `已產生 ${link.download}（Big5、${bytes.length.toLocaleString("zh-Hant-TW")} 位元組）。`;
});

try {
  const savedValue = localStorage.getItem(STORAGE_KEY);
  if (savedValue) {
    const parsed: unknown = JSON.parse(savedValue);
    if (isSavedSettings(parsed)) {
      applySettings(parsed);
      appStatus.textContent = "已載入先前儲存的設定，請選擇 CSV、XLS 或 XLSX 檔案。";
    } else {
      appStatus.textContent = "先前設定格式無效，已使用預設值。";
    }
  }
} catch {
  appStatus.textContent = "無法讀取先前設定，已使用預設值。";
}
