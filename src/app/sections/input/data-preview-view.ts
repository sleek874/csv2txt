import { requireDescendant } from "../../../browser/dom";
import type { PreviewFilter, PreviewPage, PreviewRecord } from "../../batch/protocol";
import { isPrivateUseCodePoint, UNRECOGNIZED_CHARACTER } from "../../../core/encoding";
import type { OutputIssue } from "../../../core/output-validation";
import { createStateTransition } from "../../shell/state-transition";
import {
  cellValue,
  collectRowIssues,
  issueFieldIndices,
  type DataIssue,
  type InternalFile,
  type InternalRow,
  type TransformationChange,
} from "../../../core/internal-model";

export type RowFilter = PreviewFilter;

const PREVIEW_ROW_SLOTS = 14;
const PREVIEW_COLUMN_COUNT = 18;
const ROW_FILTERS: readonly RowFilter[] = [
  "all",
  "rejected",
  "error",
  "warning",
  "valid",
  "excluded",
  "output",
];

export function previewCellValue(
  value: string,
  replacementCharacterIndices: readonly number[] = [],
): string {
  const replacements = new Set(replacementCharacterIndices);
  return [...value].map((character, characterIndex) => {
    const codePoint = character.codePointAt(0);
    return replacements.has(characterIndex)
      || (codePoint !== undefined && isPrivateUseCodePoint(codePoint))
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

export function previewCellIssues(
  row: InternalRow,
  fileIssues: readonly DataIssue[],
  fieldIndex: number,
): DataIssue[] {
  return collectRowIssues(row, fileIssues).filter(
    (issue) => issueFieldIndices(issue).includes(fieldIndex),
  );
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
    onPageRequest: (filter: RowFilter, page: number) => void;
    onVisibleRowsIncludedChange: (sourceRows: readonly number[], included: boolean) => void;
    onRowIncludedChange: (sourceRow: number, included: boolean) => void;
  }): void;
  clear(): void;
  fail(): "current" | "empty";
  freeze(): void;
  hasContent(): boolean;
  refresh(): void;
  render(page: PreviewPage): void;
  setFilter(filter: RowFilter): void;
}

function rowIssues(row: InternalRow, file: InternalFile): DataIssue[] {
  return collectRowIssues(row, file.issues);
}

function outputIssuesForRow(row: InternalRow, outputIssues: readonly OutputIssue[]): OutputIssue[] {
  return outputIssues.filter((issue) => issue.sourceRow === row.sourceRow);
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
  const rowOutputIssues = outputIssuesForRow(row, outputIssues);
  if (rowOutputIssues.some((issue) => issue.blocking)) {
    return { label: "輸出問題", tone: "error" };
  }
  if (rowOutputIssues.length > 0) return { label: "輸出提醒", tone: "warning" };
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

function privateUseDetails(row: InternalRow): string[] {
  return row.cells.flatMap((cell) => {
    const codePoints = [...new Set([...cellValue(cell)].flatMap((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && isPrivateUseCodePoint(codePoint)
        ? [`U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`]
        : [];
    }))];
    return codePoints.length > 0
      ? [`欄位${cell.fieldIndex}：■（${codePoints.join("、")}）沒有已確認的字元對照，請核對來源。`]
      : [];
  });
}

export function createDataPreviewView(root: HTMLElement): DataPreviewView {
  const rowFilter = requireDescendant<HTMLSelectElement>(root, "#row-filter");
  const filterLabels = new Map(
    Array.from(rowFilter.options, (option) => [option.value, option.textContent ?? ""]),
  );
  const visibleRowsCheckbox = requireDescendant<HTMLInputElement>(root, "#visible-rows-checkbox");
  const tableBody = requireDescendant<HTMLTableSectionElement>(root, "#data-table-body");
  const pageStatus = requireDescendant<HTMLElement>(root, "#data-page-status");
  const previousButton = requireDescendant<HTMLButtonElement>(root, "#previous-page-button");
  const nextButton = requireDescendant<HTMLButtonElement>(root, "#next-page-button");
  const transition = createStateTransition(root);
  let currentPageData: PreviewPage | null = null;
  let currentOutputIssues: readonly OutputIssue[] = [];
  let currentPage = 0;
  let visibleSourceRows: number[] = [];
  const expandedIssues = new Set<string>();
  let requestPage: (filter: RowFilter, page: number) => void = () => undefined;

  function setPending(pending: boolean): void {
    root.inert = pending;
    root.toggleAttribute("aria-busy", pending);
  }

  function requestPending(filter: RowFilter, page: number): void {
    setPending(true);
    requestPage(filter, page);
  }

  function resetFilterOptions(): void {
    Array.from(rowFilter.options).forEach((option) => {
      option.disabled = false;
      option.textContent = filterLabels.get(option.value) ?? option.textContent;
    });
  }

  function syncFilterOptions(page: PreviewPage): void {
    ROW_FILTERS.forEach((filter) => {
      const option = Array.from(rowFilter.options).find((candidate) => candidate.value === filter);
      if (!option) return;
      const count = page.filterCounts[filter];
      option.disabled = filter !== "all" && count === 0;
      option.textContent = `${filterLabels.get(filter) ?? option.textContent}（${count}）`;
    });
    if (rowFilter.selectedOptions[0]?.disabled) rowFilter.value = "all";
  }

  function renderTable(page: PreviewPage): void {
    const focusedSourceRow = document.activeElement instanceof HTMLInputElement
      ? document.activeElement.dataset.outputSourceRow
      : undefined;
    const visibleRecords: readonly PreviewRecord[] = page.records;
    const pageFile: InternalFile = {
      blankSourceRows: [],
      id: page.fileId,
      virtualPath: page.virtualPath,
      rows: visibleRecords.flatMap((record) => record.kind === "data" ? [record.row] : []),
      issues: [...page.fileIssues],
      summary: { blankRows: 0, correctRows: 0, dataRows: 0, errorRows: 0, includedRows: 0, rejectedRows: 0, sourceRecords: 0, warningRows: 0 },
      metadata: {},
      rejectedRecords: visibleRecords.flatMap((record) => record.kind === "rejected" ? [record.record] : []),
    };
    currentPage = page.page;
    currentOutputIssues = page.outputIssues;
    const visibleRows = visibleRecords.flatMap((record) => record.kind === "data" ? [record.row] : []);
    visibleSourceRows = visibleRows.map((row) => row.sourceRow);
    const selection = visibleRowsSelectionState(visibleRows);
    visibleRowsCheckbox.checked = selection.checked;
    visibleRowsCheckbox.indeterminate = selection.indeterminate;
    visibleRowsCheckbox.disabled = visibleRows.length === 0;
    const selectionAction = selection.checked ? "取消選取" : "選取";
    const selectionLabel = `${selectionAction}目前篩選結果的本頁 ${visibleRows.length} 列`;
    visibleRowsCheckbox.setAttribute("aria-label", selectionLabel);
    tableBody.replaceChildren();

    if (visibleRecords.length === 0) {
      const row = tableBody.insertRow();
      const cell = row.insertCell();
      cell.colSpan = PREVIEW_COLUMN_COUNT;
      cell.className = "empty-table-message";
      cell.textContent = "沒有符合目前篩選條件的資料列。";
    }

    function appendIssueToggle(
      cell: HTMLTableCellElement,
      label: string,
      issueId: string,
      ariaLabel: string,
    ): void {
      const button = document.createElement("button");
      button.className = "issue-disclosure-toggle preview-issue-toggle row-status-text";
      button.type = "button";
      button.textContent = label;
      button.dataset.issueId = issueId;
      button.setAttribute("aria-controls", issueId);
      button.setAttribute("aria-expanded", String(expandedIssues.has(issueId)));
      button.setAttribute("aria-label", ariaLabel);
      cell.append(button);
    }

    function appendProblemBlock(
      issueId: string,
      details: readonly string[],
      technical: readonly string[],
    ): void {
      if (details.length === 0) return;
      const issueRow = tableBody.insertRow();
      issueRow.className = "preview-issue-row";
      issueRow.id = issueId;
      issueRow.hidden = !expandedIssues.has(issueId);
      const issueCell = issueRow.insertCell();
      issueCell.colSpan = PREVIEW_COLUMN_COUNT;
      const block = document.createElement("div");
      block.className = "issue-detail-block preview-issue-block";
      const heading = document.createElement("strong");
      heading.textContent = "這列需要注意";
      const list = document.createElement("ul");
      details.forEach((detail) => {
        const item = document.createElement("li");
        item.textContent = detail;
        list.append(item);
      });
      block.append(heading, list);
      if (technical.length > 0) {
        const disclosure = document.createElement("details");
        const summary = document.createElement("summary");
        summary.className = "issue-disclosure-toggle technical-issue-toggle";
        summary.textContent = "查看技術資訊";
        const code = document.createElement("code");
        code.textContent = technical.join("\n");
        disclosure.append(summary, code);
        block.append(disclosure);
      }
      issueCell.append(block);
    }

    visibleRecords.forEach((record) => {
      if (record.kind === "rejected") {
        const rejected = record.record;
        const issueId = `preview-issue-${page.fileId}-rejected-${rejected.sourceRow}`;
        const tableRow = tableBody.insertRow();
        tableRow.dataset.tone = "error";
        const sourceRowCell = document.createElement("th");
        sourceRowCell.scope = "row";
        sourceRowCell.textContent = String(rejected.sourceRow);
        tableRow.append(sourceRowCell);
        const statusCell = tableRow.insertCell();
        statusCell.className = "row-status-cell";
        appendIssueToggle(
          statusCell,
          "無法解析",
          issueId,
          `展開第 ${rejected.sourceRow} 列無法解析的原因`,
        );
        const outputCell = tableRow.insertCell();
        outputCell.className = "row-output-cell";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.disabled = true;
        checkbox.setAttribute("aria-label", `第 ${rejected.sourceRow} 列無法解析，不能選取`);
        outputCell.append(checkbox);
        for (let fieldIndex = 1; fieldIndex <= 15; fieldIndex += 1) {
          const cell = tableRow.insertCell();
          cell.textContent = rejected.fieldIndex === fieldIndex ? "無法讀取" : "—";
        }
        appendProblemBlock(
          issueId,
          [rejected.message, `原始內容：${rejected.original}`],
          rejected.technicalDetail ? [rejected.technicalDetail] : [],
        );
        return;
      }

      const row = record.row;
      const issueId = `preview-issue-${page.fileId}-data-${row.sourceRow}`;
      const tableRow = tableBody.insertRow();
      const status = rowStatus(row, pageFile, currentOutputIssues);
      tableRow.dataset.tone = status.tone;
      const sourceRowCell = document.createElement("th");
      sourceRowCell.scope = "row";
      sourceRowCell.textContent = String(row.sourceRow);
      tableRow.append(sourceRowCell);

      const statusCell = tableRow.insertCell();
      statusCell.className = "row-status-cell";
      const puaDetails = privateUseDetails(row);
      const rowDetails = uniqueDetails([
        ...rowIssues(row, pageFile).map(issueDetail),
        ...row.changes.map(previewChangeDetail),
        ...outputIssuesForRow(row, currentOutputIssues)
          .map((issue) => `欄位${issue.fieldIndex}：${issue.message}`),
        ...puaDetails,
      ]);
      if (rowDetails.length > 0) {
        appendIssueToggle(
          statusCell,
          status.label,
          issueId,
          `展開第 ${row.sourceRow} 列的${status.label}內容`,
        );
      } else {
        statusCell.textContent = status.label;
      }

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
        const cellIssues = previewCellIssues(row, pageFile.issues, cell.fieldIndex);
        const outputCellIssues = currentOutputIssues.filter((issue) => (
          issue.sourceRow === row.sourceRow && issue.fieldIndex === cell.fieldIndex
        ));
        const value = document.createElement("span");
        value.className = "data-cell-value";
        const displayedValue = cellValue(cell);
        const replacementCharacterIndices = [
          ...cellIssues.flatMap((issue) => issue.replacementCharacterIndices ?? []),
          ...outputCellIssues.flatMap((issue) => issue.replacementCharacterIndices ?? []),
        ];
        value.textContent = previewCellValue(displayedValue, replacementCharacterIndices) || "∅";
        if (displayedValue === "") {
          value.classList.add("is-empty");
          value.setAttribute("aria-label", "空白");
        }
        if (
          cellIssues.some((item) => item.severity === "error")
          || outputCellIssues.some((item) => item.blocking)
        ) {
          tableCell.dataset.tone = "error";
        } else if (
          cellIssues.some((item) => item.severity === "warning")
          || outputCellIssues.length > 0
        ) {
          tableCell.dataset.tone = "warning";
        } else if (change) {
          tableCell.dataset.tone = "warning";
        }
        tableCell.append(value);
      });
      appendProblemBlock(
        issueId,
        rowDetails,
        uniqueDetails([
          ...rowIssues(row, pageFile).map((issue) => issue.technicalDetail ?? issue.code),
          ...outputIssuesForRow(row, currentOutputIssues).map((issue) => issue.code),
        ]),
      );
    });

    const renderedRowCount = Math.max(visibleRecords.length, 1);
    for (let index = renderedRowCount; index < PREVIEW_ROW_SLOTS; index += 1) {
      const placeholder = tableBody.insertRow();
      placeholder.className = "preview-placeholder-row";
      placeholder.setAttribute("aria-hidden", "true");
      for (let column = 0; column < PREVIEW_COLUMN_COUNT; column += 1) placeholder.insertCell();
    }

    pageStatus.textContent = page.totalRecords === 0
      ? "0 列"
      : `第 ${currentPage + 1} / ${page.pageCount} 頁 · ${page.pageStart + 1}–${page.pageStart + visibleRecords.length} / ${page.totalRecords} 列`;
    previousButton.disabled = currentPage === 0;
    nextButton.disabled = currentPage >= page.pageCount - 1;
    if (focusedSourceRow) {
      const replacement = Array.from(
        tableBody.querySelectorAll<HTMLInputElement>("[data-output-source-row]"),
      ).find((checkbox) => checkbox.dataset.outputSourceRow === focusedSourceRow);
      replacement?.focus({ preventScroll: true });
    }
  }

  return {
    bind(options) {
      requestPage = options.onPageRequest;
      tableBody.addEventListener("click", (event) => {
        const toggle = event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>("[data-issue-id]")
          : null;
        const issueId = toggle?.dataset.issueId;
        const issueRow = issueId ? document.getElementById(issueId) : null;
        if (!issueId || !issueRow) return;
        const expanded = issueRow.hidden;
        issueRow.hidden = !expanded;
        if (expanded) expandedIssues.add(issueId);
        else expandedIssues.delete(issueId);
        tableBody.querySelectorAll<HTMLButtonElement>("[data-issue-id]").forEach((button) => {
          if (button.dataset.issueId === issueId) {
            button.setAttribute("aria-expanded", String(expanded));
          }
        });
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
      rowFilter.addEventListener("change", () => {
        currentPage = 0;
        requestPending(rowFilter.value as RowFilter, 0);
      });
      previousButton.addEventListener("click", () => {
        if (currentPage > 0) requestPending(rowFilter.value as RowFilter, currentPage - 1);
      });
      nextButton.addEventListener("click", () => {
        if (currentPageData && currentPage < currentPageData.pageCount - 1) {
          requestPending(rowFilter.value as RowFilter, currentPage + 1);
        }
      });
      visibleRowsCheckbox.addEventListener("change", () => (
        options.onVisibleRowsIncludedChange(visibleSourceRows, visibleRowsCheckbox.checked)
      ));
    },
    clear() {
      setPending(false);
      transition.update("hidden");
      currentPageData = null;
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
      tableBody.replaceChildren();
      pageStatus.textContent = "";
      expandedIssues.clear();
      root.hidden = true;
    },
    fail() {
      if (!currentPageData) {
        setPending(false);
        return "empty";
      }
      setPending(false);
      pageStatus.textContent = "無法更新預覽，請再試一次。";
      transition.update("error");
      return "current";
    },
    freeze() {
      if (!currentPageData) return;
      setPending(true);
    },
    hasContent: () => currentPageData !== null,
    refresh() {
      if (currentPageData) requestPending(rowFilter.value as RowFilter, currentPage);
    },
    render(page) {
      const sameFile = currentPageData?.fileId === page.fileId;
      currentPageData = page;
      currentOutputIssues = page.outputIssues;
      if (!sameFile) currentPage = page.page;
      root.hidden = false;
      rowFilter.value = page.filter;
      syncFilterOptions(page);
      renderTable(page);
      setPending(false);
      transition.update(`${page.fileId}:${page.filter}:${page.page}`);
    },
    setFilter(filter) {
      const option = Array.from(rowFilter.options).find((candidate) => candidate.value === filter);
      rowFilter.value = option && !option.disabled ? filter : "all";
      currentPage = 0;
      requestPending(rowFilter.value as RowFilter, 0);
    },
  };
}
