import {
  createDefaultSettings,
} from "../settings/profile";
import {
  determineSettingsKind,
  settingsEqual,
  type SettingsKind,
  type SettingsPersistenceState,
} from "../settings/state";
import { validateConverterSettings } from "../settings/validation";
import {
  ALIGNMENTS,
  SOURCE_ENCODINGS,
  type Alignment,
  type ConverterSettings,
  type SourceEncodingPreference,
} from "../core/types";

const SETTINGS_STORAGE_KEY = "csv2txt.settings.v2";
const MAX_SETTINGS_FILE_BYTES = 1024 * 1024;

interface SettingsControllerOptions {
  appStatus: HTMLElement;
  hasSource: () => boolean;
  onReparse: () => void;
  onRevalidate: () => void;
}

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

function setAriaInvalid(element: HTMLElement, invalid: boolean): void {
  if (invalid) {
    element.setAttribute("aria-invalid", "true");
  } else {
    element.removeAttribute("aria-invalid");
  }
}

export function createSettingsController(options: SettingsControllerOptions) {
  const encodingSelect = requireElement<HTMLSelectElement>("#source-encoding");
  const alignmentSelect = requireElement<HTMLSelectElement>("#alignment");
  const expectedRowsInput = requireElement<HTMLInputElement>("#expected-rows");
  const expectedRowSummary = requireElement<HTMLElement>("#expected-row-summary");
  const totalWidth = requireElement<HTMLElement>("#total-width");
  const fieldCountSummary = requireElement<HTMLElement>("#field-count-summary");
  const recordWidthSummary = requireElement<HTMLElement>("#record-width-summary");
  const expectedColumnSummary = requireElement<HTMLElement>("#expected-column-summary");
  const sourceContractCount = requireElement<HTMLElement>("#source-contract-count");
  const settingsStatus = requireElement<HTMLElement>("#settings-status");
  const settingsStatusTitle = requireElement<HTMLElement>("#settings-status-title");
  const settingsStatusDetail = requireElement<HTMLElement>("#settings-status-detail");
  const settingsFileInput = requireElement<HTMLInputElement>("#settings-file");
  const loadSettingsButton = requireElement<HTMLButtonElement>("#load-settings-button");
  const saveSettingsButton = requireElement<HTMLButtonElement>("#save-settings-button");
  const saveSettingsHelp = requireElement<HTMLElement>("#save-settings-help");
  const revertValidSettingsButton =
    requireElement<HTMLButtonElement>("#revert-valid-settings-button");
  const loadDefaultButton = requireElement<HTMLButtonElement>("#load-default-button");

  const builtInDefaultSettings = createDefaultSettings();
  let settingsKind: SettingsKind = "default";
  let persistenceState: SettingsPersistenceState = "pending";
  let lastValidSettings: ConverterSettings = builtInDefaultSettings;
  let lastPersistedSettings: ConverterSettings | null = null;
  let settingsDownloadName = "csv2txt-settings.json";
  let autoSaveTimer: number | null = null;

  function widthInputs(): HTMLInputElement[] {
    return Array.from(document.querySelectorAll<HTMLInputElement>(".width-input"));
  }

  function renderStatus(detail?: string): void {
    settingsStatus.classList.toggle("profile-status-custom", settingsKind === "custom");
    settingsStatus.classList.toggle("profile-status-invalid", settingsKind === "invalid");
    settingsStatus.classList.toggle(
      "profile-status-synced",
      settingsKind !== "invalid" && persistenceState === "synced",
    );

    const kindLabels: Record<SettingsKind, string> = {
      default: "內建預設設定",
      custom: "自訂設定",
      invalid: "無效設定",
    };
    const persistenceLabels: Record<SettingsPersistenceState, string> = {
      synced: " · 已儲存於此瀏覽器",
      pending: " · 等待自動儲存…",
      unavailable: " · 無法自動儲存",
    };
    const persistenceLabel = settingsKind === "invalid"
      ? ""
      : persistenceLabels[persistenceState];
    settingsStatusTitle.textContent = `目前設定：${kindLabels[settingsKind]}${persistenceLabel}`;

    if (detail) {
      settingsStatusDetail.textContent = detail;
    } else if (settingsKind === "invalid") {
      settingsStatusDetail.textContent = persistenceState === "unavailable"
        ? "畫面上的修改未納入有效設定；上次有效設定只保留於本次頁面。下載將使用上次有效設定。"
        : "畫面上的修改未納入有效設定；已保留上次有效設定。下載將使用上次有效設定。";
    } else if (persistenceState === "pending") {
      settingsStatusDetail.textContent = "有效設定正在等待自動儲存。";
    } else if (persistenceState === "unavailable") {
      settingsStatusDetail.textContent = "有效設定只會保留到關閉頁面，建議下載設定檔備份。";
    } else if (settingsKind === "default") {
      settingsStatusDetail.textContent = `${widthInputs().length} 欄；目前與內建預設設定相同。`;
    } else {
      settingsStatusDetail.textContent = "有效設定已自動儲存；需要備份時可下載設定檔。";
    }

    const invalid = settingsKind === "invalid";
    revertValidSettingsButton.hidden = !invalid;
    saveSettingsButton.textContent = invalid ? "下載上次有效設定" : "下載設定檔";
    saveSettingsHelp.textContent = invalid
      ? "目前畫面含有無效設定；下載將使用上次有效的欄位與全域設定。"
      : "將目前的欄位與全域設定下載為 JSON 備份。";
  }

  function persist(settings: ConverterSettings): boolean {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      return true;
    } catch {
      return false;
    }
  }

  function clearAutoSaveTimer(): void {
    if (autoSaveTimer !== null) {
      window.clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
  }

  function scheduleAutoSave(): void {
    clearAutoSaveTimer();
    persistenceState = "pending";
    autoSaveTimer = window.setTimeout(() => {
      autoSaveTimer = null;
      const saved = persist(lastValidSettings);
      persistenceState = saved ? "synced" : "unavailable";
      if (saved) {
        lastPersistedSettings = lastValidSettings;
      }
      renderStatus();
    }, 250);
  }

  function syncDefaultInput(index: number): void {
    const required = requireElement<HTMLInputElement>(`#required-${index}`);
    const defaultValue = requireElement<HTMLInputElement>(`#default-${index}`);
    defaultValue.disabled = required.checked;
    defaultValue.placeholder = required.checked ? "已停用" : "選填";
    if (required.checked) {
      defaultValue.value = "";
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
      setAriaInvalid(input, !widthIsValid);
      valid &&= widthIsValid;

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
    setAriaInvalid(expectedRowsInput, !valid);
    expectedRowSummary.textContent = valid ? String(expectedRows) : "—";
    return valid ? expectedRows : null;
  }

  function collect(): ConverterSettings | null {
    const widthsAreValid = updateCumulativeWidths();
    const expectedRows = validateExpectedRows();
    if (!widthsAreValid || expectedRows === null) {
      return null;
    }

    const sourceEncoding = SOURCE_ENCODINGS.includes(
      encodingSelect.value as SourceEncodingPreference,
    )
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
          defaultValue: required
            ? ""
            : requireElement<HTMLInputElement>(`#default-${index}`).value,
          widthBytes: Number(requireElement<HTMLInputElement>(`#width-${index}`).value),
        };
      }),
    };
  }

  function apply(settings: ConverterSettings): void {
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

  function applyAndPersist(settings: ConverterSettings): boolean {
    clearAutoSaveTimer();
    apply(settings);
    lastValidSettings = settings;
    settingsKind = determineSettingsKind(settings, builtInDefaultSettings);
    const saved = persist(settings);
    persistenceState = saved ? "synced" : "unavailable";
    if (saved) {
      lastPersistedSettings = settings;
    }
    return saved;
  }

  function updateFromScreen(): ConverterSettings | null {
    const current = collect();
    settingsKind = determineSettingsKind(current, builtInDefaultSettings);
    if (!current) {
      renderStatus();
      return null;
    }

    lastValidSettings = current;
    if (
      persistenceState !== "unavailable"
      && lastPersistedSettings !== null
      && settingsEqual(current, lastPersistedSettings)
    ) {
      clearAutoSaveTimer();
      persistenceState = "synced";
    } else {
      scheduleAutoSave();
    }
    renderStatus();
    return current;
  }

  function loadDefaults(): void {
    updateFromScreen();
    if (
      settingsKind === "custom"
      && !window.confirm("載入預設設定會取代目前的自訂設定。確定要繼續嗎？")
    ) {
      return;
    }
    if (
      settingsKind === "invalid"
      && !window.confirm("目前有無效設定；載入預設設定會捨棄畫面上的修改。確定要繼續嗎？")
    ) {
      return;
    }

    const saved = applyAndPersist(builtInDefaultSettings);
    settingsDownloadName = "csv2txt-settings.json";
    renderStatus(saved
      ? `已套用內建 ${widthInputs().length} 欄預設，並儲存於此瀏覽器。`
      : `已套用內建 ${widthInputs().length} 欄預設；瀏覽器不允許自動儲存。`);
    if (options.hasSource()) {
      options.onReparse();
    }
    options.appStatus.textContent = options.hasSource()
      ? "已套用預設設定並重新驗證來源檔案。"
      : "已套用預設設定。";
  }

  async function loadSettingsFile(): Promise<void> {
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
      const validation = validateConverterSettings(parsed);
      if (!validation.valid) {
        throw new Error(`上傳的設定檔無效：${validation.reason}目前設定未變更。`);
      }
      const uploaded = validation.settings;
      if (uploaded.columns.length !== widthInputs().length) {
        throw new Error(`上傳的設定檔無效：共有 ${uploaded.columns.length} 欄，目前欄位編輯器為 ${widthInputs().length} 欄；目前設定未變更。`);
      }

      const current = updateFromScreen();
      if (
        settingsKind === "custom"
        && current !== null
        && !settingsEqual(current, uploaded)
        && !window.confirm("套用這份設定檔會取代目前的自訂設定。確定要繼續嗎？")
      ) {
        return;
      }
      if (
        settingsKind === "invalid"
        && !window.confirm("目前有無效設定；套用這份設定檔會捨棄畫面上的修改。確定要繼續嗎？")
      ) {
        return;
      }

      const saved = applyAndPersist(uploaded);
      settingsDownloadName = file.name;
      renderStatus(saved
        ? `已套用 ${uploaded.columns.length} 欄設定，並儲存於此瀏覽器。`
        : `已套用 ${uploaded.columns.length} 欄設定；瀏覽器不允許自動儲存。`);
      if (options.hasSource()) {
        options.onReparse();
      }
      options.appStatus.textContent = options.hasSource()
        ? `已套用 ${file.name}，並重新驗證來源檔案。`
        : `已套用 ${file.name}；請確認設定後選擇來源檔案。`;
    } catch (error) {
      const message = error instanceof SyntaxError
        ? "上傳的設定檔不是有效的 JSON；目前設定未變更。"
        : error instanceof Error ? error.message : "無法讀取設定檔；目前設定未變更。";
      window.alert(`無法套用設定檔\n\n${message}`);
    } finally {
      settingsFileInput.value = "";
    }
  }

  function bind(): void {
    loadSettingsButton.addEventListener("click", () => settingsFileInput.click());
    settingsFileInput.addEventListener("change", () => void loadSettingsFile());
    loadDefaultButton.addEventListener("click", loadDefaults);

    encodingSelect.addEventListener("change", () => {
      updateFromScreen();
      options.onReparse();
    });
    alignmentSelect.addEventListener("change", () => {
      updateFromScreen();
      options.onRevalidate();
    });
    expectedRowsInput.addEventListener("input", () => {
      updateFromScreen();
      options.onRevalidate();
    });
    widthInputs().forEach((input) => input.addEventListener("input", () => {
      updateFromScreen();
      options.onRevalidate();
    }));
    document.querySelectorAll<HTMLInputElement>(".required-input").forEach((input, index) => {
      input.addEventListener("change", () => {
        syncDefaultInput(index);
        updateFromScreen();
        options.onRevalidate();
      });
    });
    document.querySelectorAll<HTMLInputElement>(".default-input").forEach((input) => {
      input.addEventListener("input", () => {
        updateFromScreen();
        options.onRevalidate();
      });
    });

    saveSettingsButton.addEventListener("click", () => {
      const downloadedLastValid = settingsKind === "invalid";
      const json = `${JSON.stringify(lastValidSettings, null, 2)}\n`;
      downloadBlob(
        new Blob([json], { type: "application/json;charset=utf-8" }),
        settingsDownloadName,
      );
      renderStatus(downloadedLastValid
        ? "目前畫面含有無效設定；已下載上次有效設定，未包含畫面上的修改。"
        : "已下載目前的有效設定；下載不會變更瀏覽器自動儲存狀態。");
      options.appStatus.textContent = downloadedLastValid
        ? `已下載上次有效設定 ${settingsDownloadName}。`
        : `已下載 ${settingsDownloadName}。`;
    });

    revertValidSettingsButton.addEventListener("click", () => {
      apply(lastValidSettings);
      settingsKind = determineSettingsKind(lastValidSettings, builtInDefaultSettings);
      renderStatus("已復原上次有效設定。");
      if (options.hasSource()) {
        options.onReparse();
      } else {
        options.appStatus.textContent = "已復原上次有效設定。";
      }
    });

    window.addEventListener("pagehide", () => {
      clearAutoSaveTimer();
      persist(lastValidSettings);
    });
  }

  function restore(): void {
    let storedValue: string | null;
    try {
      storedValue = localStorage.getItem(SETTINGS_STORAGE_KEY);
    } catch {
      apply(builtInDefaultSettings);
      lastValidSettings = builtInDefaultSettings;
      lastPersistedSettings = null;
      settingsKind = "default";
      persistenceState = "unavailable";
      renderStatus("目前使用內建預設設定；瀏覽器不允許自動儲存，建議下載設定檔備份。");
      return;
    }

    if (storedValue) {
      try {
        const parsed: unknown = JSON.parse(storedValue);
        const validation = validateConverterSettings(parsed);
        if (validation.valid && validation.settings.columns.length === widthInputs().length) {
          const stored = validation.settings;
          apply(stored);
          lastValidSettings = stored;
          lastPersistedSettings = stored;
          settingsKind = determineSettingsKind(stored, builtInDefaultSettings);
          persistenceState = "synced";
          renderStatus(settingsKind === "default"
            ? `目前使用內建 ${stored.columns.length} 欄預設。`
            : `已復原此瀏覽器中的 ${stored.columns.length} 欄自訂設定。`);
          options.appStatus.textContent = settingsKind === "default"
            ? "目前使用內建預設設定；請選擇來源檔案。"
            : "已復原你上次的自訂設定；請確認後選擇來源檔案。";
          return;
        }
      } catch {
        // Fall through to a fresh built-in profile when stored JSON is unusable.
      }
    }

    const saved = applyAndPersist(builtInDefaultSettings);
    renderStatus(saved
      ? `目前使用內建 ${builtInDefaultSettings.columns.length} 欄預設；後續變更會自動儲存。`
      : "目前使用內建預設設定；瀏覽器不允許自動儲存，建議下載設定檔備份。");
  }

  return {
    bind,
    collect,
    encodingSelect,
    restore,
  };
}
