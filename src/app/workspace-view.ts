import { downloadBlob, requireElement } from "../browser/dom";
import {
  cellValue,
  collectRowIssues,
  hasBlockingFileIssues,
  type DataIssue,
  type InternalFile,
  type InternalRow,
  type OutputFormat,
} from "../core/internal-model";
import type { CreatedOutput } from "./output-adapter";

type RowFilter = "all" | "error" | "warning" | "valid" | "modified";
export type WorkspaceFileState = "processing" | "ready" | "error";

export interface WorkspaceItem {
  error?: string;
  file?: InternalFile;
  id: string;
  size: number;
  state: WorkspaceFileState;
  virtualPath: string;
}

const PAGE_SIZE = 100;
const PREVIEW_ROW_SLOTS = 14;
const FILTERABLE_ROW_STATES: readonly RowFilter[] = [
  "error",
  "warning",
  "valid",
  "modified",
];

function rowIssues(row: InternalRow): DataIssue[] {
  return collectRowIssues(row);
}

function rowMatches(row: InternalRow, filter: RowFilter): boolean {
  const issues = rowIssues(row);
  switch (filter) {
    case "error":
      return issues.some((issue) => issue.severity === "error");
    case "warning":
      return issues.some((issue) => issue.severity === "warning");
    case "valid":
      return issues.length === 0;
    case "modified":
      return row.changes.length > 0;
    case "all":
      return true;
  }
}

function rowRank(row: InternalRow): number {
  const issues = rowIssues(row);
  if (issues.some((issue) => issue.severity === "error")) {
    return 0;
  }
  if (issues.some((issue) => issue.severity === "warning")) {
    return 1;
  }
  return 2;
}

function rowStatus(row: InternalRow): { label: string; tone: string } {
  const issues = rowIssues(row);
  if (issues.some((issue) => issue.severity === "error")) {
    return { label: "錯誤", tone: "error" };
  }
  if (issues.some((issue) => issue.severity === "warning")) {
    return { label: "提醒", tone: "warning" };
  }
  return row.changes.length > 0
    ? { label: "已修改", tone: "modified" }
    : { label: "有效", tone: "valid" };
}

export interface WorkspaceView {
  announce(message: string): void;
  bind(options: {
    onChooseFile: () => void;
    onClearWorkspace: () => void;
    onFilesChosen: (files: readonly File[]) => void;
    onRemoveFile: (fileId: string) => void;
    onRowIncludedChange: (sourceRow: number, included: boolean) => void;
    onSelectFile: (fileId: string) => void;
    onDownload: () => void;
    onOutputFormatChange: () => void;
  }): void;
  clear(): void;
  fileInput(): HTMLInputElement;
  outputFormat(): OutputFormat;
  renderActiveError(path: string, detail: string): void;
  renderActivePending(path: string): void;
  renderError(title: string, detail: string): void;
  renderFile(file: InternalFile): void;
  renderInventory(files: readonly WorkspaceItem[], selectedFileId: string | null): void;
  saveOutput(output: CreatedOutput): void;
  setDownloadBusy(busy: boolean): void;
  setProcessing(processing: boolean): void;
  syncDownload(file: InternalFile | null): void;
}

export function createWorkspaceView(): WorkspaceView {
  const appStatus = requireElement<HTMLElement>("#app-status");
  const sourceInput = requireElement<HTMLInputElement>("#source-file");
  const sourcePicker = requireElement<HTMLElement>("#source-file-picker");
  const sourceName = requireElement<HTMLElement>("#source-file-name");
  const sourceMeta = requireElement<HTMLElement>("#source-file-meta");
  const sourceError = requireElement<HTMLElement>("#source-file-error");
  const processingIndicator = requireElement<HTMLElement>("#file-processing-indicator");
  const selectButton = requireElement<HTMLButtonElement>("#select-source-button");
  const clearWorkspaceButton = requireElement<HTMLButtonElement>("#clear-workspace-button");
  const workspaceEmpty = requireElement<HTMLElement>("#workspace-empty");
  const workspaceResults = requireElement<HTMLElement>("#workspace-results");
  const dataWorkspace = requireElement<HTMLElement>("#data-workspace");
  const fileTree = requireElement<HTMLUListElement>("#file-tree");
  const fileTreeCount = requireElement<HTMLElement>("#file-tree-count");
  const sourceRowSummary = requireElement<HTMLElement>("#source-row-summary");
  const includedRowSummary = requireElement<HTMLElement>("#included-row-summary");
  const blankRowSummary = requireElement<HTMLElement>("#blank-row-summary");
  const errorSummary = requireElement<HTMLElement>("#error-summary");
  const warningSummary = requireElement<HTMLElement>("#warning-summary");
  const modifiedSummary = requireElement<HTMLElement>("#modified-summary");
  const rowFilter = requireElement<HTMLSelectElement>("#row-filter");
  const dataTableBody = requireElement<HTMLTableSectionElement>("#data-table-body");
  const dataPageStatus = requireElement<HTMLElement>("#data-page-status");
  const previousPageButton = requireElement<HTMLButtonElement>("#previous-page-button");
  const nextPageButton = requireElement<HTMLButtonElement>("#next-page-button");
  const cellTooltip = requireElement<HTMLElement>("#cell-tooltip");
  const downloadButton = requireElement<HTMLButtonElement>("#download-button");
  const downloadTitle = requireElement<HTMLElement>("#download-status-title");
  const downloadDetail = requireElement<HTMLElement>("#download-status-detail");
  let currentFile: InternalFile | null = null;
  let downloadBusy = false;
  let currentPage = 0;
  let activeDetailTrigger: HTMLElement | null = null;

  function basename(path: string): string {
    return path.split("/").at(-1) ?? path;
  }

  function parentPath(path: string): string {
    const segments = path.split("/");
    segments.pop();
    return segments.join("/");
  }

  function treeItemPresentation(item: WorkspaceItem): { label: string; tone: string } {
    if (item.state === "processing") {
      return { label: "檢查中", tone: "info" };
    }
    if (item.state === "error" || !item.file) {
      return { label: "無法處理", tone: "error" };
    }
    if (item.file.summary.errorCount > 0) {
      return { label: `${item.file.summary.errorCount} 錯誤`, tone: "error" };
    }
    if (item.file.summary.warningCount > 0) {
      return { label: `${item.file.summary.warningCount} 提醒`, tone: "warning" };
    }
    return { label: "可下載", tone: "success" };
  }

  function renderTree(files: readonly WorkspaceItem[], selectedFileId: string | null): void {
    fileTree.replaceChildren();
    files.forEach((item, index) => {
      const presentation = treeItemPresentation(item);
      const listItem = document.createElement("li");
      listItem.setAttribute("role", "none");
      const row = document.createElement("div");
      row.className = "file-tree-row";
      row.dataset.selected = String(item.id === selectedFileId);

      const itemButton = document.createElement("button");
      itemButton.className = "file-tree-item";
      itemButton.type = "button";
      itemButton.setAttribute("role", "treeitem");
      itemButton.setAttribute("aria-selected", String(item.id === selectedFileId));
      itemButton.dataset.fileId = item.id;
      itemButton.dataset.tone = presentation.tone;
      itemButton.tabIndex = item.id === selectedFileId || (!selectedFileId && index === 0) ? 0 : -1;

      const marker = document.createElement("span");
      marker.className = "file-tree-marker";
      marker.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.className = "file-tree-name";
      name.textContent = basename(item.virtualPath);
      name.title = item.virtualPath;
      const state = document.createElement("span");
      state.className = "file-tree-state";
      const location = parentPath(item.virtualPath);
      state.textContent = location ? `${location} · ${presentation.label}` : presentation.label;
      itemButton.setAttribute("aria-label", `${item.virtualPath}，${presentation.label}`);
      itemButton.append(marker, name, state);

      const removeButton = document.createElement("button");
      removeButton.className = "file-tree-remove";
      removeButton.type = "button";
      removeButton.dataset.removeFileId = item.id;
      removeButton.setAttribute("aria-label", `從工作區移除 ${item.virtualPath}`);
      removeButton.title = "從工作區移除";
      removeButton.textContent = "×";
      row.append(itemButton, removeButton);
      listItem.append(row);
      fileTree.append(listItem);
    });
  }

  function selectedOutputFormat(): OutputFormat {
    return document.querySelector<HTMLInputElement>(
      'input[name="output-format"]:checked',
    )?.value === "xlsx" ? "xlsx" : "big5-txt";
  }

  function clearError(): void {
    sourceError.hidden = true;
    sourceError.replaceChildren();
  }

  function detailTrigger(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element
      ? target.closest<HTMLElement>(".detail-trigger")
      : null;
  }

  function hideDetail(trigger?: HTMLElement | null): void {
    if (trigger && activeDetailTrigger !== trigger) {
      return;
    }
    activeDetailTrigger?.removeAttribute("aria-describedby");
    activeDetailTrigger = null;
    cellTooltip.hidden = true;
    cellTooltip.textContent = "";
  }

  function showDetail(trigger: HTMLElement): void {
    const detail = trigger.dataset.detail;
    if (!detail) {
      return;
    }
    activeDetailTrigger?.removeAttribute("aria-describedby");
    activeDetailTrigger = trigger;
    trigger.setAttribute("aria-describedby", "cell-tooltip");
    cellTooltip.textContent = detail;
    cellTooltip.hidden = false;

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = cellTooltip.getBoundingClientRect();
    const edgeGap = 8;
    const preferredLeft = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
    const left = Math.max(
      edgeGap,
      Math.min(preferredLeft, window.innerWidth - tooltipRect.width - edgeGap),
    );
    const below = triggerRect.bottom + edgeGap;
    const top = below + tooltipRect.height <= window.innerHeight - edgeGap
      ? below
      : Math.max(edgeGap, triggerRect.top - tooltipRect.height - edgeGap);
    cellTooltip.style.left = `${left}px`;
    cellTooltip.style.top = `${top}px`;
  }

  function setDetail(
    element: HTMLElement,
    details: readonly string[],
    ariaLabel: string,
  ): void {
    if (details.length === 0) {
      return;
    }
    element.classList.add("detail-trigger");
    element.dataset.detail = details.join("\n");
    element.tabIndex = 0;
    element.setAttribute("aria-label", ariaLabel);
  }

  function resetRowFilterOptions(): void {
    Array.from(rowFilter.options).forEach((option) => {
      option.disabled = false;
    });
  }

  function syncRowFilterOptions(file: InternalFile): void {
    FILTERABLE_ROW_STATES.forEach((filter) => {
      const option = Array.from(rowFilter.options)
        .find((currentOption) => currentOption.value === filter);
      if (option) {
        option.disabled = !file.rows.some((row) => rowMatches(row, filter));
      }
    });
    if (rowFilter.selectedOptions[0]?.disabled) {
      rowFilter.value = "all";
    }
  }

  function renderTable(file: InternalFile): void {
    const filter = rowFilter.value as RowFilter;
    const filteredRows = file.rows
      .filter((row) => rowMatches(row, filter))
      .sort((left, right) => rowRank(left) - rowRank(right) || left.sourceRow - right.sourceRow);
    const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, pageCount - 1);
    const pageStart = currentPage * PAGE_SIZE;
    const visibleRows = filteredRows.slice(pageStart, pageStart + PAGE_SIZE);
    dataTableBody.replaceChildren();

    if (visibleRows.length === 0) {
      const row = dataTableBody.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 18;
      cell.className = "empty-table-message";
      cell.textContent = "沒有符合目前篩選條件的資料列。";
    }

    visibleRows.forEach((row) => {
      const tableRow = dataTableBody.insertRow();
      const status = rowStatus(row);
      tableRow.dataset.tone = status.tone;
      const sourceRowCell = document.createElement("th");
      sourceRowCell.scope = "row";
      sourceRowCell.textContent = String(row.sourceRow);
      tableRow.append(sourceRowCell);
      const statusCell = tableRow.insertCell();
      statusCell.className = "row-status-cell";
      const statusText = document.createElement("span");
      statusText.className = "row-status-text";
      statusText.textContent = status.label;
      const generalIssues = row.issues.map((issue) => issue.message);
      setDetail(
        statusText,
        generalIssues,
        `第 ${row.sourceRow} 列、${status.label}：${generalIssues.join("；")}`,
      );
      statusCell.append(statusText);

      const outputCell = tableRow.insertCell();
      outputCell.className = "row-output-cell";
      const outputCheckbox = document.createElement("input");
      outputCheckbox.type = "checkbox";
      outputCheckbox.checked = row.included;
      outputCheckbox.dataset.outputSourceRow = String(row.sourceRow);
      outputCheckbox.setAttribute("aria-label", `輸出第 ${row.sourceRow} 列`);
      outputCell.append(outputCheckbox);

      row.cells.forEach((cell) => {
        const tableCell = tableRow.insertCell();
        const issues = cell.issues;
        const change = row.changes.find((item) => item.fieldIndex === cell.fieldIndex);
        const value = document.createElement("span");
        value.className = "data-cell-value";
        value.textContent = cellValue(cell) || "—";
        if (issues.some((item) => item.severity === "error")) {
          tableCell.dataset.tone = "error";
        } else if (issues.some((item) => item.severity === "warning")) {
          tableCell.dataset.tone = "warning";
        } else if (change) {
          tableCell.dataset.tone = "modified";
        }
        const details = [
          ...issues.map((item) => item.message),
          ...(change
            ? [change.before === ""
              ? `空白已改為 ${change.after}。`
              : `${change.before} 已改為 ${change.after}。`]
            : []),
        ];
        setDetail(
          value,
          details,
          `第 ${row.sourceRow} 列、欄位${cell.fieldIndex}：${details.join("；")}`,
        );
        tableCell.append(value);
      });
    });

    const renderedRowCount = Math.max(visibleRows.length, 1);
    for (
      let placeholderIndex = renderedRowCount;
      placeholderIndex < PREVIEW_ROW_SLOTS;
      placeholderIndex += 1
    ) {
      const placeholderRow = dataTableBody.insertRow();
      placeholderRow.className = "preview-placeholder-row";
      placeholderRow.setAttribute("aria-hidden", "true");
      for (let columnIndex = 0; columnIndex < 18; columnIndex += 1) {
        placeholderRow.insertCell();
      }
    }

    dataPageStatus.textContent = filteredRows.length === 0
      ? "共 0 列。"
      : `第 ${currentPage + 1} / ${pageCount} 頁；顯示第 ${pageStart + 1}–${pageStart + visibleRows.length} 列，共 ${filteredRows.length} 列。`;
    previousPageButton.disabled = currentPage === 0;
    nextPageButton.disabled = currentPage >= pageCount - 1;
  }

  function syncDownload(file: InternalFile | null): void {
    currentFile = file;
    const format = selectedOutputFormat();
    downloadButton.textContent = format === "xlsx" ? "下載 XLSX" : "下載 Big5 TXT";
    if (downloadBusy) {
      downloadButton.disabled = true;
      downloadTitle.textContent = format === "xlsx" ? "正在建立 XLSX" : "正在建立 Big5 TXT";
      downloadDetail.textContent = "請稍候，不要關閉頁面。";
      return;
    }
    if (!file) {
      downloadButton.disabled = true;
      downloadTitle.textContent = "尚未準備下載";
      downloadDetail.textContent = "請先選擇並完成驗證。";
      return;
    }
    if (hasBlockingFileIssues(file)) {
      const blockingCount = file.issues.filter((issue) => issue.severity === "error").length;
      downloadButton.disabled = true;
      downloadTitle.textContent = "檔案錯誤尚未排除";
      downloadDetail.textContent = `共有 ${blockingCount} 項無法逐列排除的錯誤。`;
      return;
    }
    if (file.summary.includedRows === 0) {
      downloadButton.disabled = true;
      downloadTitle.textContent = "尚未選擇輸出列";
      downloadDetail.textContent = "有錯誤或提醒的資料列預設不輸出；請在預覽中勾選要輸出的列。";
      return;
    }
    downloadButton.disabled = false;
    downloadTitle.textContent = "可以下載";
    const forcedRows = file.rows.filter((row) => row.included && rowIssues(row).length > 0).length;
    const excludedRows = file.rows.length - file.summary.includedRows;
    downloadDetail.textContent = forcedRows > 0
      ? `將輸出 ${file.summary.includedRows} 列；其中 ${forcedRows} 列有錯誤或提醒，已依勾選強制納入。`
      : excludedRows > 0
        ? `將輸出 ${file.summary.includedRows} 列；另有 ${excludedRows} 列未勾選。`
        : `已通過最終驗證，共 ${file.summary.includedRows} 列。`;
  }

  function clear(): void {
    currentFile = null;
    downloadBusy = false;
    currentPage = 0;
    rowFilter.value = "all";
    resetRowFilterOptions();
    previousPageButton.disabled = true;
    nextPageButton.disabled = true;
    sourceInput.value = "";
    sourceName.textContent = "工作區尚無檔案";
    sourceName.removeAttribute("title");
    sourceMeta.textContent = "";
    sourceMeta.hidden = true;
    sourcePicker.dataset.tone = "neutral";
    processingIndicator.hidden = true;
    clearWorkspaceButton.disabled = true;
    workspaceEmpty.hidden = false;
    workspaceResults.hidden = true;
    dataWorkspace.hidden = true;
    fileTree.replaceChildren();
    fileTreeCount.textContent = "";
    hideDetail();
    clearError();
    syncDownload(null);
  }

  return {
    announce(message) {
      appStatus.textContent = message;
    },
    bind(options) {
      selectButton.addEventListener("click", options.onChooseFile);
      clearWorkspaceButton.addEventListener("click", options.onClearWorkspace);
      downloadButton.addEventListener("click", options.onDownload);
      sourceInput.addEventListener("change", () => {
        const files = Array.from(sourceInput.files ?? []);
        sourceInput.value = "";
        if (files.length > 0) {
          options.onFilesChosen(files);
        }
      });
      fileTree.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const removeButton = target?.closest<HTMLButtonElement>("[data-remove-file-id]");
        if (removeButton?.dataset.removeFileId) {
          options.onRemoveFile(removeButton.dataset.removeFileId);
          return;
        }
        const itemButton = target?.closest<HTMLButtonElement>("[data-file-id]");
        if (itemButton?.dataset.fileId) {
          options.onSelectFile(itemButton.dataset.fileId);
        }
      });
      fileTree.addEventListener("keydown", (event) => {
        if (!(event.target instanceof HTMLButtonElement) || !event.target.dataset.fileId) {
          return;
        }
        const items = Array.from(fileTree.querySelectorAll<HTMLButtonElement>("[data-file-id]"));
        const currentIndex = items.indexOf(event.target);
        const requestedIndex = event.key === "ArrowDown"
          ? Math.min(items.length - 1, currentIndex + 1)
          : event.key === "ArrowUp"
            ? Math.max(0, currentIndex - 1)
            : event.key === "Home"
              ? 0
              : event.key === "End" ? items.length - 1 : currentIndex;
        if (requestedIndex === currentIndex || !items[requestedIndex]) {
          return;
        }
        event.preventDefault();
        const requestedFileId = items[requestedIndex].dataset.fileId;
        items[requestedIndex].click();
        if (requestedFileId) {
          Array.from(fileTree.querySelectorAll<HTMLButtonElement>("[data-file-id]"))
            .find((item) => item.dataset.fileId === requestedFileId)
            ?.focus();
        }
      });
      document.querySelectorAll<HTMLInputElement>('input[name="output-format"]')
        .forEach((radio) => radio.addEventListener("change", options.onOutputFormatChange));
      workspaceResults.addEventListener("pointerover", (event) => {
        const trigger = detailTrigger(event.target);
        if (trigger && trigger !== activeDetailTrigger) {
          showDetail(trigger);
        }
      });
      workspaceResults.addEventListener("pointerout", (event) => {
        const trigger = detailTrigger(event.target);
        if (trigger && !trigger.contains(event.relatedTarget as Node | null)) {
          hideDetail(trigger);
        }
      });
      workspaceResults.addEventListener("focusin", (event) => {
        const trigger = detailTrigger(event.target);
        if (trigger) {
          showDetail(trigger);
        }
      });
      workspaceResults.addEventListener("focusout", (event) => {
        hideDetail(detailTrigger(event.target));
      });
      workspaceResults.addEventListener("click", (event) => {
        const trigger = detailTrigger(event.target);
        if (trigger) {
          showDetail(trigger);
        }
      });
      dataTableBody.addEventListener("change", (event) => {
        const checkbox = event.target instanceof HTMLInputElement
          ? event.target.closest<HTMLInputElement>("[data-output-source-row]")
          : null;
        const sourceRow = Number(checkbox?.dataset.outputSourceRow);
        if (checkbox && Number.isInteger(sourceRow)) {
          options.onRowIncludedChange(sourceRow, checkbox.checked);
        }
      });
      window.addEventListener("resize", () => hideDetail());
      requireElement<HTMLElement>(".data-table-scroll")
        .addEventListener("scroll", () => hideDetail(), { passive: true });
      rowFilter.addEventListener("change", () => {
        currentPage = 0;
        if (currentFile) {
          renderTable(currentFile);
        }
      });
      previousPageButton.addEventListener("click", () => {
        if (currentFile && currentPage > 0) {
          currentPage -= 1;
          renderTable(currentFile);
        }
      });
      nextPageButton.addEventListener("click", () => {
        if (currentFile) {
          currentPage += 1;
          renderTable(currentFile);
        }
      });
    },
    clear,
    fileInput: () => sourceInput,
    outputFormat: selectedOutputFormat,
    renderActiveError(path, detail) {
      currentFile = null;
      dataWorkspace.hidden = true;
      syncDownload(null);
      sourcePicker.dataset.tone = "error";
      const heading = document.createElement("strong");
      heading.textContent = `無法處理 ${basename(path)}`;
      const description = document.createElement("span");
      description.textContent = detail;
      sourceError.replaceChildren(heading, description);
      sourceError.hidden = false;
    },
    renderActivePending() {
      currentFile = null;
      dataWorkspace.hidden = true;
      clearError();
      syncDownload(null);
    },
    renderError(title, detail) {
      sourcePicker.dataset.tone = "error";
      const heading = document.createElement("strong");
      heading.textContent = title;
      const description = document.createElement("span");
      description.textContent = detail;
      sourceError.replaceChildren(heading, description);
      sourceError.hidden = false;
    },
    renderFile(file) {
      const isSameFile = currentFile?.id === file.id;
      currentFile = file;
      if (!isSameFile) {
        currentPage = 0;
      }
      clearError();
      workspaceEmpty.hidden = true;
      workspaceResults.hidden = false;
      dataWorkspace.hidden = false;
      sourceRowSummary.textContent = String(file.summary.sourceRows);
      includedRowSummary.textContent = String(file.summary.includedRows);
      blankRowSummary.textContent = String(file.summary.excludedBlankRows);
      errorSummary.textContent = String(file.summary.errorCount);
      warningSummary.textContent = String(file.summary.warningCount);
      modifiedSummary.textContent = String(file.summary.modifiedCount);
      errorSummary.dataset.tone = file.summary.errorCount > 0 ? "error" : "success";
      warningSummary.dataset.tone = file.summary.warningCount > 0 ? "warning" : "success";
      modifiedSummary.dataset.tone = file.summary.modifiedCount > 0 ? "warning" : "success";
      syncRowFilterOptions(file);
      renderTable(file);
      syncDownload(file);
    },
    renderInventory(files, selectedFileId) {
      if (files.length === 0) {
        clear();
        return;
      }
      const totalBytes = files.reduce((total, file) => total + file.size, 0);
      const processing = files.some((file) => file.state === "processing");
      const errors = files.some((file) => file.state === "error");
      sourceName.textContent = `${files.length} 個檔案`;
      sourceMeta.hidden = false;
      sourceMeta.textContent = `${totalBytes.toLocaleString("zh-Hant-TW")} bytes`;
      sourcePicker.dataset.tone = processing ? "info" : errors ? "error" : "success";
      clearWorkspaceButton.disabled = false;
      workspaceEmpty.hidden = true;
      workspaceResults.hidden = false;
      fileTreeCount.textContent = String(files.length);
      renderTree(files, selectedFileId);
    },
    saveOutput(output) {
      downloadBlob(
        new Blob([output.bytes.slice().buffer], { type: output.mimeType }),
        output.filename,
      );
    },
    setDownloadBusy(busy) {
      downloadBusy = busy;
      syncDownload(currentFile);
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
    syncDownload,
  };
}
