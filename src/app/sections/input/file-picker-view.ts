import { requireDescendant } from "../../../browser/dom";
import type { WorkspaceItem } from "../../state/workspace-types";

export interface FilePickerView {
  bind(options: {
    onChoose: () => void;
    onClear: () => void;
    onFiles: (files: readonly File[]) => void;
  }): void;
  clear(): void;
  clearError(): void;
  fileInput(): HTMLInputElement;
  renderError(title: string, detail: string): void;
  renderSummary(files: readonly WorkspaceItem[], sourceCount: number): void;
  setProcessing(processing: boolean): void;
}

export function createFilePickerView(root: HTMLElement): FilePickerView {
  const sourceInput = requireDescendant<HTMLInputElement>(root, "#source-file");
  const sourcePicker = requireDescendant<HTMLElement>(root, "#source-file-picker");
  const sourceName = requireDescendant<HTMLElement>(root, "#source-file-name");
  const sourceMeta = requireDescendant<HTMLElement>(root, "#source-file-meta");
  const sourceError = requireDescendant<HTMLElement>(root, "#source-file-error");
  const processingIndicator = requireDescendant<HTMLElement>(root, "#file-processing-indicator");
  const selectButton = requireDescendant<HTMLButtonElement>(root, "#select-source-button");
  const clearButton = requireDescendant<HTMLButtonElement>(root, "#clear-workspace-button");

  function clearError(): void {
    sourceError.hidden = true;
    sourceError.replaceChildren();
  }

  return {
    bind(options) {
      selectButton.addEventListener("click", options.onChoose);
      clearButton.addEventListener("click", options.onClear);
      sourceInput.addEventListener("change", () => {
        const files = Array.from(sourceInput.files ?? []);
        sourceInput.value = "";
        if (files.length > 0) {
          options.onFiles(files);
        }
      });
    },
    clear() {
      sourceInput.value = "";
      sourceName.textContent = "工作區尚無檔案";
      sourceName.removeAttribute("title");
      sourceMeta.textContent = "";
      sourceMeta.hidden = true;
      sourcePicker.dataset.tone = "neutral";
      clearButton.disabled = true;
      clearError();
    },
    clearError,
    fileInput: () => sourceInput,
    renderError(title, detail) {
      sourcePicker.dataset.tone = "error";
      const heading = document.createElement("strong");
      heading.textContent = title;
      const description = document.createElement("span");
      description.textContent = detail;
      sourceError.replaceChildren(heading, description);
      sourceError.hidden = false;
    },
    renderSummary(files, sourceCount) {
      const totalBytes = files.reduce((total, file) => total + file.size, 0);
      const processing = files.some((file) => file.state === "processing");
      const errors = files.some((file) => file.state === "error");
      sourceName.textContent = sourceCount === files.length
        ? `${files.length} 個檔案`
        : `${sourceCount} 個來源，${files.length} 個檔案`;
      sourceMeta.hidden = false;
      sourceMeta.textContent = `${totalBytes.toLocaleString("zh-Hant-TW")} bytes`;
      sourcePicker.dataset.tone = processing ? "info" : errors ? "error" : "success";
      clearButton.disabled = false;
    },
    setProcessing(processing) {
      processingIndicator.hidden = !processing;
      sourcePicker.dataset.processing = String(processing);
      if (processing) {
        sourcePicker.setAttribute("aria-busy", "true");
      } else {
        sourcePicker.removeAttribute("aria-busy");
      }
    },
  };
}
