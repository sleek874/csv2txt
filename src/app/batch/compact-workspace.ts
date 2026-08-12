import type { OutputFormat } from "../../core/file-formats";
import {
  hasBlockingFileIssues,
  type DataIssue,
  type FileSummary,
  type InternalFile,
  type InternalRow,
  type RejectedSourceRecord,
  type TransformationChange,
} from "../../core/internal-model";
import {
  type OutputIssue,
} from "../../core/output-validation";

const FIELD_COUNT = 15;
const EMPTY_DATA_ISSUES: DataIssue[] = [];
const EMPTY_TRANSFORMATION_CHANGES: TransformationChange[] = [];

interface CachedOutputIssues {
  issues: readonly OutputIssue[];
  selectionRevision: number;
}

export interface CompactFile {
  blankSourceRows: readonly number[];
  cellIssues: ReadonlyMap<number, DataIssue[]>;
  changes: ReadonlyMap<number, TransformationChange[]>;
  fileIssues: readonly DataIssue[];
  finalValues: ReadonlyMap<number, string>;
  hasBlockingIssues: boolean;
  id: string;
  included: Uint8Array;
  metadata: InternalFile["metadata"];
  normalizedColumns: readonly string[][];
  orderedRowIndices: Uint32Array;
  outputCache: Map<OutputFormat, CachedOutputIssues>;
  ranks: Uint8Array;
  rejectedRecords: readonly RejectedSourceRecord[];
  rowIssues: ReadonlyMap<number, DataIssue[]>;
  selectionRevision: number;
  sourceRows: Uint32Array;
  summary: FileSummary;
  virtualPath: string;
}

function cellKey(rowIndex: number, columnIndex: number): number {
  return rowIndex * FIELD_COUNT + columnIndex;
}

function issueRank(issues: readonly DataIssue[], changes: readonly TransformationChange[]): number {
  if (issues.some((issue) => issue.severity === "error")) return 0;
  if (issues.some((issue) => issue.severity === "warning") || changes.length > 0) return 1;
  return 2;
}

export function compactInternalFile(file: InternalFile): CompactFile {
  const rowCount = file.rows.length;
  const normalizedColumns = Array.from({ length: FIELD_COUNT }, () => new Array<string>(rowCount));
  const finalValues = new Map<number, string>();
  const cellIssues = new Map<number, DataIssue[]>();
  const rowIssues = new Map<number, DataIssue[]>();
  const changes = new Map<number, TransformationChange[]>();
  const sourceRows = new Uint32Array(rowCount);
  const included = new Uint8Array(rowCount);
  const ranks = new Uint8Array(rowCount);
  const fileIssuesBySourceRow = new Map<number, DataIssue[]>();
  file.issues.forEach((issue) => {
    if (issue.sourceRow === undefined) return;
    const current = fileIssuesBySourceRow.get(issue.sourceRow) ?? [];
    current.push(issue);
    fileIssuesBySourceRow.set(issue.sourceRow, current);
  });

  file.rows.forEach((row, rowIndex) => {
    sourceRows[rowIndex] = row.sourceRow;
    included[rowIndex] = row.included ? 1 : 0;
    if (row.issues.length > 0) rowIssues.set(rowIndex, row.issues);
    if (row.changes.length > 0) changes.set(rowIndex, row.changes);
    const combinedIssues = [...(fileIssuesBySourceRow.get(row.sourceRow) ?? []), ...row.issues];
    row.cells.forEach((cell, columnIndex) => {
      normalizedColumns[columnIndex]![rowIndex] = cell.normalizedValue;
      if (cell.finalValue !== undefined) finalValues.set(cellKey(rowIndex, columnIndex), cell.finalValue);
      if (cell.issues.length > 0) {
        cellIssues.set(cellKey(rowIndex, columnIndex), cell.issues);
        combinedIssues.push(...cell.issues);
      }
    });
    ranks[rowIndex] = issueRank(combinedIssues, row.changes);
  });
  const ordered = Array.from({ length: rowCount }, (_, index) => index)
    .sort((left, right) => ranks[left]! - ranks[right]! || sourceRows[left]! - sourceRows[right]!);

  return {
    blankSourceRows: file.blankSourceRows,
    cellIssues,
    changes,
    fileIssues: file.issues,
    finalValues,
    hasBlockingIssues: hasBlockingFileIssues(file),
    id: file.id,
    included,
    metadata: file.metadata,
    normalizedColumns,
    orderedRowIndices: Uint32Array.from(ordered),
    outputCache: new Map(),
    ranks,
    rejectedRecords: file.rejectedRecords,
    rowIssues,
    selectionRevision: 0,
    sourceRows,
    summary: file.summary,
    virtualPath: file.virtualPath,
  };
}

export function compactValue(file: CompactFile, rowIndex: number, columnIndex: number): string {
  return file.finalValues.get(cellKey(rowIndex, columnIndex))
    ?? file.normalizedColumns[columnIndex]?.[rowIndex]
    ?? "";
}

export function setCompactRowsIncluded(
  file: CompactFile,
  sourceRows: ReadonlySet<number>,
  included: boolean,
): number {
  let changed = 0;
  for (let rowIndex = 0; rowIndex < file.sourceRows.length; rowIndex += 1) {
    if (!sourceRows.has(file.sourceRows[rowIndex]!) || file.included[rowIndex] === Number(included)) continue;
    file.included[rowIndex] = Number(included);
    changed += 1;
  }
  if (changed > 0) {
    file.selectionRevision += 1;
    file.summary = { ...file.summary, includedRows: file.summary.includedRows + (included ? changed : -changed) };
    file.outputCache.clear();
  }
  return changed;
}

export function materializeCompactRow(file: CompactFile, rowIndex: number): InternalRow {
  return {
    sourceRow: file.sourceRows[rowIndex]!,
    included: file.included[rowIndex] === 1,
    cells: Array.from({ length: FIELD_COUNT }, (_, columnIndex) => {
      const finalValue = file.finalValues.get(cellKey(rowIndex, columnIndex));
      return {
        fieldIndex: columnIndex + 1,
        normalizedValue: file.normalizedColumns[columnIndex]?.[rowIndex] ?? "",
        ...(finalValue === undefined ? {} : { finalValue }),
        issues: file.cellIssues.get(cellKey(rowIndex, columnIndex)) ?? EMPTY_DATA_ISSUES,
      };
    }),
    issues: file.rowIssues.get(rowIndex) ?? EMPTY_DATA_ISSUES,
    changes: file.changes.get(rowIndex) ?? EMPTY_TRANSFORMATION_CHANGES,
  };
}
