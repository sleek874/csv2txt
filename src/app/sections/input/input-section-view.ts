import { requireDescendant, requireElement } from "../../../browser/dom";
import { validateOutput } from "../../../core/output-validation";
import type { WorkspaceSnapshot } from "../../state/workspace-types";
import { createDataPreviewView } from "./data-preview-view";
import { createFilePickerView } from "./file-picker-view";
import { createFileTreeView, type InventoryFilter } from "./file-tree-view";

export interface InputSectionView {
  bind(options: {
    onChooseFile: () => void;
    onClearWorkspace: () => void;
    onFilesChosen: (files: readonly File[]) => void;
    onMarkAllViewed: () => void;
    onRemoveFile: (fileId: string) => void;
    onRemoveSource: (sourceId: string) => void;
    onVisibleRowsIncludedChange: (sourceRows: readonly number[], included: boolean) => void;
    onRowIncludedChange: (sourceRow: number, included: boolean) => void;
    onSelectFile: (fileId: string) => void;
  }): void;
  clear(): void;
  clearMessage(): void;
  confirmClear(): boolean;
  fileInput(): HTMLInputElement;
  render(snapshot: WorkspaceSnapshot, pendingArchives: number): void;
  renderMessage(title: string, details: readonly string[], tone: "error" | "info"): void;
  renderUndo(message: string, onUndo: () => void): void;
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function createInputSectionView(): InputSectionView {
  const root = requireElement<HTMLElement>("#input-step");
  const dataRoot = requireDescendant<HTMLElement>(root, "#data-workspace");
  const selectionMessage = requireDescendant<HTMLElement>(root, "#selection-message");
  const previewName = requireDescendant<HTMLElement>(root, "#preview-file-name");
  const previewPath = requireDescendant<HTMLElement>(root, "#preview-file-path");
  const picker = createFilePickerView(root);
  const tree = createFileTreeView(root);
  const preview = createDataPreviewView(
    dataRoot,
    requireDescendant<HTMLElement>(root, "#cell-tooltip"),
  );

  function hideSelectionMessage(): void {
    selectionMessage.hidden = true;
    selectionMessage.replaceChildren();
    selectionMessage.classList.remove("error-notice", "info-notice");
  }

  function showSelectionMessage(title: string, detail: string, tone: "error" | "info"): void {
    const heading = document.createElement("strong");
    heading.textContent = title;
    const text = document.createElement("span");
    text.textContent = detail;
    selectionMessage.classList.toggle("error-notice", tone === "error");
    selectionMessage.classList.toggle("info-notice", tone === "info");
    selectionMessage.replaceChildren(heading, text);
    selectionMessage.hidden = false;
  }

  return {
    bind(options) {
      picker.bind({
        onChoose: options.onChooseFile,
        onClear: options.onClearWorkspace,
        onFiles: options.onFilesChosen,
      });
      tree.bind({
        onInspect(fileId, filter: InventoryFilter) {
          options.onSelectFile(fileId);
          preview.setFilter(filter);
        },
        onMarkAllViewed: options.onMarkAllViewed,
        onRemoveFile: options.onRemoveFile,
        onRemoveSource: options.onRemoveSource,
        onSelect: options.onSelectFile,
      });
      preview.bind({
        onVisibleRowsIncludedChange: options.onVisibleRowsIncludedChange,
        onRowIncludedChange: options.onRowIncludedChange,
      });
    },
    clear() {
      picker.clear();
      picker.setProcessing(false);
      tree.clear();
      preview.clear();
      hideSelectionMessage();
    },
    clearMessage: picker.clearMessage,
    confirmClear: picker.confirmClear,
    fileInput: picker.fileInput,
    render(snapshot, pendingArchives) {
      const files = snapshot.files;
      if (snapshot.sources.length === 0) {
        picker.clear();
        picker.setProcessing(pendingArchives > 0);
        tree.clear();
        preview.clear();
        hideSelectionMessage();
        return;
      }
      picker.renderSummary(files);
      picker.setProcessing(pendingArchives > 0 || files.some((file) => file.state === "processing"));
      const outputIssues = validateOutput(
        files.flatMap((item) => item.file ? [item.file] : []),
        snapshot.outputFormat,
      );
      tree.render(snapshot, outputIssues);

      const active = files.find((file) => file.id === snapshot.selectedFileId) ?? null;
      if (!active) {
        hideSelectionMessage();
        preview.clear();
        return;
      }
      if (active.state === "processing") {
        preview.clear();
        showSelectionMessage("正在檢查檔案", "完成後就能在這裡查看內容。", "info");
        return;
      }
      if (active.state === "ignored") {
        preview.clear();
        showSelectionMessage(
          active.ignoredReason === "symlink" ? "捷徑不會加入" : "不支援的檔案類型",
          "這個項目不會加入轉換或下載。",
          "info",
        );
        return;
      }
      if (active.state === "error" || !active.file) {
        preview.clear();
        showSelectionMessage(
          `無法開啟 ${basename(active.virtualPath)}`,
          active.error ?? "無法讀取這個檔案，請確認檔案可正常開啟後再試一次。",
          "error",
        );
        return;
      }
      hideSelectionMessage();
      previewName.textContent = basename(active.virtualPath);
      previewPath.textContent = active.virtualPath;
      previewPath.title = active.virtualPath;
      preview.render(active.file, outputIssues.filter((issue) => issue.fileId === active.id));
    },
    renderMessage: picker.renderMessage,
    renderUndo: picker.renderUndo,
  };
}
