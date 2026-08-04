import { requireDescendant } from "../../../browser/dom";
import type { WorkspaceItem } from "../../state/workspace-types";

export interface FilePickerView {
  bind(options: {
    onChoose: () => void;
    onClear: () => void;
    onFiles: (files: readonly File[]) => void;
  }): void;
  clear(): void;
  clearMessage(): void;
  confirmClear(): boolean;
  fileInput(): HTMLInputElement;
  renderMessage(title: string, details: readonly string[], tone: "error" | "info"): void;
  renderUndo(message: string, onUndo: () => void): void;
  renderSummary(files: readonly WorkspaceItem[]): void;
  setProcessing(processing: boolean): void;
}

export function createFilePickerView(root: HTMLElement): FilePickerView {
  const sourceInput = requireDescendant<HTMLInputElement>(root, "#source-file");
  const sourcePicker = requireDescendant<HTMLElement>(root, "#source-file-picker");
  const sourceName = requireDescendant<HTMLElement>(root, "#source-file-name");
  const sourceMessage = requireDescendant<HTMLElement>(root, "#source-file-message");
  const processingIndicator = requireDescendant<HTMLElement>(root, "#file-processing-indicator");
  const selectButton = requireDescendant<HTMLButtonElement>(root, "#select-source-button");
  const clearButton = requireDescendant<HTMLButtonElement>(root, "#clear-workspace-button");

  function clearMessage(): void {
    sourceMessage.hidden = true;
    sourceMessage.replaceChildren();
    sourceMessage.removeAttribute("role");
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
      const restoreFocus = document.activeElement === clearButton;
      sourceInput.value = "";
      sourceName.textContent = "尚未加入檔案";
      sourceName.removeAttribute("title");
      sourcePicker.dataset.tone = "neutral";
      clearButton.disabled = true;
      clearMessage();
      if (restoreFocus) selectButton.focus({ preventScroll: true });
    },
    clearMessage,
    confirmClear: () => window.confirm(
      "要清空檔案清單嗎？\n\n這只會移除目前頁面中的資料，不會變更電腦中的原始檔案。",
    ),
    fileInput: () => sourceInput,
    renderMessage(title, details, tone) {
      if (tone === "error") sourcePicker.dataset.tone = "error";
      const heading = document.createElement("strong");
      heading.textContent = title;
      const list = document.createElement("ul");
      for (const detail of details) {
        const item = document.createElement("li");
        item.textContent = detail;
        list.append(item);
      }
      sourceMessage.classList.toggle("error-notice", tone === "error");
      sourceMessage.classList.toggle("info-notice", tone === "info");
      if (tone === "error") sourceMessage.setAttribute("role", "alert");
      else sourceMessage.removeAttribute("role");
      sourceMessage.replaceChildren(heading, list);
      sourceMessage.hidden = false;
    },
    renderUndo(message, onUndo) {
      const text = document.createElement("span");
      text.textContent = message;
      const button = document.createElement("button");
      button.className = "secondary-button notice-action";
      button.type = "button";
      button.textContent = "復原";
      button.addEventListener("click", () => {
        onUndo();
        text.textContent = "已復原到清單。";
        button.textContent = "已復原";
        button.disabled = true;
      }, { once: true });
      sourceMessage.classList.remove("error-notice");
      sourceMessage.classList.add("info-notice");
      sourceMessage.removeAttribute("role");
      sourceMessage.replaceChildren(text, button);
      sourceMessage.hidden = false;
    },
    renderSummary(files) {
      const processing = files.some((file) => file.state === "processing");
      const errors = files.some((file) => file.state === "error");
      const ignored = files.filter((file) => file.state === "ignored").length;
      sourceName.textContent = processing
        ? "正在處理檔案"
        : errors
          ? "有檔案需要查看"
          : ignored > 0
            ? "部分檔案未加入"
            : "檔案已加入";
      sourcePicker.dataset.tone = processing ? "info" : errors ? "error" : ignored > 0 ? "warning" : "success";
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
