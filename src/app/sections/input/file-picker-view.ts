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
  setHasFiles(hasFiles: boolean): void;
  setLocked(locked: boolean, visible: boolean): void;
}

export function createFilePickerView(root: HTMLElement): FilePickerView {
  const sourceInput = requireDescendant<HTMLInputElement>(root, "#source-file");
  const selectButton = requireDescendant<HTMLButtonElement>(root, "#select-source-button");
  const clearButton = requireDescendant<HTMLButtonElement>(root, "#clear-workspace-button");
  let locked = false;

  return {
    bind(options) {
      selectButton.addEventListener("click", () => { if (!locked) options.onChoose(); });
      clearButton.addEventListener("click", () => { if (!locked) options.onClear(); });
      sourceInput.addEventListener("change", () => {
        const files = Array.from(sourceInput.files ?? []);
        sourceInput.value = "";
        if (!locked && files.length > 0) options.onFiles(files);
      });
    },
    confirmClear: () => window.confirm(
      "要清空檔案清單嗎？\n\n這只會移除目前頁面中的資料，不會變更電腦中的原始檔案。",
    ),
    fileInput: () => sourceInput,
    focusChoose: () => selectButton.focus({ preventScroll: true }),
    setHasFiles(hasFiles) { clearButton.disabled = !hasFiles; },
    setLocked(nextLocked, visible) {
      locked = nextLocked;
      sourceInput.disabled = nextLocked;
      [selectButton, clearButton].forEach((button) => {
        button.setAttribute("aria-disabled", String(nextLocked));
        button.dataset.processingLocked = String(nextLocked && visible);
      });
    },
  };
}
