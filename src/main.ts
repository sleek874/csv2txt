import {
  DEFAULT_COLUMN_COUNT,
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
import {
  createCacheMaintenance,
  type CacheMaintenanceState,
} from "./browser/cache-maintenance";
import { createReloadControl, wasBrowserReload } from "./browser/reload-control";

const THEME_STORAGE_KEY = "csv2txt.theme";
const SETTINGS_STORAGE_KEY = "csv2txt.settings.v2";
const ISSUE_DISPLAY_LIMIT = 200;
const MAX_SETTINGS_FILE_BYTES = 1024 * 1024;

type Theme = "light" | "dark";
type SettingsAutoSaveState = "idle" | "pending" | "saved" | "invalid" | "unavailable";

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
    const source = manualTheme ? "自訂" : "系統";
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
        <p class="eyebrow">瀏覽器本機處理</p>
        <h1>CSV / Excel 轉 Big5 定長文字檔</h1>
        <p>先設定轉換規則，再選擇來源檔案。所有處理都在此瀏覽器完成。</p>
      </div>
      <div class="header-badges">
        <button id="theme-toggle" class="theme-toggle" type="button" role="switch" aria-checked="false">
          <span>深色模式</span>
          <span class="theme-toggle-mode">系統</span>
          <span class="theme-toggle-track" aria-hidden="true"></span>
        </button>
        <div id="offline-status" class="offline-status" role="status">正在準備離線使用…</div>
      </div>
    </header>

    <main>
      <section class="panel" aria-labelledby="profile-heading">
        <div class="step-heading">
          <span aria-hidden="true">0</span>
          <div>
            <h2 id="profile-heading">設定檔</h2>
            <p class="help-text">
              <span class="help-line">設定會自動儲存在這個瀏覽器，也可上傳、下載或恢復預設設定檔。</span>
              <span class="help-line">套用設定後，已選的來源檔案會自動重新驗證；設定檔不包含來源資料。</span>
            </p>
          </div>
        </div>

        <div class="profile-actions">
          <div class="action-explainer compact-card">
            <button id="load-settings-button" class="secondary-button" type="button">上傳設定檔</button>
            <input id="settings-file" class="visually-hidden-file" type="file" accept=".json,application/json" />
            <span>選擇本機 JSON 設定檔，檢查後套用；不會傳送到網路。</span>
          </div>
          <div class="action-explainer compact-card">
            <button id="save-settings-button" class="secondary-button" type="button">下載設定檔</button>
            <span>將目前的欄位與全域設定下載為 JSON 備份。</span>
          </div>
          <div class="action-explainer compact-card">
            <button id="load-default-button" class="secondary-button" type="button">載入預設設定</button>
            <span>套用內建的 ${DEFAULT_COLUMN_COUNT} 欄預設設定。</span>
          </div>
        </div>

        <div id="settings-status" class="profile-status" role="status" aria-live="polite">
          <span class="status-dot" aria-hidden="true"></span>
          <div><strong>目前設定：內建預設設定</strong><span>${DEFAULT_COLUMN_COUNT} 欄；修改後會自動儲存。</span></div>
        </div>
      </section>

      <section class="panel" aria-labelledby="columns-heading">
        <div class="section-heading-row">
          <div class="step-heading">
            <span aria-hidden="true">1</span>
            <div>
              <h2 id="columns-heading">欄位設定</h2>
              <p class="help-text">設定每個欄位的空值處理方式與 Big5 輸出寬度。</p>
            </div>
          </div>
          <div class="schema-summary" aria-label="目前欄位格式摘要">
            <span><strong id="field-count-summary">${DEFAULT_COLUMN_COUNT}</strong> 欄</span>
            <span><strong id="record-width-summary">208</strong> 位元組／筆</span>
          </div>
        </div>
        <div class="option-guide" aria-label="欄位選項說明">
          <div class="compact-card"><strong>不可空白</strong><span>來源值必須含有非空白字元，且不能使用空值預設。</span></div>
          <div class="compact-card"><strong>空值預設</strong><span>來源儲存格完全沒有內容時才代入；空格不算空值。</span></div>
          <div class="compact-card"><strong>欄寬</strong><span>以 Big5 位元組計算；內容過長會報錯，不會截斷。</span></div>
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

      <section class="panel" aria-labelledby="global-heading">
        <div class="step-heading">
          <span aria-hidden="true">2</span>
          <div>
            <h2 id="global-heading">全域設定</h2>
            <p class="help-text">這些選項套用到整份來源檔案及所有輸出欄位。</p>
          </div>
        </div>
        <div class="global-options">
          <label class="control-group" for="source-encoding">
            <span>來源編碼</span>
            <select id="source-encoding">
              <option value="auto">自動判斷（預設）</option>
              <option value="utf-8">UTF-8</option>
              <option value="utf-16">UTF-16</option>
              <option value="big5">Big5</option>
            </select>
            <small>僅用於 CSV。Excel 會直接讀取工作表內容；不確定時請保留自動判斷。</small>
          </label>
          <label class="control-group" for="expected-rows">
            <span>預期資料筆數</span>
            <input id="expected-rows" class="expected-rows-input" type="number"
              min="1" step="1" inputmode="numeric" value="200" />
            <small>實際資料筆數必須完全相同；第一列也算一筆資料，不視為標題。</small>
          </label>
          <label class="control-group" for="alignment">
            <span>輸出對齊方式</span>
            <select id="alignment">
              <option value="left">全部靠左（預設）</option>
              <option value="right">全部靠右</option>
            </select>
            <small>內容不足欄寬時，以半形空格補在右側或左側。</small>
          </label>
        </div>
      </section>

      <section class="panel" aria-labelledby="file-heading">
        <div class="step-heading">
          <span aria-hidden="true">3</span>
          <div>
            <h2 id="file-heading">選擇來源檔案</h2>
            <p class="help-text">選擇後會立即驗證；每筆來源資料必須正好有 <strong id="source-contract-count">${DEFAULT_COLUMN_COUNT}</strong> 欄。</p>
          </div>
        </div>
        <div class="file-picker source-file-picker">
          <div class="file-picker-actions">
            <button id="select-source-button" class="primary-button" type="button">選擇來源檔案</button>
            <input id="source-file" class="visually-hidden-file" type="file" accept=".csv,.xls,.xlsx" />
            <button id="start-over-button" class="secondary-button" type="button" disabled>清除檔案</button>
          </div>
          <div>
            <p id="file-status" class="file-status">尚未選擇檔案</p>
            <p id="encoding-status" class="help-text">支援 CSV、XLS 與 XLSX；檔案上限 25 MiB。</p>
          </div>
        </div>
      </section>

      <section class="panel" aria-labelledby="preview-heading">
        <div class="section-heading-row">
          <div class="step-heading">
            <span aria-hidden="true">4</span>
            <div>
              <h2 id="preview-heading">驗證、預覽與下載</h2>
              <p class="help-text">選檔或修改設定後會自動重新驗證；只有全部通過時才能下載 Big5 TXT。</p>
            </div>
          </div>
        </div>
        <dl class="validation-summary" aria-label="驗證摘要">
          <div><dt>預期欄數</dt><dd id="expected-column-summary">${DEFAULT_COLUMN_COUNT}</dd></div>
          <div><dt>預期筆數</dt><dd id="expected-row-summary">200</dd></div>
          <div><dt>實際筆數</dt><dd id="actual-row-summary">—</dd></div>
          <div><dt>正確筆數</dt><dd id="valid-row-summary">—</dd></div>
          <div><dt>錯誤筆數</dt><dd id="invalid-row-summary">—</dd></div>
          <div><dt>空白提醒</dt><dd id="whitespace-warning-summary">—</dd></div>
        </dl>

        <div class="subsection-heading">
          <div><h3>問題清單</h3><p>錯誤會阻止下載；提醒只協助檢查可疑空白，不會修改原始內容。</p></div>
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

        <div class="subsection-heading preview-subsection-heading">
          <div><h3>輸出預覽</h3><p>預覽會標示來源內容與補齊空格；實際欄寬仍以 Big5 位元組為準。</p></div>
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
        <p class="whitespace-legend">
          <span class="legend-line">橘底為來源空白：半形 <code>·</code>、全形 <code>□</code>、定位字元 <code>→</code>、換行 <code>↵</code>、不換行空格 <code>⍽</code>。</span>
          <span class="legend-line"><span class="padding-key">藍底圓點 <span aria-hidden="true">·</span></span>為輸出補齊空格。</span>
        </p>
        <div id="preview-results" class="preview-results" role="region" aria-live="polite" aria-label="轉換預覽">
          <div class="notice neutral-notice">
            <strong>尚未驗證</strong>
            <span>選擇 CSV 或 Excel 檔案後，這裡會顯示可輸出的資料列。</span>
          </div>
        </div>
        <div class="download-bar">
          <div><strong>輸出檔案</strong><span>驗證通過後，可下載與來源檔同名、採 Big5 編碼的 .txt 檔案。</span></div>
          <button id="convert-button" class="primary-button" type="button" disabled>下載 Big5 TXT</button>
        </div>
      </section>

      <p id="app-status" class="app-status" role="status" aria-live="polite">尚未選擇來源檔案。</p>
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
const fieldCountSummary = requireElement<HTMLElement>("#field-count-summary");
const recordWidthSummary = requireElement<HTMLElement>("#record-width-summary");
const expectedColumnSummary = requireElement<HTMLElement>("#expected-column-summary");
const sourceContractCount = requireElement<HTMLElement>("#source-contract-count");
const appStatus = requireElement<HTMLElement>("#app-status");
const settingsStatus = requireElement<HTMLElement>("#settings-status");
const settingsFileInput = requireElement<HTMLInputElement>("#settings-file");
const loadSettingsButton = requireElement<HTMLButtonElement>("#load-settings-button");
const fileInput = requireElement<HTMLInputElement>("#source-file");
const selectSourceButton = requireElement<HTMLButtonElement>("#select-source-button");
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
let settingsDisplayName = "內建預設設定";
let settingsDownloadName = "csv2txt-settings.json";
let settingsAreDirty = false;
let settingsAutoSaveState: SettingsAutoSaveState = "idle";
let settingsAutoSaveTimer: number | null = null;
type OfflineStatusState = CacheMaintenanceState | "offline";

function renderOfflineStatus(state: OfflineStatusState): void {
  const messages: Record<OfflineStatusState, string> = {
    development: "開發模式不建立離線快取",
    unsupported: "此瀏覽器不支援離線快取",
    ready: "已可離線使用",
    refreshing: "正在清除快取並取得最新版本…",
    error: "離線快取或更新失敗",
    offline: "目前離線，已保留離線版本",
  };
  offlineStatus.textContent = messages[state];
  offlineStatus.classList.toggle("offline-status-ready", state === "ready" || state === "offline");
  offlineStatus.classList.toggle("offline-status-error", state === "error");
}

const cacheMaintenance = createCacheMaintenance({
  baseUrl: import.meta.env.BASE_URL,
  cachePrefix: "csv2txt-app-",
  production: import.meta.env.PROD,
  onStateChange: renderOfflineStatus,
});
const reloadControl = createReloadControl({
  confirmMessage: "重新整理會清除目前選取的檔案與預覽，但會保留轉換設定。要繼續嗎？",
  onConfirmedReload: cacheMaintenance.refresh,
});

if (wasBrowserReload()) {
  if (navigator.onLine) {
    void reloadControl.requestReload();
  } else {
    renderOfflineStatus("offline");
  }
} else {
  void cacheMaintenance.enableOfflineUse();
}

function widthInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(".width-input"));
}

function renderSettingsStatus(detail?: string): void {
  settingsStatus.classList.toggle("profile-status-dirty", settingsAreDirty);
  settingsStatus.classList.toggle("profile-status-autosaved", settingsAreDirty && settingsAutoSaveState === "saved");
  const dot = document.createElement("span");
  dot.className = "status-dot";
  dot.setAttribute("aria-hidden", "true");
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  const stateLabels: Record<SettingsAutoSaveState, string> = {
    idle: "",
    pending: " · 正在儲存…",
    saved: " · 已儲存於此瀏覽器",
    invalid: " · 尚未儲存",
    unavailable: " · 無法自動儲存",
  };
  const stateLabel = settingsAreDirty ? stateLabels[settingsAutoSaveState] : "";
  title.textContent = `目前設定：${settingsDisplayName}${stateLabel}`;
  const description = document.createElement("span");
  description.textContent = detail ?? (settingsAreDirty
    ? settingsAutoSaveState === "saved"
      ? "變更已自動儲存；需要備份時可下載設定檔。"
      : "正在自動儲存變更。"
    : `${widthInputs().length} 欄；修改後會自動儲存。`);
  copy.append(title, description);
  settingsStatus.replaceChildren(dot, copy);
}

function persistSettingsToBrowser(settings: ConverterSettings): boolean {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

function scheduleSettingsAutoSave(): void {
  if (settingsAutoSaveTimer !== null) {
    window.clearTimeout(settingsAutoSaveTimer);
  }
  settingsAutoSaveTimer = window.setTimeout(() => {
    settingsAutoSaveTimer = null;
    const settings = collectSettings();
    if (!settings) {
      settingsAutoSaveState = "invalid";
      renderSettingsStatus("欄寬或預期筆數無效；保留上次的有效設定。");
      return;
    }
    const saved = persistSettingsToBrowser(settings);
    settingsAutoSaveState = saved ? "saved" : "unavailable";
    renderSettingsStatus(saved
      ? "變更已自動儲存於此瀏覽器。"
      : "瀏覽器不允許自動儲存；設定只會保留到關閉頁面，建議下載設定檔備份。");
  }, 250);
}

function markSettingsDirty(): void {
  if (!settingsAreDirty) {
    settingsDisplayName = "自訂設定";
  }
  settingsAutoSaveState = "pending";
  settingsAreDirty = true;
  renderSettingsStatus();
  scheduleSettingsAutoSave();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
  recordWidthSummary.textContent = valid ? String(cumulative) : "—";
  const columnCount = widthInputs().length;
  fieldCountSummary.textContent = String(columnCount);
  expectedColumnSummary.textContent = String(columnCount);
  sourceContractCount.textContent = String(columnCount);
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
    columns: widthInputs().map((_, index) => {
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
    && candidate.columns.length > 0
    && candidate.columns.every((column) => (
      typeof column === "object"
      && column !== null
      && typeof column.required === "boolean"
      && typeof column.defaultValue === "string"
      && Number.isInteger(column.widthBytes)
      && column.widthBytes > 0
    ));
}

function matchesBuiltInDefaults(settings: Readonly<ConverterSettings>): boolean {
  const defaults = createDefaultSettings();
  return settings.sourceEncoding === defaults.sourceEncoding
    && settings.alignment === defaults.alignment
    && settings.expectedRows === defaults.expectedRows
    && settings.columns.length === defaults.columns.length
    && settings.columns.every((column, index) => {
      const defaultColumn = defaults.columns[index];
      return defaultColumn !== undefined
        && column.required === defaultColumn.required
        && column.defaultValue === defaultColumn.defaultValue
        && column.widthBytes === defaultColumn.widthBytes;
    });
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

function appendPreviewValue(container: HTMLElement, value: string): void {
  if (!showWhitespaceInput.checked) {
    container.textContent = value;
    return;
  }

  const markers: Record<string, { symbol: string; label: string; wide?: boolean }> = {
    " ": { symbol: "·", label: "來源半形空格" },
    "　": { symbol: "□", label: "來源全形空格", wide: true },
    "\t": { symbol: "→", label: "來源定位字元" },
    "\r": { symbol: "↵", label: "來源換行字元" },
    "\n": { symbol: "↵", label: "來源換行字元" },
    "\u00a0": { symbol: "⍽", label: "來源不換行空格" },
  };
  let plainText = "";

  const flushPlainText = (): void => {
    if (plainText !== "") {
      container.append(document.createTextNode(plainText));
      plainText = "";
    }
  };

  for (let index = 0; index < value.length; index += 1) {
    let character = value[index] ?? "";
    if (character === "\r" && value[index + 1] === "\n") {
      character = "\r";
      index += 1;
    }
    const markerDefinition = markers[character];
    if (!markerDefinition) {
      plainText += character;
      continue;
    }

    flushPlainText();
    const marker = document.createElement("span");
    marker.className = markerDefinition.wide
      ? "source-whitespace-marker source-whitespace-marker-wide"
      : "source-whitespace-marker";
    marker.textContent = markerDefinition.symbol;
    marker.title = markerDefinition.label;
    marker.setAttribute("aria-label", markerDefinition.label);
    container.append(marker);
  }

  flushPlainText();
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
      appendPreviewValue(source, field.resolvedValue);

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
  reloadControl.setPendingFile(false);
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
  appStatus.textContent = "尚未選擇來源檔案。";
}

function loadDefaultSettings(): void {
  if (settingsAreDirty && !window.confirm("載入預設設定會取代目前設定。確定要繼續嗎？")) {
    return;
  }
  if (settingsAutoSaveTimer !== null) {
    window.clearTimeout(settingsAutoSaveTimer);
    settingsAutoSaveTimer = null;
  }
  const defaults = createDefaultSettings();
  applySettings(defaults);
  settingsDisplayName = "內建預設設定";
  settingsDownloadName = "csv2txt-settings.json";
  settingsAreDirty = false;
  const saved = persistSettingsToBrowser(defaults);
  settingsAutoSaveState = saved ? "saved" : "unavailable";
  renderSettingsStatus(saved
    ? `已套用內建 ${widthInputs().length} 欄預設，並儲存於此瀏覽器。`
    : `已套用內建 ${widthInputs().length} 欄預設；瀏覽器不允許自動儲存。`);
  if (sourceBytes) {
    parseAndValidate();
  }
  appStatus.textContent = sourceBytes ? "已套用預設設定並重新驗證來源檔案。" : "已套用預設設定。";
}

settingsFileInput.addEventListener("change", async () => {
  const file = settingsFileInput.files?.[0];
  if (!file) {
    return;
  }

  try {
    if (!/\.json$/iu.test(file.name)) {
      throw new Error("設定檔必須是 .json 檔案。");
    }
    if (file.size === 0) {
      throw new Error("設定檔是空的，無法套用。");
    }
    if (file.size > MAX_SETTINGS_FILE_BYTES) {
      throw new Error("設定檔超過 1 MiB 上限，無法套用。");
    }

    const parsed: unknown = JSON.parse(await file.text());
    if (!isSavedSettings(parsed)) {
      throw new Error("設定檔格式不正確或版本不受支援；目前設定未變更。");
    }
    if (parsed.columns.length !== widthInputs().length) {
      throw new Error(`這份設定有 ${parsed.columns.length} 欄，目前欄位編輯器為 ${widthInputs().length} 欄；目前設定未變更。`);
    }
    if (settingsAreDirty && !window.confirm("套用這份設定檔會取代目前設定。確定要繼續嗎？")) {
      return;
    }

    if (settingsAutoSaveTimer !== null) {
      window.clearTimeout(settingsAutoSaveTimer);
      settingsAutoSaveTimer = null;
    }
    applySettings(parsed);
    settingsDisplayName = file.name;
    settingsDownloadName = file.name;
    settingsAreDirty = false;
    const saved = persistSettingsToBrowser(parsed);
    settingsAutoSaveState = saved ? "saved" : "unavailable";
    renderSettingsStatus(saved
      ? `已套用 ${parsed.columns.length} 欄設定，並儲存於此瀏覽器。`
      : `已套用 ${parsed.columns.length} 欄設定；瀏覽器不允許自動儲存。`);
    if (sourceBytes) {
      parseAndValidate();
    }
    appStatus.textContent = sourceBytes
      ? `已套用 ${file.name}，並重新驗證來源檔案。`
      : `已套用 ${file.name}；請確認設定後選擇來源檔案。`;
  } catch (error) {
    const message = error instanceof SyntaxError
      ? "設定檔不是有效的 JSON；目前設定未變更。"
      : error instanceof Error ? error.message : "無法讀取設定檔；目前設定未變更。";
    renderSettingsStatus(message);
    appStatus.textContent = message;
  } finally {
    settingsFileInput.value = "";
  }
});

loadSettingsButton.addEventListener("click", () => settingsFileInput.click());
selectSourceButton.addEventListener("click", () => fileInput.click());

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
  reloadControl.setPendingFile(true);
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

encodingSelect.addEventListener("change", () => {
  markSettingsDirty();
  parseAndValidate();
});
alignmentSelect.addEventListener("change", () => {
  markSettingsDirty();
  validateAndRender();
});
expectedRowsInput.addEventListener("input", () => {
  markSettingsDirty();
  validateAndRender();
});
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

window.addEventListener("pagehide", () => {
  if (settingsAutoSaveTimer !== null) {
    window.clearTimeout(settingsAutoSaveTimer);
    settingsAutoSaveTimer = null;
  }
  const settings = collectSettings();
  if (settings) {
    persistSettingsToBrowser(settings);
  }
});

widthInputs().forEach((input) => input.addEventListener("input", () => {
  markSettingsDirty();
  validateAndRender();
}));
document.querySelectorAll<HTMLInputElement>(".required-input").forEach((input, index) => {
  input.addEventListener("change", () => {
    syncDefaultInput(index);
    markSettingsDirty();
    validateAndRender();
  });
});
document.querySelectorAll<HTMLInputElement>(".default-input").forEach((input) => {
  input.addEventListener("input", () => {
    markSettingsDirty();
    validateAndRender();
  });
});

requireElement<HTMLButtonElement>("#save-settings-button").addEventListener("click", () => {
  const settings = collectSettings();
  if (!settings) {
    const message = "無法下載設定檔：請將預期筆數與所有欄寬設為大於 0 的整數。";
    renderSettingsStatus(message);
    appStatus.textContent = message;
    return;
  }

  const json = `${JSON.stringify(settings, null, 2)}\n`;
  downloadBlob(new Blob([json], { type: "application/json;charset=utf-8" }), settingsDownloadName);
  const browserSaved = persistSettingsToBrowser(settings);
  settingsDisplayName = settingsDownloadName;
  settingsAreDirty = false;
  settingsAutoSaveState = browserSaved ? "saved" : "unavailable";
  renderSettingsStatus(browserSaved
    ? "已下載設定檔；目前設定也已儲存於此瀏覽器。"
    : "已下載設定檔；瀏覽器不允許自動儲存。JSON 備份仍可正常使用。");
  appStatus.textContent = `已下載 ${settingsDownloadName}。`;
});

requireElement<HTMLButtonElement>("#load-default-button").addEventListener("click", loadDefaultSettings);
startOverButton.addEventListener("click", clearFileState);

convertButton.addEventListener("click", () => {
  validateAndRender();
  if (!sourceFile || !lastResult?.outputBytes) {
    return;
  }

  const bytes = lastResult.outputBytes;
  const filename = sourceFile.name.replace(/\.(?:csv|xlsx?)$/iu, "") + ".txt";
  downloadBlob(new Blob([bytes.slice().buffer], { type: "text/plain" }), filename);
  appStatus.textContent = `已產生 ${filename}（Big5、${bytes.length.toLocaleString("zh-Hant-TW")} 位元組）。`;
});

function restoreSettingsAtStartup(): void {
  let storedValue: string | null;
  try {
    storedValue = localStorage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    applySettings(createDefaultSettings());
    renderSettingsStatus("目前使用內建預設設定；瀏覽器不允許自動儲存，建議下載設定檔備份。");
    return;
  }

  if (storedValue) {
    try {
      const parsed: unknown = JSON.parse(storedValue);
      if (isSavedSettings(parsed) && parsed.columns.length === widthInputs().length) {
        applySettings(parsed);
        const restoredDefaults = matchesBuiltInDefaults(parsed);
        settingsDisplayName = restoredDefaults ? "內建預設設定" : "上次的自訂設定";
        settingsAreDirty = false;
        settingsAutoSaveState = "saved";
        renderSettingsStatus(restoredDefaults
          ? `目前使用內建 ${parsed.columns.length} 欄預設。`
          : `已復原此瀏覽器中的 ${parsed.columns.length} 欄自訂設定。`);
        appStatus.textContent = restoredDefaults
          ? "目前使用內建預設設定；請選擇來源檔案。"
          : "已復原你上次的自訂設定；請確認後選擇來源檔案。";
        return;
      }
    } catch {
      // Fall through to a fresh built-in profile when stored JSON is unusable.
    }
  }

  const defaults = createDefaultSettings();
  applySettings(defaults);
  const saved = persistSettingsToBrowser(defaults);
  settingsAutoSaveState = saved ? "saved" : "unavailable";
  renderSettingsStatus(saved
    ? `目前使用內建 ${defaults.columns.length} 欄預設；後續變更會自動儲存。`
    : "目前使用內建預設設定；瀏覽器不允許自動儲存，建議下載設定檔備份。");
}

restoreSettingsAtStartup();
