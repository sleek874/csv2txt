import { requireDescendant } from "../../../browser/dom";
import { isPrivateUseCodePoint, UNRECOGNIZED_CHARACTER } from "../../../core/encoding";
import type { OutputIssue } from "../../../core/output-validation";
import {
  cellValue,
  collectRowIssues,
  issueFieldIndices,
  type DataIssue,
  type InternalFile,
  type InternalRow,
  type TransformationChange,
} from "../../../core/internal-model";

export type RowFilter = "all" | "error" | "warning" | "valid" | "excluded" | "output";

const PAGE_SIZE = 100;
const PREVIEW_ROW_SLOTS = 14;
const FILTERABLE_ROW_STATES: readonly RowFilter[] = [
  "error",
  "warning",
  "valid",
  "excluded",
  "output",
];

export function previewCellValue(value: string): string {
  return [...value].map((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && isPrivateUseCodePoint(codePoint)
      ? UNRECOGNIZED_CHARACTER
      : character;
  }).join("");
}

export function previewChangeDetail(
  change: Pick<TransformationChange, "after" | "before" | "fieldIndex">,
): string {
  const after = previewCellValue(change.after);
  return change.before === ""
    ? `欄位${change.fieldIndex}：空白已改為 ${after}。`
    : `欄位${change.fieldIndex}：${previewCellValue(change.before)} 已改為 ${after}。`;
}

export function visibleRowsSelectionState(
  rows: readonly Pick<InternalRow, "included">[],
): { checked: boolean; indeterminate: boolean } {
  const includedCount = rows.filter((row) => row.included).length;
  return {
    checked: rows.length > 0 && includedCount === rows.length,
    indeterminate: includedCount > 0 && includedCount < rows.length,
  };
}

export interface DataPreviewView {
  bind(options: {
    onVisibleRowsIncludedChange: (sourceRows: readonly number[], included: boolean) => void;
    onRowIncludedChange: (sourceRow: number, included: boolean) => void;
  }): void;
  clear(): void;
  render(file: InternalFile, outputIssues: readonly OutputIssue[]): void;
  setFilter(filter: RowFilter): void;
}

function rowIssues(row: InternalRow, file: InternalFile): DataIssue[] {
  return collectRowIssues(row, file.issues);
}

function outputIssuesForRow(row: InternalRow, outputIssues: readonly OutputIssue[]): OutputIssue[] {
  return outputIssues.filter((issue) => issue.sourceRow === row.sourceRow);
}

function rowMatches(
  row: InternalRow,
  file: InternalFile,
  outputIssues: readonly OutputIssue[],
  filter: RowFilter,
): boolean {
  const issues = rowIssues(row, file);
  switch (filter) {
    case "error": return issues.some((issue) => issue.severity === "error");
    case "warning": return !issues.some((issue) => issue.severity === "error")
      && (issues.some((issue) => issue.severity === "warning") || row.changes.length > 0);
    case "valid": return issues.length === 0 && row.changes.length === 0;
    case "excluded": return !row.included;
    case "output": return outputIssuesForRow(row, outputIssues).length > 0;
    case "all": return true;
  }
}

function rowRank(row: InternalRow, file: InternalFile): number {
  const issues = rowIssues(row, file);
  if (issues.some((issue) => issue.severity === "error")) return 0;
  if (issues.some((issue) => issue.severity === "warning") || row.changes.length > 0) return 1;
  return 2;
}

function rowStatus(
  row: InternalRow,
  file: InternalFile,
  outputIssues: readonly OutputIssue[],
): { label: string; tone: string } {
  const issues = rowIssues(row, file);
  if (issues.some((issue) => issue.severity === "error")) {
    return { label: "錯誤", tone: "error" };
  }
  if (outputIssuesForRow(row, outputIssues).length > 0) {
    return { label: "輸出問題", tone: "error" };
  }
  if (issues.some((issue) => issue.severity === "warning") || row.changes.length > 0) {
    return { label: "警告", tone: "warning" };
  }
  return { label: "正確", tone: "valid" };
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
  const rowFilter = requireDescendant<HTMLSelectElement>(root, "#row-filter");
  const visibleRowsCheckbox = requireDescendant<HTMLInputElement>(root, "#visible-rows-checkbox");
  const visibleRowsControl = requireDescendant<HTMLLabelElement>(root, ".row-output-heading-control");
  const tableBody = requireDescendant<HTMLTableSectionElement>(root, "#data-table-body");
  const pageStatus = requireDescendant<HTMLElement>(root, "#data-page-status");
  const previousButton = requireDescendant<HTMLButtonElement>(root, "#previous-page-button");
  const nextButton = requireDescendant<HTMLButtonElement>(root, "#next-page-button");
  const tableScroll = requireDescendant<HTMLElement>(root, ".data-table-scroll");
  let currentFile: InternalFile | null = null;
  let currentOutputIssues: readonly OutputIssue[] = [];
  let currentPage = 0;
  let visibleSourceRows: number[] = [];
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

  function syncFilterOptions(file: InternalFile, outputIssues: readonly OutputIssue[]): void {
    FILTERABLE_ROW_STATES.forEach((filter) => {
      const option = Array.from(rowFilter.options).find((candidate) => candidate.value === filter);
      if (option) option.disabled = !file.rows.some((row) => rowMatches(row, file, outputIssues, filter));
    });
    if (rowFilter.selectedOptions[0]?.disabled) rowFilter.value = "all";
  }

  function renderTable(file: InternalFile): void {
    const focusedSourceRow = document.activeElement instanceof HTMLInputElement
      ? document.activeElement.dataset.outputSourceRow
      : undefined;
    const filter = rowFilter.value as RowFilter;
    const filteredRows = file.rows
      .filter((row) => rowMatches(row, file, currentOutputIssues, filter))
      .sort((left, right) => rowRank(left, file) - rowRank(right, file) || left.sourceRow - right.sourceRow);
    const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, pageCount - 1);
    const pageStart = currentPage * PAGE_SIZE;
    const visibleRows = filteredRows.slice(pageStart, pageStart + PAGE_SIZE);
    visibleSourceRows = visibleRows.map((row) => row.sourceRow);
    const selection = visibleRowsSelectionState(visibleRows);
    visibleRowsCheckbox.checked = selection.checked;
    visibleRowsCheckbox.indeterminate = selection.indeterminate;
    visibleRowsCheckbox.disabled = visibleRows.length === 0;
    const selectionAction = selection.checked ? "取消選取" : "選取";
    const selectionLabel = `${selectionAction}目前篩選結果的本頁 ${visibleRows.length} 列`;
    visibleRowsCheckbox.setAttribute("aria-label", selectionLabel);
    visibleRowsControl.title = selectionLabel;
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
      const status = rowStatus(row, file, currentOutputIssues);
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
        ...rowIssues(row, file).map(issueDetail),
        ...row.changes.map(previewChangeDetail),
        ...outputIssuesForRow(row, currentOutputIssues)
          .map((issue) => `欄位${issue.fieldIndex}：${issue.message}`),
      ]);
      setDetail(statusText, rowDetails, `第 ${row.sourceRow} 列、${status.label}：${rowDetails.join("；")}`);
      statusCell.append(statusText);

      const outputCell = tableRow.insertCell();
      outputCell.className = "row-output-cell";
      const outputControl = document.createElement("label");
      outputControl.className = "row-output-control";
      const outputCheckbox = document.createElement("input");
      outputCheckbox.type = "checkbox";
      outputCheckbox.checked = row.included;
      outputCheckbox.dataset.outputSourceRow = String(row.sourceRow);
      outputCheckbox.setAttribute("aria-label", `輸出第 ${row.sourceRow} 列`);
      outputControl.append(outputCheckbox);
      outputCell.append(outputControl);

      row.cells.forEach((cell) => {
        const tableCell = tableRow.insertCell();
        const change = row.changes.find((item) => item.fieldIndex === cell.fieldIndex);
        const relatedIssues = row.issues.filter(
          (issue) => issueFieldIndices(issue).includes(cell.fieldIndex),
        );
        const cellIssues = [...cell.issues, ...relatedIssues];
        const outputCellIssues = currentOutputIssues.filter((issue) => (
          issue.sourceRow === row.sourceRow && issue.fieldIndex === cell.fieldIndex
        ));
        const value = document.createElement("span");
        value.className = "data-cell-value";
        const displayedValue = cellValue(cell);
        value.textContent = previewCellValue(displayedValue) || "∅";
        if (displayedValue === "") {
          value.classList.add("is-empty");
          value.setAttribute("aria-label", "空白");
        }
        if (cellIssues.some((item) => item.severity === "error") || outputCellIssues.length > 0) {
          tableCell.dataset.tone = "error";
        } else if (cellIssues.some((item) => item.severity === "warning")) {
          tableCell.dataset.tone = "warning";
        } else if (change) {
          tableCell.dataset.tone = "warning";
        }
        if (outputCellIssues.length > 0) {
          setDetail(
            value,
            outputCellIssues.map((issue) => issue.message),
            `第 ${row.sourceRow} 列、欄位${cell.fieldIndex}、輸出問題：${outputCellIssues.map((issue) => issue.message).join("；")}`,
          );
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
      ? "0 列"
      : `第 ${currentPage + 1} / ${pageCount} 頁 · ${pageStart + 1}–${pageStart + visibleRows.length} / ${filteredRows.length} 列`;
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
      visibleRowsCheckbox.addEventListener("change", () => (
        options.onVisibleRowsIncludedChange(visibleSourceRows, visibleRowsCheckbox.checked)
      ));
    },
    clear() {
      currentFile = null;
      currentOutputIssues = [];
      currentPage = 0;
      visibleSourceRows = [];
      rowFilter.value = "all";
      resetFilterOptions();
      previousButton.disabled = true;
      nextButton.disabled = true;
      visibleRowsCheckbox.checked = false;
      visibleRowsCheckbox.indeterminate = false;
      visibleRowsCheckbox.disabled = true;
      visibleRowsCheckbox.setAttribute("aria-label", "選取目前篩選結果的本頁資料列");
      visibleRowsControl.title = "";
      tableBody.replaceChildren();
      pageStatus.textContent = "";
      hideDetail();
      root.hidden = true;
    },
    render(file, outputIssues) {
      const sameFile = currentFile?.id === file.id;
      currentFile = file;
      currentOutputIssues = outputIssues;
      if (!sameFile) currentPage = 0;
      root.hidden = false;
      syncFilterOptions(file, outputIssues);
      renderTable(file);
    },
    setFilter(filter) {
      const option = Array.from(rowFilter.options).find((candidate) => candidate.value === filter);
      rowFilter.value = option && !option.disabled ? filter : "all";
      currentPage = 0;
      if (currentFile) renderTable(currentFile);
    },
  };
}
