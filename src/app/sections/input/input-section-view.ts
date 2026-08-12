import { requireDescendant, requireElement } from "../../../browser/dom";
import { FILE_FORMAT_LABELS } from "../../../core/file-formats";
import type { PreviewFilter, PreviewPage } from "../../batch/protocol";
import { activeWorkspaceItems, activeWorkspaceSnapshot, otherWorkspaceItems } from "../../state/workspace-selectors";
import type { WorkspaceSnapshot } from "../../state/workspace-types";
import { createStateTransition } from "../../shell/state-transition";
import { createDataPreviewView } from "./data-preview-view";
import { createFileOperationStatusView, type FileOperationStatus } from "./file-operation-status-view";
import { createFilePickerView } from "./file-picker-view";
import { createFileTreeView, type InventoryFilter } from "./file-tree-view";
import { createOtherFilesView } from "./other-files-view";

export interface InputSectionView {
  bind(options: {
    onChooseFile: () => void;
    onCancelFileOperation: () => void;
    onClearWorkspace: () => void;
    onFilesChosen: (files: readonly File[]) => void;
    onMarkAllViewed: () => void;
    onPreviewRequest: (fileId: string, filter: PreviewFilter, page: number) => void;
    onRemoveFile: (fileId: string) => void;
    onRemoveSource: (sourceId: string) => void;
    onVisibleRowsIncludedChange: (sourceRows: readonly number[], included: boolean) => void;
    onRowIncludedChange: (sourceRow: number, included: boolean) => void;
    onSelectFile: (fileId: string) => void;
  }): void;
  confirmClear(): boolean;
  fileInput(): HTMLInputElement;
  focusFilePicker(): void;
  clearPreview(): void;
  render(snapshot: WorkspaceSnapshot): void;
  renderPreviewPage(page: PreviewPage): void;
  renderPreviewError(fileId: string): void;
  renderOperationStatus(status: FileOperationStatus): void;
  setFilePickerLocked(locked: boolean, visible: boolean): void;
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
  const operationStatus = createFileOperationStatusView(root);
  const tree = createFileTreeView(root);
  const otherFiles = createOtherFilesView(root);
  const preview = createDataPreviewView(dataRoot);
  const selectionTransition = createStateTransition(selectionMessage);
  const activePanelTransition = createStateTransition(activePanel);
  const otherPanelTransition = createStateTransition(otherPanel);
  let currentPreviewFileId: string | null = null;
  let previewErrorFileId: string | null = null;
  let currentPreviewPath = "";
  let currentSelectionRevision = -1;
  let currentOutputFormat = "big5-txt";
  let requestPreview: (fileId: string, filter: PreviewFilter, page: number) => void = () => undefined;

  function hideSelectionMessage(): void {
    selectionTransition.update("hidden");
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
    selectionTransition.update(`${tone}:${title}:${detail}`);
  }

  function showTab(tab: "active" | "other"): void {
    const active = tab === "active";
    activeTab.setAttribute("aria-selected", String(active));
    otherTab.setAttribute("aria-selected", String(!active));
    activeTab.tabIndex = active ? 0 : -1;
    otherTab.tabIndex = active ? -1 : 0;
    activePanel.hidden = !active;
    otherPanel.hidden = active;
    activePanelTransition.update(active ? "visible" : "hidden");
    otherPanelTransition.update(active ? "hidden" : "visible");
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
      requestPreview = options.onPreviewRequest;
      picker.bind({
        onChoose: options.onChooseFile,
        onClear: options.onClearWorkspace,
        onFiles: options.onFilesChosen,
      });
      operationStatus.bind({
        onCancel: options.onCancelFileOperation,
        onMarkAllViewed: options.onMarkAllViewed,
      });
      tree.bind({
        onInspect(fileId, filter: InventoryFilter) {
          options.onSelectFile(fileId);
          preview.setFilter(filter);
        },
        onRemoveFile: options.onRemoveFile,
        onRemoveSource: options.onRemoveSource,
        onSelect: options.onSelectFile,
      });
      preview.bind({
        onPageRequest(filter, page) {
          if (currentPreviewFileId) requestPreview(currentPreviewFileId, filter, page);
        },
        onVisibleRowsIncludedChange: options.onVisibleRowsIncludedChange,
        onRowIncludedChange: options.onRowIncludedChange,
      });
      otherFiles.bind(options.onRemoveFile);
      activeTab.addEventListener("click", () => showTab("active"));
      otherTab.addEventListener("click", () => showTab("other"));
      activeTab.addEventListener("keydown", moveTab);
      otherTab.addEventListener("keydown", moveTab);
    },
    clearPreview() {
      preview.clear();
      currentPreviewFileId = null;
      currentSelectionRevision = -1;
      previewErrorFileId = null;
      currentPreviewPath = "";
    },
    confirmClear: picker.confirmClear,
    fileInput: picker.fileInput,
    focusFilePicker: picker.focusChoose,
    render(snapshot) {
      const files = snapshot.files;
      const outputFormatChanged = currentOutputFormat !== snapshot.outputFormat;
      currentOutputFormat = snapshot.outputFormat;
      activeFormat.textContent = FILE_FORMAT_LABELS[snapshot.inputFormat];
      picker.setHasFiles(snapshot.sources.length > 0);
      operationStatus.setUnreadCount(files.filter((file) => file.unread && file.sourceFormat === snapshot.inputFormat).length);
      const activeSnapshot = activeWorkspaceSnapshot(snapshot);
      const activeFiles = activeWorkspaceItems(snapshot);
      const otherFilesItems = otherWorkspaceItems(snapshot);
      activeCount.textContent = String(activeFiles.length);
      otherCount.textContent = String(otherFilesItems.length);
      otherFiles.render(snapshot);
      const outputIssues = activeFiles.flatMap((item) => (
        item.file?.outputFormat === snapshot.outputFormat ? item.file.blockingOutputIssues : []
      ));
      tree.render(activeSnapshot, outputIssues);

      if (activeFiles.length === 0) {
        preview.clear();
        currentPreviewFileId = null;
        currentSelectionRevision = -1;
        previewErrorFileId = null;
        currentPreviewPath = "";
        hideSelectionMessage();
        return;
      }

      const active = activeFiles.find((file) => file.id === activeSnapshot.selectedFileId) ?? null;
      if (!active) {
        hideSelectionMessage();
        preview.clear();
        currentPreviewFileId = null;
        currentSelectionRevision = -1;
        previewErrorFileId = null;
        currentPreviewPath = "";
        return;
      }
      if (!active.file) {
        preview.clear();
        currentPreviewFileId = null;
        currentSelectionRevision = -1;
        showSelectionMessage(
          `暫時無法顯示 ${basename(active.virtualPath)}`,
          "請移除此檔案後重新加入。",
          "error",
        );
        return;
      }
      if (currentPreviewFileId !== active.id) {
        previewErrorFileId = null;
        currentPreviewPath = active.virtualPath;
        if (preview.hasContent()) hideSelectionMessage();
        else showSelectionMessage("正在準備資料預覽", "完成後會在這裡顯示內容。", "info");
        preview.freeze();
        currentPreviewFileId = active.id;
        currentSelectionRevision = active.file.selectionRevision;
        requestPreview(active.id, "all", 0);
      } else if (outputFormatChanged || currentSelectionRevision !== active.file.selectionRevision) {
        if (previewErrorFileId !== active.id) hideSelectionMessage();
        currentSelectionRevision = active.file.selectionRevision;
        if (preview.hasContent()) preview.refresh();
        else requestPreview(active.id, "all", 0);
      } else if (previewErrorFileId === active.id) {
        previewErrorFileId = null;
        if (preview.hasContent()) hideSelectionMessage();
        else showSelectionMessage("正在重新準備資料預覽", "完成後會在這裡顯示內容。", "info");
        preview.freeze();
        requestPreview(active.id, "all", 0);
      } else {
        hideSelectionMessage();
      }
    },
    renderPreviewPage(page) {
      if (page.fileId !== currentPreviewFileId) return;
      previewErrorFileId = null;
      currentPreviewPath = page.virtualPath;
      hideSelectionMessage();
      previewName.textContent = basename(page.virtualPath);
      previewPath.textContent = page.virtualPath;
      previewPath.title = page.virtualPath;
      preview.render(page);
    },
    renderPreviewError(fileId) {
      if (fileId !== currentPreviewFileId) return;
      previewErrorFileId = fileId;
      const failureState = preview.fail();
      if (failureState === "current") {
        hideSelectionMessage();
        return;
      }
      showSelectionMessage(
        `暫時無法顯示 ${basename(currentPreviewPath)}`,
        "請重新選擇這個檔案，或稍後再試一次。",
        "error",
      );
    },
    renderOperationStatus: operationStatus.render,
    setFilePickerLocked: picker.setLocked,
  };
}
