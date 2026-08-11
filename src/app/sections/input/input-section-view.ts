import { requireDescendant, requireElement } from "../../../browser/dom";
import { FILE_FORMAT_LABELS, type FileFormat } from "../../../core/file-formats";
import { validateOutput } from "../../../core/output-validation";
import { activeWorkspaceItems, activeWorkspaceSnapshot, otherWorkspaceItems } from "../../state/workspace-selectors";
import type { WorkspaceSnapshot } from "../../state/workspace-types";
import { createDataPreviewView } from "./data-preview-view";
import { createFilePickerView } from "./file-picker-view";
import { createFileTreeView, type InventoryFilter } from "./file-tree-view";
import { createOtherFilesView } from "./other-files-view";

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
  const activeTab = requireDescendant<HTMLButtonElement>(root, "#active-files-tab");
  const otherTab = requireDescendant<HTMLButtonElement>(root, "#other-files-tab");
  const activePanel = requireDescendant<HTMLElement>(root, "#active-files-panel");
  const otherPanel = requireDescendant<HTMLElement>(root, "#other-files-panel");
  const activeFormat = requireDescendant<HTMLElement>(root, "#active-files-format");
  const activeCount = requireDescendant<HTMLElement>(root, "#active-files-count");
  const otherCount = requireDescendant<HTMLElement>(root, "#other-files-count");
  const previewName = requireDescendant<HTMLElement>(root, "#preview-file-name");
  const previewPath = requireDescendant<HTMLElement>(root, "#preview-file-path");
  const picker = createFilePickerView(root);
  const tree = createFileTreeView(root);
  const otherFiles = createOtherFilesView(root);
  const preview = createDataPreviewView(dataRoot);
  let currentInputFormat: FileFormat = "txt";

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

  function showTab(tab: "active" | "other"): void {
    const active = tab === "active";
    activeTab.setAttribute("aria-selected", String(active));
    otherTab.setAttribute("aria-selected", String(!active));
    activeTab.tabIndex = active ? 0 : -1;
    otherTab.tabIndex = active ? -1 : 0;
    activePanel.hidden = !active;
    otherPanel.hidden = active;
  }

  function moveTab(event: KeyboardEvent): void {
    const tabs = [activeTab, otherTab];
    const current = tabs.indexOf(event.currentTarget as HTMLButtonElement);
    const requested = event.key === "ArrowRight" ? tabs[(current + 1) % tabs.length]
      : event.key === "ArrowLeft" ? tabs[(current - 1 + tabs.length) % tabs.length]
      : event.key === "Home" ? tabs[0]
      : event.key === "End" ? tabs.at(-1)
      : null;
    if (!requested) return;
    event.preventDefault();
    showTab(requested === activeTab ? "active" : "other");
    requested.focus();
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
      otherFiles.bind(options.onRemoveFile);
      activeTab.addEventListener("click", () => showTab("active"));
      otherTab.addEventListener("click", () => showTab("other"));
      activeTab.addEventListener("keydown", moveTab);
      otherTab.addEventListener("keydown", moveTab);
    },
    clear() {
      picker.clear();
      picker.setProcessing(false);
      tree.clear(currentInputFormat);
      preview.clear();
      otherFiles.clear();
      activeFormat.textContent = FILE_FORMAT_LABELS[currentInputFormat];
      activeCount.textContent = "0";
      otherCount.textContent = "0";
      showTab("active");
      hideSelectionMessage();
    },
    clearMessage: picker.clearMessage,
    confirmClear: picker.confirmClear,
    fileInput: picker.fileInput,
    render(snapshot, pendingArchives) {
      const files = snapshot.files;
      currentInputFormat = snapshot.inputFormat;
      activeFormat.textContent = FILE_FORMAT_LABELS[snapshot.inputFormat];
      if (snapshot.sources.length === 0) {
        picker.clear();
        picker.setProcessing(pendingArchives > 0);
      } else {
        picker.renderSummary(files);
        picker.setProcessing(pendingArchives > 0 || files.some((file) => file.state === "processing"));
      }
      const activeSnapshot = activeWorkspaceSnapshot(snapshot);
      const activeFiles = activeWorkspaceItems(snapshot);
      const otherFilesItems = otherWorkspaceItems(snapshot);
      activeCount.textContent = String(activeFiles.length);
      otherCount.textContent = String(otherFilesItems.length);
      otherFiles.render(snapshot);
      const outputIssues = validateOutput(
        activeFiles.flatMap((item) => item.file ? [item.file] : []),
        snapshot.outputFormat,
      );
      tree.render(activeSnapshot, outputIssues);

      if (activeFiles.length === 0) {
        preview.clear();
        hideSelectionMessage();
        return;
      }

      const active = activeFiles.find((file) => file.id === activeSnapshot.selectedFileId) ?? null;
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
