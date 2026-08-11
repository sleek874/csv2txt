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
  type RejectedSourceRecord,
  type TransformationChange,
} from "../../../core/internal-model";

export type RowFilter = "all" | "rejected" | "error" | "warning" | "valid" | "excluded" | "output";

const PAGE_SIZE = 100;
const PREVIEW_ROW_SLOTS = 14;
const PREVIEW_COLUMN_COUNT = 18;
const FILTERABLE_ROW_STATES: readonly RowFilter[] = [
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
    case "rejected": return false;
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

type PreviewRecord =
  | { kind: "data"; row: InternalRow }
  | { kind: "rejected"; record: RejectedSourceRecord };

export function createDataPreviewView(root: HTMLElement): DataPreviewView {
  const rowFilter = requireDescendant<HTMLSelectElement>(root, "#row-filter");
  const visibleRowsCheckbox = requireDescendant<HTMLInputElement>(root, "#visible-rows-checkbox");
  const tableBody = requireDescendant<HTMLTableSectionElement>(root, "#data-table-body");
  const pageStatus = requireDescendant<HTMLElement>(root, "#data-page-status");
  const previousButton = requireDescendant<HTMLButtonElement>(root, "#previous-page-button");
  const nextButton = requireDescendant<HTMLButtonElement>(root, "#next-page-button");
  let currentFile: InternalFile | null = null;
  let currentOutputIssues: readonly OutputIssue[] = [];
  let currentPage = 0;
  let visibleSourceRows: number[] = [];
  const expandedIssues = new Set<string>();

  function resetFilterOptions(): void {
    Array.from(rowFilter.options).forEach((option) => { option.disabled = false; });
  }

  function syncFilterOptions(file: InternalFile, outputIssues: readonly OutputIssue[]): void {
    FILTERABLE_ROW_STATES.forEach((filter) => {
      const option = Array.from(rowFilter.options).find((candidate) => candidate.value === filter);
      if (option) option.disabled = filter === "rejected"
        ? file.rejectedRecords.length === 0
        : !file.rows.some((row) => rowMatches(row, file, outputIssues, filter));
    });
    if (rowFilter.selectedOptions[0]?.disabled) rowFilter.value = "all";
  }

  function renderTable(file: InternalFile): void {
    const focusedSourceRow = document.activeElement instanceof HTMLInputElement
      ? document.activeElement.dataset.outputSourceRow
      : undefined;
    const filter = rowFilter.value as RowFilter;
    const dataRecords: PreviewRecord[] = file.rows
      .filter((row) => rowMatches(row, file, currentOutputIssues, filter))
      .sort((left, right) => rowRank(left, file) - rowRank(right, file) || left.sourceRow - right.sourceRow)
      .map((row) => ({ kind: "data", row }));
    const rejectedRecords: PreviewRecord[] = filter === "all" || filter === "rejected"
      ? file.rejectedRecords.map((record) => ({ kind: "rejected", record }))
      : [];
    const filteredRecords = filter === "rejected" ? rejectedRecords : [...rejectedRecords, ...dataRecords];
    const pageCount = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, pageCount - 1);
    const pageStart = currentPage * PAGE_SIZE;
    const visibleRecords = filteredRecords.slice(pageStart, pageStart + PAGE_SIZE);
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
      button.className = "preview-issue-toggle row-status-text";
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
      block.className = "preview-issue-block";
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
        const issueId = `preview-issue-${file.id}-rejected-${rejected.sourceRow}`;
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
      const issueId = `preview-issue-${file.id}-data-${row.sourceRow}`;
      const tableRow = tableBody.insertRow();
      const status = rowStatus(row, file, currentOutputIssues);
      tableRow.dataset.tone = status.tone;
      const sourceRowCell = document.createElement("th");
      sourceRowCell.scope = "row";
      sourceRowCell.textContent = String(row.sourceRow);
      tableRow.append(sourceRowCell);

      const statusCell = tableRow.insertCell();
      statusCell.className = "row-status-cell";
      const puaDetails = privateUseDetails(row);
      const rowDetails = uniqueDetails([
        ...rowIssues(row, file).map(issueDetail),
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
        const cellIssues = previewCellIssues(row, file.issues, cell.fieldIndex);
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
          ...rowIssues(row, file).map((issue) => issue.technicalDetail ?? issue.code),
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

    pageStatus.textContent = filteredRecords.length === 0
      ? "0 列"
      : `第 ${currentPage + 1} / ${pageCount} 頁 · ${pageStart + 1}–${pageStart + visibleRecords.length} / ${filteredRecords.length} 列`;
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
      tableBody.replaceChildren();
      pageStatus.textContent = "";
      expandedIssues.clear();
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
