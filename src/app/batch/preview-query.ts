import type { OutputFormat } from "../../core/file-formats";
import { materializeCompactRow, type CompactFile } from "./compact-workspace";
import type { PreviewFilter, PreviewPage, PreviewRecord } from "./protocol";
import { compactOutputIssues } from "./workspace-summary";

const PAGE_SIZE = 100;

export function queryPreviewPage(
  file: CompactFile,
  filter: PreviewFilter,
  requestedPage: number,
  outputFormat: OutputFormat,
): PreviewPage {
  const outputIssues = compactOutputIssues(file, outputFormat);
  const outputRows = new Set(outputIssues.map((issue) => issue.sourceRow));
  const matchingIndices: number[] = [];
  file.orderedRowIndices.forEach((rowIndex) => {
    const matches = (() => {
      switch (filter) {
        case "all": return true;
        case "rejected": return false;
        case "error": return file.ranks[rowIndex] === 0;
        case "warning": return file.ranks[rowIndex] === 1;
        case "valid": return file.ranks[rowIndex] === 2;
        case "excluded": return file.included[rowIndex] === 0;
        case "output": return outputRows.has(file.sourceRows[rowIndex]!);
      }
    })();
    if (matches) matchingIndices.push(rowIndex);
  });
  const counts = {
    all: file.rejectedRecords.length + file.sourceRows.length,
    rejected: file.rejectedRecords.length,
    error: file.summary.errorRows,
    warning: file.summary.warningRows,
    valid: file.summary.correctRows,
    excluded: file.sourceRows.length - file.summary.includedRows,
    output: outputRows.size,
  } satisfies Record<PreviewFilter, number>;
  const rejectedCount = filter === "all" || filter === "rejected" ? file.rejectedRecords.length : 0;
  const dataCount = filter === "rejected" ? 0 : matchingIndices.length;
  const totalRecords = rejectedCount + dataCount;
  const pageCount = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));
  const page = Math.max(0, Math.min(requestedPage, pageCount - 1));
  const pageStart = page * PAGE_SIZE;
  const pageRecords: PreviewRecord[] = [];
  const pageEnd = Math.min(pageStart + PAGE_SIZE, totalRecords);
  for (let logicalIndex = pageStart; logicalIndex < pageEnd; logicalIndex += 1) {
    if (logicalIndex < rejectedCount) {
      const record = file.rejectedRecords[logicalIndex];
      if (record) pageRecords.push({ kind: "rejected", record });
      continue;
    }
    const rowIndex = matchingIndices[logicalIndex - rejectedCount];
    if (rowIndex !== undefined) pageRecords.push({ kind: "data", row: materializeCompactRow(file, rowIndex) });
  }
  const sourceRows = new Set(pageRecords.flatMap((record) => (
    record.kind === "data" ? [record.row.sourceRow] : [record.record.sourceRow]
  )));
  return {
    fileId: file.id,
    fileIssues: file.fileIssues.filter((issue) => issue.sourceRow === undefined || sourceRows.has(issue.sourceRow)),
    filter,
    filterCounts: counts,
    outputIssues: outputIssues.filter((issue) => sourceRows.has(issue.sourceRow)),
    page,
    pageCount,
    pageStart,
    records: pageRecords,
    totalRecords,
    virtualPath: file.virtualPath,
  };
}
