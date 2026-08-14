import { requireDescendant } from "../../../browser/dom";

export interface FilePickerView {
  bind(options: {
    onChoose: () => void;
    onClear: () => void;
    onFiles: (files: readonly File[]) => void;
  }): void;
  confirmClear(): boolean;
  fileInput(): HTMLInputElement;
  focusChoose(): void;
  setState(options: { addLocked: boolean; clearEnabled: boolean; processingVisible: boolean }): void;
}

export function createFilePickerView(root: HTMLElement): FilePickerView {
  const sourceInput = requireDescendant<HTMLInputElement>(root, "#source-file");
  const selectButton = requireDescendant<HTMLButtonElement>(root, "#select-source-button");
  const clearButton = requireDescendant<HTMLButtonElement>(root, "#clear-workspace-button");
  let addLocked = false;

  return {
    bind(options) {
      selectButton.addEventListener("click", () => { if (!addLocked) options.onChoose(); });
      clearButton.addEventListener("click", () => { if (!clearButton.disabled) options.onClear(); });
      sourceInput.addEventListener("change", () => {
        const files = Array.from(sourceInput.files ?? []);
        sourceInput.value = "";
        if (!addLocked && files.length > 0) options.onFiles(files);
      });
    },
    confirmClear: () => window.confirm(
      "要清空檔案清單嗎？\n\n這只會移除目前頁面中的資料，不會變更電腦中的原始檔案。",
    ),
    fileInput: () => sourceInput,
    focusChoose: () => selectButton.focus({ preventScroll: true }),
    setState(options) {
      addLocked = options.addLocked;
      sourceInput.disabled = options.addLocked;
      selectButton.setAttribute("aria-disabled", String(options.addLocked));
      selectButton.dataset.processingLocked = String(options.addLocked && options.processingVisible);
      clearButton.disabled = !options.clearEnabled;
      clearButton.setAttribute("aria-disabled", String(!options.clearEnabled));
      clearButton.dataset.processingLocked = "false";
    },
  };
}
