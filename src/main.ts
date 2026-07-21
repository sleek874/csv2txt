import "./styles.css";

const PRESET_WIDTHS = [1, 2, 1, 10, 10, 8, 12, 1, 120, 15, 10, 1, 8, 8, 1] as const;
const PRESET_EXPECTED_ROWS = 200;
const STORAGE_KEY = "csv2txt.settings.v2";
const VALID_ENCODINGS = ["auto", "utf-8", "utf-16", "big5"] as const;
const VALID_ALIGNMENTS = ["left", "right"] as const;

type SourceEncoding = (typeof VALID_ENCODINGS)[number];
type Alignment = (typeof VALID_ALIGNMENTS)[number];

interface ColumnSetting {
  required: boolean;
  defaultValue: string;
  widthBytes: number;
}

interface SavedSettings {
  version: 2;
  sourceEncoding: SourceEncoding;
  alignment: Alignment;
  expectedRows: number;
  columns: ColumnSetting[];
}

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
          <input
            id="required-${index}"
            class="required-input"
            type="checkbox"
            aria-label="欄位${position}不可空白"
          />
        </td>
        <td>
          <input
            id="default-${index}"
            class="default-input"
            type="text"
            aria-label="欄位${position}空值預設"
            autocomplete="off"
            placeholder="選填"
          />
        </td>
        <td>
          <input
            id="width-${index}"
            class="width-input"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            value="${width}"
            aria-label="欄位${position}欄寬"
          />
        </td>
        <td class="number-cell cumulative-width" data-index="${index}">${cumulative}</td>
      </tr>
    `;
  }).join("");
}

const app = requireElement<HTMLElement>("#app");

app.innerHTML = `
  <div class="page-shell">
    <header class="page-header">
      <h1>CSV 轉 Big5 定長文字檔</h1>
      <p>所有資料只會在這個瀏覽器中處理，不會上傳。</p>
    </header>

    <main>
      <section class="panel" aria-labelledby="file-heading">
        <h2 id="file-heading">1. 選擇來源檔案</h2>
        <div class="file-row">
          <label class="file-label" for="source-file">CSV 檔案</label>
          <input id="source-file" type="file" accept=".csv,text/csv" />
        </div>
        <p id="file-status" class="help-text">來源資料必須是 15 欄，第一列會視為資料。</p>
      </section>

      <section class="panel" aria-labelledby="global-heading">
        <h2 id="global-heading">2. 全域設定</h2>
        <div class="global-options">
          <label class="control-group" for="source-encoding">
            <span>來源編碼</span>
            <select id="source-encoding">
              <option value="auto">自動判斷（預設）</option>
              <option value="utf-8">UTF-8</option>
              <option value="utf-16">UTF-16</option>
              <option value="big5">Big5</option>
            </select>
          </label>

          <label class="control-group" for="alignment">
            <span>全部欄位對齊方式</span>
            <select id="alignment">
              <option value="left">靠左（預設）</option>
              <option value="right">靠右</option>
            </select>
          </label>

          <label class="control-group" for="expected-rows">
            <span>預期資料筆數</span>
            <input
              id="expected-rows"
              class="expected-rows-input"
              type="number"
              min="1"
              step="1"
              inputmode="numeric"
              value="200"
            />
          </label>
        </div>
      </section>

      <section class="panel" aria-labelledby="columns-heading">
        <div class="section-heading-row">
          <div>
            <h2 id="columns-heading">3. 欄位設定</h2>
            <p class="help-text">欄寬以 Big5 位元組計算；欄位名稱不會寫入輸出檔。</p>
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
                <th colspan="4" scope="row">總寬度</th>
                <td id="total-width" class="number-cell">208</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section class="panel" aria-labelledby="preview-heading">
        <div class="section-heading-row">
          <h2 id="preview-heading">4. 驗證與預覽</h2>
          <label class="preview-option">
            <input id="show-whitespace" type="checkbox" checked />
            顯示空白字元標記
          </label>
        </div>
        <dl class="validation-summary" aria-label="驗證摘要">
          <div>
            <dt>預期筆數</dt>
            <dd id="expected-row-summary">200</dd>
          </div>
          <div>
            <dt>實際筆數</dt>
            <dd id="actual-row-summary">—</dd>
          </div>
          <div>
            <dt>正確筆數</dt>
            <dd id="valid-row-summary">—</dd>
          </div>
          <div>
            <dt>錯誤筆數</dt>
            <dd id="invalid-row-summary">—</dd>
          </div>
          <div>
            <dt>空白提醒</dt>
            <dd id="whitespace-warning-summary">—</dd>
          </div>
        </dl>

        <p class="whitespace-legend" aria-label="空白字元標記說明">
          標記說明：一般空格 <code>·</code>、全形空格 <code>□</code>、
          定位字元 <code>→</code>、換行 <code>↵</code>。標記只供預覽，不會寫入輸出檔。
        </p>

        <div class="preview-placeholder" role="region" aria-live="polite" aria-label="驗證結果">
          <strong>尚未驗證</strong>
          <span>選擇 CSV 檔案後，這裡會顯示資料列預覽及錯誤位置。</span>
        </div>

        <div class="table-scroll" tabindex="0" aria-label="驗證錯誤表格，可左右捲動">
          <table class="error-table">
            <thead>
              <tr>
                <th scope="col">資料列</th>
                <th scope="col">欄位</th>
                <th scope="col">類型</th>
                <th scope="col">問題</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colspan="4" class="empty-table-message">選擇檔案後顯示驗證結果</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="actions" aria-label="設定與轉換操作">
        <button id="save-button" class="secondary-button" type="button">儲存設定</button>
        <button id="convert-button" class="primary-button" type="button" disabled>
          轉換並下載
        </button>
      </section>

      <p id="app-status" class="app-status" role="status" aria-live="polite">
        目前為操作畫面原型，檔案轉換功能尚未完成。
      </p>
    </main>
  </div>
`;

const encodingSelect = requireElement<HTMLSelectElement>("#source-encoding");
const alignmentSelect = requireElement<HTMLSelectElement>("#alignment");
const expectedRowsInput = requireElement<HTMLInputElement>("#expected-rows");
const expectedRowSummary = requireElement<HTMLElement>("#expected-row-summary");
const totalWidth = requireElement<HTMLElement>("#total-width");
const appStatus = requireElement<HTMLElement>("#app-status");
const fileInput = requireElement<HTMLInputElement>("#source-file");
const fileStatus = requireElement<HTMLElement>("#file-status");

function widthInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(".width-input"));
}

function updateCumulativeWidths(): boolean {
  const inputs = widthInputs();
  const outputs = Array.from(document.querySelectorAll<HTMLElement>(".cumulative-width"));
  let cumulative = 0;
  let valid = true;

  inputs.forEach((input, index) => {
    const output = outputs[index];
    const width = Number(input.value);

    if (!output) {
      return;
    }

    if (!valid || !Number.isInteger(width) || width < 1) {
      valid = false;
      input.setAttribute("aria-invalid", "true");
      output.textContent = "—";
      return;
    }

    input.removeAttribute("aria-invalid");
    cumulative += width;
    output.textContent = String(cumulative);
  });

  totalWidth.textContent = valid ? String(cumulative) : "—";
  return valid;
}

function currentAlignment(): Alignment {
  return alignmentSelect.value === "right" ? "right" : "left";
}

function validateExpectedRows(): number | null {
  const expectedRows = Number(expectedRowsInput.value);
  const valid = Number.isInteger(expectedRows) && expectedRows > 0;

  if (!valid) {
    expectedRowsInput.setAttribute("aria-invalid", "true");
    expectedRowSummary.textContent = "—";
    return null;
  }

  expectedRowsInput.removeAttribute("aria-invalid");
  expectedRowSummary.textContent = String(expectedRows);
  return expectedRows;
}

function collectSettings(): SavedSettings | null {
  if (!updateCumulativeWidths()) {
    appStatus.textContent = "請將所有欄寬改為大於 0 的整數。";
    return null;
  }

  const expectedRows = validateExpectedRows();
  if (expectedRows === null) {
    appStatus.textContent = "請將預期資料筆數改為大於 0 的整數。";
    return null;
  }

  const sourceEncoding = VALID_ENCODINGS.includes(encodingSelect.value as SourceEncoding)
    ? (encodingSelect.value as SourceEncoding)
    : "auto";

  const columns = PRESET_WIDTHS.map((_, index) => ({
    required: requireElement<HTMLInputElement>(`#required-${index}`).checked,
    defaultValue: requireElement<HTMLInputElement>(`#default-${index}`).value,
    widthBytes: Number(requireElement<HTMLInputElement>(`#width-${index}`).value),
  }));

  return {
    version: 2,
    sourceEncoding,
    alignment: currentAlignment(),
    expectedRows,
    columns,
  };
}

function isSavedSettings(value: unknown): value is SavedSettings {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<SavedSettings>;
  return candidate.version === 2
    && VALID_ENCODINGS.includes(candidate.sourceEncoding as SourceEncoding)
    && VALID_ALIGNMENTS.includes(candidate.alignment as Alignment)
    && Number.isInteger(candidate.expectedRows)
    && (candidate.expectedRows ?? 0) > 0
    && Array.isArray(candidate.columns)
    && candidate.columns.length === PRESET_WIDTHS.length
    && candidate.columns.every((column) => (
      typeof column === "object"
      && column !== null
      && typeof column.required === "boolean"
      && typeof column.defaultValue === "string"
      && Number.isInteger(column.widthBytes)
      && column.widthBytes > 0
    ));
}

function applySettings(settings: SavedSettings): void {
  encodingSelect.value = settings.sourceEncoding;
  alignmentSelect.value = settings.alignment;
  expectedRowsInput.value = String(settings.expectedRows);

  settings.columns.forEach((column, index) => {
    requireElement<HTMLInputElement>(`#required-${index}`).checked = column.required;
    requireElement<HTMLInputElement>(`#default-${index}`).value = column.defaultValue;
    requireElement<HTMLInputElement>(`#width-${index}`).value = String(column.widthBytes);
  });

  updateCumulativeWidths();
  validateExpectedRows();
}

function restoreDefaults(): void {
  encodingSelect.value = "auto";
  alignmentSelect.value = "left";
  expectedRowsInput.value = String(PRESET_EXPECTED_ROWS);

  PRESET_WIDTHS.forEach((width, index) => {
    requireElement<HTMLInputElement>(`#required-${index}`).checked = false;
    requireElement<HTMLInputElement>(`#default-${index}`).value = "";
    requireElement<HTMLInputElement>(`#width-${index}`).value = String(width);
  });

  updateCumulativeWidths();
  validateExpectedRows();
}

widthInputs().forEach((input) => {
  input.addEventListener("input", updateCumulativeWidths);
});

expectedRowsInput.addEventListener("input", validateExpectedRows);

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileStatus.textContent = file
    ? `已選擇：${file.name}。檔案解析功能尚未完成。`
    : "來源資料必須是 15 欄，第一列會視為資料。";
});

requireElement<HTMLButtonElement>("#save-button").addEventListener("click", () => {
  const settings = collectSettings();
  if (!settings) {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    appStatus.textContent = "設定已儲存在這個瀏覽器中。";
  } catch {
    appStatus.textContent = "瀏覽器不允許儲存設定；目前設定只會保留到關閉頁面為止。";
  }
});

requireElement<HTMLButtonElement>("#restore-button").addEventListener("click", () => {
  restoreDefaults();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // The visible defaults still apply when persistent storage is unavailable.
  }
  appStatus.textContent = "已恢復預設設定。";
});

try {
  const savedValue = localStorage.getItem(STORAGE_KEY);
  if (savedValue) {
    const parsed: unknown = JSON.parse(savedValue);
    if (isSavedSettings(parsed)) {
      applySettings(parsed);
      appStatus.textContent = "已載入先前儲存的設定。檔案轉換功能尚未完成。";
    }
  }
} catch {
  appStatus.textContent = "無法讀取先前設定，已使用預設值。";
}
