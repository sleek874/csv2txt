import { downloadBytes } from "../../../browser/download";
import { requireDescendant, requireElement } from "../../../browser/dom";
import type { CreatedOutput } from "../../adapters/output-adapter";

export interface AdvancedViewState {
  busy: "download" | "reference" | null;
  canDownload: boolean;
  error: string | null;
  headers: readonly string[];
  issueCount: number;
  keyColumnIndex: number;
  matchedRowCount: number;
  processingFileCount: number;
  referenceFileName: string | null;
  resultRowCount: number;
  selectedColumnIndices: readonly number[];
  selectedRowCount: number;
  sheetName: string | null;
  sheetNames: readonly string[];
  unmatchedRowCount: number;
}

export interface AdvancedView {
  bind(options: {
    onChooseReference: () => void;
    onClearReference: () => void;
    onDownload: () => void;
    onKeyColumnChange: (index: number) => void;
    onReferenceChosen: (file: File) => void;
    onSelectedColumnChange: (index: number, selected: boolean) => void;
    onSheetChange: (sheetName: string) => void;
  }): void;
  fileInput(): HTMLInputElement;
  render(state: AdvancedViewState): void;
  save(output: CreatedOutput): void;
}

function option(value: string, label = value): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

export function createAdvancedView(): AdvancedView {
  const root = requireElement<HTMLElement>("#advanced-step");
  const picker = requireDescendant<HTMLElement>(root, "#reference-file-picker");
  const fileInput = requireDescendant<HTMLInputElement>(root, "#reference-file");
  const fileName = requireDescendant<HTMLElement>(root, "#reference-file-name");
  const chooseButton = requireDescendant<HTMLButtonElement>(root, "#select-reference-button");
  const clearButton = requireDescendant<HTMLButtonElement>(root, "#clear-reference-button");
  const controls = requireDescendant<HTMLElement>(root, "#advanced-controls");
  const sheetControl = requireDescendant<HTMLElement>(root, "#reference-sheet-control");
  const sheetSelect = requireDescendant<HTMLSelectElement>(root, "#reference-sheet");
  const keySelect = requireDescendant<HTMLSelectElement>(root, "#reference-key-column");
  const columnOptions = requireDescendant<HTMLElement>(root, "#reference-column-options");
  const referenceMessage = requireDescendant<HTMLElement>(root, "#reference-message");
  const summary = requireDescendant<HTMLElement>(root, "#advanced-summary");
  const downloadTitle = requireDescendant<HTMLElement>(root, "#advanced-download-title");
  const downloadDetail = requireDescendant<HTMLElement>(root, "#advanced-download-detail");
  const downloadButton = requireDescendant<HTMLButtonElement>(root, "#advanced-download-button");
  let renderedHeaderKey = "";

  function renderSelectOptions(
    select: HTMLSelectElement,
    values: readonly string[],
    selectedValue: string,
  ): void {
    const signature = JSON.stringify(values);
    if (select.dataset.options !== signature) {
      select.replaceChildren(...values.map((value) => option(value)));
      select.dataset.options = signature;
    }
    select.value = selectedValue;
  }

  function renderColumnOptions(
    headers: readonly string[],
    selectedIndices: ReadonlySet<number>,
    onChange: (index: number, selected: boolean) => void,
  ): void {
    const headerKey = JSON.stringify(headers);
    if (renderedHeaderKey !== headerKey) {
      columnOptions.replaceChildren(...headers.map((header, index) => {
        const label = document.createElement("label");
        label.className = "advanced-column-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.columnIndex = String(index);
        checkbox.addEventListener("change", () => onChange(index, checkbox.checked));
        const text = document.createElement("span");
        text.textContent = header;
        label.append(checkbox, text);
        return label;
      }));
      renderedHeaderKey = headerKey;
    }
    columnOptions.querySelectorAll<HTMLInputElement>("input[type='checkbox']")
      .forEach((checkbox) => {
        checkbox.checked = selectedIndices.has(Number(checkbox.dataset.columnIndex));
      });
  }

  let selectedColumnHandler: ((index: number, selected: boolean) => void) | null = null;

  return {
    bind(options) {
      selectedColumnHandler = options.onSelectedColumnChange;
      chooseButton.addEventListener("click", options.onChooseReference);
      clearButton.addEventListener("click", options.onClearReference);
      downloadButton.addEventListener("click", options.onDownload);
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        fileInput.value = "";
        if (file) options.onReferenceChosen(file);
      });
      sheetSelect.addEventListener("change", () => options.onSheetChange(sheetSelect.value));
      keySelect.addEventListener("change", () => options.onKeyColumnChange(Number(keySelect.value)));
    },
    fileInput: () => fileInput,
    render(state) {
      const hasReference = state.referenceFileName !== null;
      fileName.textContent = state.busy === "reference"
        ? "正在讀取參照 Excel"
        : state.referenceFileName ?? "尚未選擇參照 Excel";
      fileName.title = state.referenceFileName ?? "";
      picker.dataset.tone = state.error
        ? "error"
        : hasReference
          ? "success"
          : state.busy === "reference"
            ? "info"
            : "neutral";
      picker.toggleAttribute("aria-busy", state.busy === "reference");
      chooseButton.disabled = state.busy !== null;
      chooseButton.textContent = hasReference ? "更換 Excel" : "選擇 Excel";
      clearButton.disabled = !hasReference || state.busy !== null;

      referenceMessage.hidden = !state.error;
      referenceMessage.textContent = state.error ?? "";
      if (state.error) referenceMessage.setAttribute("role", "alert");
      else referenceMessage.removeAttribute("role");
      controls.hidden = !hasReference;
      if (!hasReference) {
        downloadButton.disabled = true;
        downloadTitle.textContent = "尚未準備進階輸出";
        downloadDetail.textContent = state.busy === "reference"
          ? "正在讀取參照 Excel。"
          : "請先選擇一個有標題列的參照 Excel。";
        summary.textContent = `${state.selectedRowCount} 列已勾選。`;
        return;
      }

      renderSelectOptions(sheetSelect, state.sheetNames, state.sheetName ?? "");
      sheetControl.hidden = state.sheetNames.length <= 1;
      const headerValues = state.headers.map((_, index) => String(index));
      const headerKey = JSON.stringify(state.headers);
      if (keySelect.dataset.headers !== headerKey) {
        keySelect.replaceChildren(...state.headers.map((header, index) => option(String(index), header)));
        keySelect.dataset.headers = headerKey;
      }
      if (headerValues.includes(String(state.keyColumnIndex))) {
        keySelect.value = String(state.keyColumnIndex);
      }
      renderColumnOptions(
        state.headers,
        new Set(state.selectedColumnIndices),
        (index, selected) => selectedColumnHandler?.(index, selected),
      );

      const issueDetail = state.issueCount > 0 ? `；另有 ${state.issueCount} 個讀取提醒，不影響下載` : "";
      summary.textContent = `已勾選 ${state.selectedRowCount} 列；命中 ${state.matchedRowCount} 列，未命中 ${state.unmatchedRowCount} 列；將輸出 ${state.resultRowCount} 列${issueDetail}。`;
      if (state.busy === "download") {
        downloadButton.disabled = true;
        downloadTitle.textContent = "正在建立進階 XLSX";
        downloadDetail.textContent = "完成後會自動開始下載。";
        return;
      }
      if (state.processingFileCount > 0) {
        downloadButton.disabled = true;
        downloadTitle.textContent = "正在檢查來源檔案";
        downloadDetail.textContent = `尚有 ${state.processingFileCount} 個檔案，完成後會納入所有勾選列。`;
        return;
      }
      downloadButton.disabled = !state.canDownload;
      downloadTitle.textContent = state.selectedRowCount > 0 ? "可以下載" : "尚未勾選資料列";
      downloadDetail.textContent = state.selectedRowCount > 0
        ? `會逐列查詢並輸出 ${state.resultRowCount} 列；重複與未命中都不會阻止下載。`
        : "請先在第 1 區勾選至少一列資料。";
    },
    save(output) {
      downloadBytes(output.bytes, output.mimeType, output.filename);
    },
  };
}
