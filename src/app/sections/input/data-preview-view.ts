import { requireDescendant } from "../../../browser/dom";
import {
  cellValue,
  collectRowIssues,
  issueFieldIndices,
  type DataIssue,
  type InternalFile,
  type InternalRow,
} from "../../../core/internal-model";

type RowFilter = "all" | "error" | "warning" | "valid" | "modified" | "excluded";

const PAGE_SIZE = 100;
const PREVIEW_ROW_SLOTS = 14;
const FILTERABLE_ROW_STATES: readonly RowFilter[] = [
  "error",
  "warning",
  "valid",
  "modified",
  "excluded",
];

export interface DataPreviewView {
  bind(options: { onRowIncludedChange: (sourceRow: number, included: boolean) => void }): void;
  clear(): void;
  render(file: InternalFile): void;
}

function rowIssues(row: InternalRow): DataIssue[] {
  return collectRowIssues(row);
}

function rowMatches(row: InternalRow, filter: RowFilter): boolean {
  const issues = rowIssues(row);
  switch (filter) {
    case "error": return issues.some((issue) => issue.severity === "error");
    case "warning": return issues.some((issue) => issue.severity === "warning");
    case "valid": return issues.length === 0;
    case "modified": return row.changes.length > 0;
    case "excluded": return !row.included;
    case "all": return true;
  }
}

function rowRank(row: InternalRow): number {
  const issues = rowIssues(row);
  if (issues.some((issue) => issue.severity === "error")) return 0;
  if (issues.some((issue) => issue.severity === "warning")) return 1;
  return 2;
}

function rowStatus(row: InternalRow): { label: string; tone: string } {
  const issues = rowIssues(row);
  if (issues.some((issue) => issue.severity === "error")) {
    return { label: "錯誤", tone: "error" };
  }
  if (issues.some((issue) => issue.severity === "warning")) {
    return { label: "警告", tone: "warning" };
  }
  return row.changes.length > 0
    ? { label: "自動修正", tone: "modified" }
    : { label: "有效", tone: "valid" };
}

function uniqueDetails(details: readonly string[]): string[] {
  return [...new Set(details)];
}

function issueDetail(issue: DataIssue): string {
  const fields = issueFieldIndices(issue);
  return fields.length === 0
    ? issue.message
    : `欄位${fields.join("、")}：${issue.message}`;
}

export function createDataPreviewView(root: HTMLElement, tooltip: HTMLElement): DataPreviewView {
  const sourceRowSummary = requireDescendant<HTMLElement>(root, "#source-row-summary");
  const includedRowSummary = requireDescendant<HTMLElement>(root, "#included-row-summary");
  const blankRowSummary = requireDescendant<HTMLElement>(root, "#blank-row-summary");
  const errorSummary = requireDescendant<HTMLElement>(root, "#error-summary");
  const warningSummary = requireDescendant<HTMLElement>(root, "#warning-summary");
  const modifiedSummary = requireDescendant<HTMLElement>(root, "#modified-summary");
  const rowFilter = requireDescendant<HTMLSelectElement>(root, "#row-filter");
  const tableBody = requireDescendant<HTMLTableSectionElement>(root, "#data-table-body");
  const pageStatus = requireDescendant<HTMLElement>(root, "#data-page-status");
  const previousButton = requireDescendant<HTMLButtonElement>(root, "#previous-page-button");
  const nextButton = requireDescendant<HTMLButtonElement>(root, "#next-page-button");
  const tableScroll = requireDescendant<HTMLElement>(root, ".data-table-scroll");
  let currentFile: InternalFile | null = null;
  let currentPage = 0;
  let activeDetailTrigger: HTMLElement | null = null;

  function detailTrigger(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? target.closest<HTMLElement>(".detail-trigger") : null;
  }

  function hideDetail(trigger?: HTMLElement | null): void {
    if (trigger && activeDetailTrigger !== trigger) return;
    activeDetailTrigger?.removeAttribute("aria-describedby");
    activeDetailTrigger = null;
    tooltip.hidden = true;
    tooltip.textContent = "";
  }

  function showDetail(trigger: HTMLElement): void {
    const detail = trigger.dataset.detail;
    if (!detail) return;
    activeDetailTrigger?.removeAttribute("aria-describedby");
    activeDetailTrigger = trigger;
    trigger.setAttribute("aria-describedby", "cell-tooltip");
    tooltip.textContent = detail;
    tooltip.hidden = false;
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const edgeGap = 8;
    const preferredLeft = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
    tooltip.style.left = `${Math.max(edgeGap, Math.min(preferredLeft, window.innerWidth - tooltipRect.width - edgeGap))}px`;
    const below = triggerRect.bottom + edgeGap;
    tooltip.style.top = `${below + tooltipRect.height <= window.innerHeight - edgeGap
      ? below
      : Math.max(edgeGap, triggerRect.top - tooltipRect.height - edgeGap)}px`;
  }

  function setDetail(element: HTMLElement, details: readonly string[], ariaLabel: string): void {
    if (details.length === 0) return;
    element.classList.add("detail-trigger");
    element.dataset.detail = details.join("\n");
    element.tabIndex = 0;
    element.setAttribute("aria-label", ariaLabel);
  }

  function resetFilterOptions(): void {
    Array.from(rowFilter.options).forEach((option) => { option.disabled = false; });
  }

  function syncFilterOptions(file: InternalFile): void {
    FILTERABLE_ROW_STATES.forEach((filter) => {
      const option = Array.from(rowFilter.options).find((candidate) => candidate.value === filter);
      if (option) option.disabled = !file.rows.some((row) => rowMatches(row, filter));
    });
    if (rowFilter.selectedOptions[0]?.disabled) rowFilter.value = "all";
  }

  function renderTable(file: InternalFile): void {
    const focusedSourceRow = document.activeElement instanceof HTMLInputElement
      ? document.activeElement.dataset.outputSourceRow
      : undefined;
    const filter = rowFilter.value as RowFilter;
    const filteredRows = file.rows
      .filter((row) => rowMatches(row, filter))
      .sort((left, right) => rowRank(left) - rowRank(right) || left.sourceRow - right.sourceRow);
    const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, pageCount - 1);
    const pageStart = currentPage * PAGE_SIZE;
    const visibleRows = filteredRows.slice(pageStart, pageStart + PAGE_SIZE);
    tableBody.replaceChildren();

    if (visibleRows.length === 0) {
      const row = tableBody.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 18;
      cell.className = "empty-table-message";
      cell.textContent = "沒有符合目前篩選條件的資料列。";
    }

    visibleRows.forEach((row) => {
      const tableRow = tableBody.insertRow();
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
      const rowDetails = uniqueDetails([
        ...rowIssues(row).map(issueDetail),
        ...row.changes.map((change) => (
          change.before === ""
            ? `欄位${change.fieldIndex}：空白已改為 ${change.after}。`
            : `欄位${change.fieldIndex}：${change.before} 已改為 ${change.after}。`
        )),
      ]);
      setDetail(statusText, rowDetails, `第 ${row.sourceRow} 列、${status.label}：${rowDetails.join("；")}`);
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
        const change = row.changes.find((item) => item.fieldIndex === cell.fieldIndex);
        const relatedIssues = row.issues.filter(
          (issue) => issueFieldIndices(issue).includes(cell.fieldIndex),
        );
        const cellIssues = [...cell.issues, ...relatedIssues];
        const value = document.createElement("span");
        value.className = "data-cell-value";
        const displayedValue = cellValue(cell);
        value.textContent = displayedValue || "∅";
        if (displayedValue === "") {
          value.classList.add("is-empty");
          value.setAttribute("aria-label", "空白");
        }
        if (cellIssues.some((item) => item.severity === "error")) {
          tableCell.dataset.tone = "error";
        } else if (cellIssues.some((item) => item.severity === "warning")) {
          tableCell.dataset.tone = "warning";
        } else if (change) {
          tableCell.dataset.tone = "modified";
        }
        tableCell.append(value);
      });
    });

    const renderedRowCount = Math.max(visibleRows.length, 1);
    for (let index = renderedRowCount; index < PREVIEW_ROW_SLOTS; index += 1) {
      const placeholder = tableBody.insertRow();
      placeholder.className = "preview-placeholder-row";
      placeholder.setAttribute("aria-hidden", "true");
      for (let column = 0; column < 18; column += 1) placeholder.insertCell();
    }

    pageStatus.textContent = filteredRows.length === 0
      ? "共 0 列。"
      : `第 ${currentPage + 1} / ${pageCount} 頁；顯示第 ${pageStart + 1}–${pageStart + visibleRows.length} 列，共 ${filteredRows.length} 列。`;
    previousButton.disabled = currentPage === 0;
    nextButton.disabled = currentPage >= pageCount - 1;
    if (focusedSourceRow) {
      const replacement = Array.from(
        tableBody.querySelectorAll<HTMLInputElement>("[data-output-source-row]"),
      ).find((checkbox) => checkbox.dataset.outputSourceRow === focusedSourceRow);
      replacement?.focus({ preventScroll: true });
    }
  }

  return {
    bind(options) {
      root.addEventListener("pointerover", (event) => {
        const trigger = detailTrigger(event.target);
        if (trigger && trigger !== activeDetailTrigger) showDetail(trigger);
      });
      root.addEventListener("pointerout", (event) => {
        const trigger = detailTrigger(event.target);
        const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (trigger && !trigger.contains(relatedTarget)) hideDetail(trigger);
      });
      root.addEventListener("focusin", (event) => {
        const trigger = detailTrigger(event.target);
        if (trigger) showDetail(trigger);
      });
      root.addEventListener("focusout", (event) => hideDetail(detailTrigger(event.target)));
      root.addEventListener("click", (event) => {
        const trigger = detailTrigger(event.target);
        if (trigger) showDetail(trigger);
      });
      tableBody.addEventListener("change", (event) => {
        const checkbox = event.target instanceof HTMLInputElement
          ? event.target.closest<HTMLInputElement>("[data-output-source-row]")
          : null;
        const sourceRow = Number(checkbox?.dataset.outputSourceRow);
        if (checkbox && Number.isInteger(sourceRow)) {
          options.onRowIncludedChange(sourceRow, checkbox.checked);
        }
      });
      window.addEventListener("resize", () => hideDetail());
      tableScroll.addEventListener("scroll", () => hideDetail(), { passive: true });
      rowFilter.addEventListener("change", () => {
        currentPage = 0;
        if (currentFile) renderTable(currentFile);
      });
      previousButton.addEventListener("click", () => {
        if (currentFile && currentPage > 0) {
          currentPage -= 1;
          renderTable(currentFile);
        }
      });
      nextButton.addEventListener("click", () => {
        if (currentFile) {
          currentPage += 1;
          renderTable(currentFile);
        }
      });
    },
    clear() {
      currentFile = null;
      currentPage = 0;
      rowFilter.value = "all";
      resetFilterOptions();
      previousButton.disabled = true;
      nextButton.disabled = true;
      tableBody.replaceChildren();
      pageStatus.textContent = "";
      hideDetail();
      root.hidden = true;
    },
    render(file) {
      const sameFile = currentFile?.id === file.id;
      currentFile = file;
      if (!sameFile) currentPage = 0;
      root.hidden = false;
      sourceRowSummary.textContent = String(file.summary.sourceRows);
      includedRowSummary.textContent = String(file.summary.includedRows);
      blankRowSummary.textContent = String(file.summary.excludedBlankRows);
      errorSummary.textContent = String(file.summary.errorCount);
      warningSummary.textContent = String(file.summary.warningCount);
      modifiedSummary.textContent = String(file.summary.modifiedCount);
      errorSummary.dataset.tone = file.summary.errorCount > 0 ? "error" : "success";
      warningSummary.dataset.tone = file.summary.warningCount > 0 ? "warning" : "success";
      modifiedSummary.dataset.tone = file.summary.modifiedCount > 0 ? "warning" : "success";
      syncFilterOptions(file);
      renderTable(file);
    },
  };
}
