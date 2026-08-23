import { downloadBlob } from "../../../browser/download";
import { requireDescendant, requireElement } from "../../../browser/dom";
import type { CreatedOutput } from "../../batch/output-artifact";
import { createStateTransition } from "../../shell/state-transition";

export interface AdvancedViewState {
  busy: "download" | "reference" | null;
  canDownload: boolean;
  error: string | null;
  fileCount: number;
  headers: readonly string[];
  issues: readonly string[];
  keyColumnIndex: number;
  referenceFileName: string | null;
  resultBusy: boolean;
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
  const referenceSpinner = requireDescendant<HTMLElement>(root, "#reference-status-spinner");
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
  const downloadStatus = requireDescendant<HTMLElement>(root, "#advanced-download-status");
  const downloadSpinner = requireDescendant<HTMLElement>(root, "#advanced-download-spinner");
  const downloadButton = requireDescendant<HTMLButtonElement>(root, "#advanced-download-button");
  const issueDisclosure = requireDescendant<HTMLDetailsElement>(root, "#advanced-issue-disclosure");
  const issueSummary = requireDescendant<HTMLElement>(root, "#advanced-issue-summary");
  const issueList = requireDescendant<HTMLUListElement>(root, "#advanced-issue-list");
  const referenceCopy = requireDescendant<HTMLElement>(picker, ".action-copy");
  const downloadCopy = requireDescendant<HTMLElement>(downloadStatus, ".action-copy");
  const referenceTransition = createStateTransition(referenceCopy);
  const downloadTransition = createStateTransition(downloadCopy);
  let renderedHeaderKey = "";

  function renderIssues(details: readonly string[]): void {
    issueDisclosure.open = false;
    issueDisclosure.hidden = details.length === 0;
    issueSummary.textContent = `查看 ${details.length.toLocaleString("zh-TW")} 個提醒`;
    issueList.replaceChildren(...details.map((detail) => {
      const item = document.createElement("li");
      item.textContent = detail;
      return item;
    }));
  }

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
    disabled: boolean,
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
        checkbox.disabled = disabled;
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
      const downloadBusy = state.busy !== null || state.resultBusy;
      const countSummary = `XLSX：${state.fileCount.toLocaleString("zh-TW")} 個檔案，已勾選 ${state.selectedRowCount.toLocaleString("zh-TW")} 列`;
      summary.textContent = `${countSummary}${hasReference && !state.resultBusy ? `，將輸出 ${state.resultRowCount.toLocaleString("zh-TW")} 列` : ""}。`;
      renderIssues([]);
      referenceSpinner.hidden = state.busy !== "reference";
      downloadStatus.toggleAttribute("aria-busy", downloadBusy);
      downloadSpinner.hidden = !downloadBusy;
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
      referenceTransition.update(state.error
        ? "error"
        : state.busy === "reference" ? "loading" : hasReference ? "ready" : "empty");

      referenceMessage.hidden = !state.error;
      referenceMessage.textContent = state.error ?? "";
      if (state.error) referenceMessage.setAttribute("role", "alert");
      else referenceMessage.removeAttribute("role");
      controls.hidden = !hasReference;
      if (!hasReference) {
        downloadButton.disabled = true;
        downloadTitle.textContent = state.busy === "reference" ? "正在準備下載" : "尚未準備下載";
        downloadDetail.textContent = state.busy === "reference"
          ? "請稍候。"
          : "請先選擇參照 Excel。";
        downloadTransition.update(state.busy === "reference" ? "reference-loading" : "empty");
        return;
      }

      renderSelectOptions(sheetSelect, state.sheetNames, state.sheetName ?? "");
      sheetControl.hidden = state.sheetNames.length <= 1;
      sheetSelect.disabled = downloadBusy;
      const headerValues = state.headers.map((_, index) => String(index));
      const headerKey = JSON.stringify(state.headers);
      if (keySelect.dataset.headers !== headerKey) {
        keySelect.replaceChildren(...state.headers.map((header, index) => option(String(index), header)));
        keySelect.dataset.headers = headerKey;
      }
      if (headerValues.includes(String(state.keyColumnIndex))) {
        keySelect.value = String(state.keyColumnIndex);
      }
      keySelect.disabled = downloadBusy;
      renderColumnOptions(
        state.headers,
        new Set(state.selectedColumnIndices),
        downloadBusy,
        (index, selected) => selectedColumnHandler?.(index, selected),
      );

      const extraRows = Math.max(0, state.resultRowCount - state.selectedRowCount);
      const issues = [
        ...state.issues,
        ...(state.unmatchedRowCount > 0
          ? [`有 ${state.unmatchedRowCount.toLocaleString("zh-TW")} 列找不到參照資料，加入的欄位會留白。`]
          : []),
        ...(extraRows > 0
          ? [`部分資料找到多筆參照內容，結果會增加 ${extraRows.toLocaleString("zh-TW")} 列。`]
          : []),
      ];
      renderIssues(issues);
      if (state.busy === "download") {
        downloadButton.disabled = true;
        downloadTitle.textContent = "正在建立下載";
        downloadDetail.textContent = "完成後會自動下載。";
        downloadTransition.update("creating");
        return;
      }
      if (state.busy === "reference") {
        downloadButton.disabled = true;
        downloadTitle.textContent = "正在準備下載";
        downloadDetail.textContent = "請稍候。";
        downloadTransition.update("reference-loading");
        return;
      }
      if (state.resultBusy) {
        downloadButton.disabled = true;
        downloadTitle.textContent = "正在準備下載";
        downloadDetail.textContent = "請稍候。";
        downloadTransition.update("result-loading");
        return;
      }
      downloadButton.disabled = !state.canDownload;
      downloadTitle.textContent = state.selectedRowCount > 0 ? "可以下載" : "尚未準備下載";
      downloadDetail.textContent = state.selectedRowCount > 0
        ? issues.length > 0 ? "請查看下列提醒，確認後再下載。" : "按「下載進階 XLSX」儲存結果。"
        : "請先在第 1 區勾選資料列。";
      downloadTransition.update(state.selectedRowCount > 0 ? "ready" : "no-selection");
    },
    save(output) {
      downloadBlob(output.blob, output.filename);
    },
  };
}
