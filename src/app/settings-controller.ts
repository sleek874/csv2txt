import { downloadBlob, requireElement } from "../browser/dom";
import {
  ALIGNMENTS,
  type Alignment,
  type ConverterSettings,
} from "../core/types";
import { createDefaultSettings } from "../settings/profile";
import {
  determineSettingsKind,
  settingsEqual,
  type SettingsKind,
  type SettingsPersistenceState,
} from "../settings/state";
import { validateConverterSettings } from "../settings/validation";
import type { ColumnEditor, ColumnEditorSnapshot } from "./column-editor";

const SETTINGS_STORAGE_KEY = "csv2txt.settings.v3";
const MAX_SETTINGS_FILE_BYTES = 1024 * 1024;

interface SettingsControllerOptions {
  appStatus: HTMLElement;
  columnEditor: ColumnEditor;
  hasSource: () => boolean;
  onRevalidate: (announce: boolean) => void;
}

function setAriaInvalid(element: HTMLElement, invalid: boolean): void {
  if (invalid) {
    element.setAttribute("aria-invalid", "true");
  } else {
    element.removeAttribute("aria-invalid");
  }
}

export function createSettingsController(options: SettingsControllerOptions) {
  const removeWhitespaceSelect =
    requireElement<HTMLSelectElement>("#remove-whitespace");
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

  function renderStatus(): void {
    settingsStatus.dataset.tone = settingsKind === "invalid"
      ? "error"
      : persistenceState === "unavailable"
        ? "warning"
        : persistenceState === "pending"
          ? "info"
          : "success";

    const kindLabels: Record<SettingsKind, string> = {
      default: "預設設定",
      custom: "自訂設定",
      invalid: "無效設定",
    };
    settingsStatusTitle.textContent = kindLabels[settingsKind];

    if (settingsKind === "invalid") {
      settingsStatusDetail.textContent = "請修正標示欄位；已保留上次有效設定";
    } else if (persistenceState === "pending") {
      settingsStatusDetail.textContent = "儲存中…";
    } else if (persistenceState === "unavailable") {
      settingsStatusDetail.textContent = "無法自動儲存";
    } else {
      settingsStatusDetail.textContent = "已儲存";
    }

    const invalid = settingsKind === "invalid";
    revertValidSettingsButton.hidden = !invalid;
    saveSettingsButton.textContent = invalid ? "下載上次有效設定" : "下載設定檔";
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

  function renderColumnSummary(snapshot: ColumnEditorSnapshot): void {
    const total = snapshot.totalWidth === null ? "—" : String(snapshot.totalWidth);
    totalWidth.textContent = total;
    recordWidthSummary.textContent = total;
    const columnCount = String(options.columnEditor.columnCount);
    fieldCountSummary.textContent = columnCount;
    expectedColumnSummary.textContent = columnCount;
    sourceContractCount.textContent = columnCount;
  }

  function validateExpectedRows(): number | null {
    const expectedRows = Number(expectedRowsInput.value);
    const valid = Number.isInteger(expectedRows) && expectedRows > 0;
    setAriaInvalid(expectedRowsInput, !valid);
    expectedRowSummary.textContent = valid ? String(expectedRows) : "—";
    return valid ? expectedRows : null;
  }

  function collect(): ConverterSettings | null {
    const columnSnapshot = options.columnEditor.collect();
    renderColumnSummary(columnSnapshot);
    const expectedRows = validateExpectedRows();
    if (!columnSnapshot.columns || expectedRows === null) {
      return null;
    }

    const alignment = ALIGNMENTS.includes(alignmentSelect.value as Alignment)
      ? alignmentSelect.value as Alignment
      : "left";

    return {
      version: 3,
      removeWhitespace: removeWhitespaceSelect.value === "remove",
      alignment,
      expectedRows,
      columns: columnSnapshot.columns,
    };
  }

  function apply(settings: ConverterSettings): void {
    removeWhitespaceSelect.value = settings.removeWhitespace ? "remove" : "preserve";
    alignmentSelect.value = settings.alignment;
    expectedRowsInput.value = String(settings.expectedRows);
    options.columnEditor.apply(settings.columns);
    renderColumnSummary(options.columnEditor.collect());
    validateExpectedRows();
  }

  function applyAndPersist(settings: ConverterSettings): void {
    clearAutoSaveTimer();
    apply(settings);
    lastValidSettings = settings;
    settingsKind = determineSettingsKind(settings, builtInDefaultSettings);
    const saved = persist(settings);
    persistenceState = saved ? "synced" : "unavailable";
    if (saved) {
      lastPersistedSettings = settings;
    }
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
      && !window.confirm("要以預設設定取代目前設定嗎？")
    ) {
      return;
    }
    if (
      settingsKind === "invalid"
      && !window.confirm("要捨棄無效修改並使用預設設定嗎？")
    ) {
      return;
    }

    applyAndPersist(builtInDefaultSettings);
    settingsDownloadName = "csv2txt-settings.json";
    renderStatus();
    if (options.hasSource()) {
      options.onRevalidate(true);
    } else {
      options.appStatus.textContent = "已套用預設設定。";
    }
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
        throw new Error(`設定檔無效：${validation.reason}`);
      }
      const uploaded = validation.settings;
      if (uploaded.columns.length !== options.columnEditor.columnCount) {
        throw new Error(
          `設定檔共有 ${uploaded.columns.length} 欄，應為 ${options.columnEditor.columnCount} 欄。`,
        );
      }

      const current = updateFromScreen();
      if (
        settingsKind === "custom"
        && current !== null
        && !settingsEqual(current, uploaded)
        && !window.confirm("要以這份設定檔取代目前設定嗎？")
      ) {
        return;
      }
      if (
        settingsKind === "invalid"
        && !window.confirm("要捨棄無效修改並套用這份設定檔嗎？")
      ) {
        return;
      }

      applyAndPersist(uploaded);
      settingsDownloadName = file.name;
      renderStatus();
      if (options.hasSource()) {
        options.onRevalidate(true);
      } else {
        options.appStatus.textContent = "已套用設定檔。";
      }
    } catch (error) {
      const message = error instanceof SyntaxError
        ? "設定檔不是有效的 JSON。"
        : error instanceof Error ? error.message : "無法讀取設定檔。";
      window.alert(`無法套用設定檔\n\n${message}\n目前設定未變更。`);
    } finally {
      settingsFileInput.value = "";
    }
  }

  function bind(): void {
    loadSettingsButton.addEventListener("click", () => settingsFileInput.click());
    settingsFileInput.addEventListener("change", () => void loadSettingsFile());
    loadDefaultButton.addEventListener("click", loadDefaults);

    removeWhitespaceSelect.addEventListener("change", () => {
      updateFromScreen();
      options.onRevalidate(true);
    });
    alignmentSelect.addEventListener("change", () => {
      updateFromScreen();
      options.onRevalidate(true);
    });
    expectedRowsInput.addEventListener("input", () => {
      updateFromScreen();
      options.onRevalidate(false);
    });
    options.columnEditor.bind(() => {
      updateFromScreen();
      options.onRevalidate(false);
    });

    saveSettingsButton.addEventListener("click", () => {
      const downloadedLastValid = settingsKind === "invalid";
      const json = `${JSON.stringify(lastValidSettings, null, 2)}\n`;
      downloadBlob(
        new Blob([json], { type: "application/json;charset=utf-8" }),
        settingsDownloadName,
      );
      renderStatus();
      options.appStatus.textContent = downloadedLastValid
        ? "已下載上次有效設定。"
        : "已下載設定檔。";
    });

    revertValidSettingsButton.addEventListener("click", () => {
      apply(lastValidSettings);
      settingsKind = determineSettingsKind(lastValidSettings, builtInDefaultSettings);
      renderStatus();
      if (options.hasSource()) {
        options.onRevalidate(true);
      } else {
        options.appStatus.textContent = "已復原有效設定。";
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
      renderStatus();
      return;
    }

    if (storedValue) {
      try {
        const parsed: unknown = JSON.parse(storedValue);
        const validation = validateConverterSettings(parsed);
        if (
          validation.valid
          && validation.settings.columns.length === options.columnEditor.columnCount
        ) {
          const stored = validation.settings;
          apply(stored);
          lastValidSettings = stored;
          lastPersistedSettings = stored;
          settingsKind = determineSettingsKind(stored, builtInDefaultSettings);
          persistenceState = "synced";
          renderStatus();
          options.appStatus.textContent = settingsKind === "custom"
            ? "已復原自訂設定。"
            : "";
          return;
        }
      } catch {
        // Fall through to a fresh built-in profile when stored JSON is unusable.
      }
    }

    applyAndPersist(builtInDefaultSettings);
    renderStatus();
  }

  return {
    bind,
    collect,
    restore,
  };
}
