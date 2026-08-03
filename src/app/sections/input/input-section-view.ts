import { requireDescendant, requireElement } from "../../../browser/dom";
import type { WorkspaceSnapshot } from "../../state/workspace-types";
import { createDataPreviewView } from "./data-preview-view";
import { createFilePickerView } from "./file-picker-view";
import { createFileTreeView } from "./file-tree-view";

export interface InputSectionView {
  bind(options: {
    onChooseFile: () => void;
    onClearWorkspace: () => void;
    onFilesChosen: (files: readonly File[]) => void;
    onRemoveFile: (fileId: string) => void;
    onRemoveSource: (sourceId: string) => void;
    onRowIncludedChange: (sourceRow: number, included: boolean) => void;
    onSelectFile: (fileId: string) => void;
  }): void;
  clear(): void;
  fileInput(): HTMLInputElement;
  render(snapshot: WorkspaceSnapshot, pendingArchives: number): void;
  renderError(title: string, detail: string): void;
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function createInputSectionView(): InputSectionView {
  const root = requireElement<HTMLElement>("#input-step");
  const empty = requireDescendant<HTMLElement>(root, "#workspace-empty");
  const results = requireDescendant<HTMLElement>(root, "#workspace-results");
  const dataRoot = requireDescendant<HTMLElement>(root, "#data-workspace");
  const picker = createFilePickerView(root);
  const tree = createFileTreeView(root);
  const preview = createDataPreviewView(
    dataRoot,
    requireDescendant<HTMLElement>(root, "#cell-tooltip"),
  );

  return {
    bind(options) {
      picker.bind({
        onChoose: options.onChooseFile,
        onClear: options.onClearWorkspace,
        onFiles: options.onFilesChosen,
      });
      tree.bind({
        onRemoveFile: options.onRemoveFile,
        onRemoveSource: options.onRemoveSource,
        onSelect: options.onSelectFile,
      });
      preview.bind({ onRowIncludedChange: options.onRowIncludedChange });
    },
    clear() {
      picker.clear();
      picker.setProcessing(false);
      tree.clear();
      preview.clear();
      empty.hidden = false;
      results.hidden = true;
    },
    fileInput: picker.fileInput,
    render(snapshot, pendingArchives) {
      const files = snapshot.files;
      if (snapshot.sources.length === 0) {
        picker.clear();
        picker.setProcessing(pendingArchives > 0);
        tree.clear();
        preview.clear();
        empty.hidden = pendingArchives > 0;
        results.hidden = true;
        return;
      }
      empty.hidden = true;
      results.hidden = false;
      picker.renderSummary(files, snapshot.sources.length);
      picker.setProcessing(pendingArchives > 0 || files.some((file) => file.state === "processing"));
      tree.render(snapshot.sources, files, snapshot.selectedFileId);

      const active = files.find((file) => file.id === snapshot.selectedFileId) ?? null;
      if (!active || active.state === "processing") {
        picker.clearError();
        preview.clear();
        return;
      }
      if (active.state === "error" || !active.file) {
        preview.clear();
        picker.renderError(`無法處理 ${basename(active.virtualPath)}`, active.error ?? "檔案無法處理。");
        return;
      }
      picker.clearError();
      preview.render(active.file);
    },
    renderError: picker.renderError,
  };
}
