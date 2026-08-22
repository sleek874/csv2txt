import type { OutputFormat } from "../../core/file-formats";
import {
  hasBlockingFileIssues,
  type DataIssue,
  type FileSummary,
  type InternalCell,
  type InternalFile,
  type InternalRow,
  type RejectedSourceRecord,
  type TransformationChange,
} from "../../core/internal-model";
import type { OutputIssue } from "../../core/output-validation";

const FIELD_COUNT = 15;
const DICTIONARY_LIMIT = 10;
const EMPTY_DATA_ISSUES: DataIssue[] = [];
const EMPTY_TRANSFORMATION_CHANGES: TransformationChange[] = [];
const DIGITS = ["", "1", "2", "3", "4", "5", "6"];
const LETTERS = ["", "A", "B", "C", "D"];
const TWO_DIGITS = Array.from({ length: 100 }, (_, value) => String(value).padStart(2, "0"));

interface CachedOutputIssues {
  issues: readonly OutputIssue[];
  selectionRevision: number;
}

export type CompactColumn =
  | { kind: "dictionary"; codes: Uint8Array; values: readonly string[] }
  | { kind: "packed"; codes: Uint8Array }
  | { kind: "strings"; values: readonly string[] };

export interface CompactCellDetail {
  finalValue?: string;
  issues?: DataIssue[];
  unpackedValue?: string;
}

export interface CompactRowDetail {
  changes?: TransformationChange[];
  issues?: DataIssue[];
}

export interface CompactFile {
  blankSourceRows: readonly number[];
  cellDetails: ReadonlyMap<number, CompactCellDetail>;
  columns: readonly CompactColumn[];
  fileIssues: readonly DataIssue[];
  hasBlockingIssues: boolean;
  id: string;
  included: Uint8Array;
  metadata: InternalFile["metadata"];
  orderedRowIndices: Uint32Array;
  outputCache: Map<OutputFormat, CachedOutputIssues>;
  ranks: Uint8Array;
  rejectedRecords: readonly RejectedSourceRecord[];
  rowDetails: ReadonlyMap<number, CompactRowDetail>;
  selectionRevision: number;
  sourceRows: Uint32Array;
  summary: FileSummary;
  virtualPath: string;
}

interface DictionaryBuilder {
  codes: Uint8Array;
  indices: Map<string, number>;
  values: string[];
}

type ColumnBuilder = DictionaryBuilder | string[] | Uint8Array;

function cellKey(rowIndex: number, columnIndex: number): number {
  return rowIndex * FIELD_COUNT + columnIndex;
}

function issueRank(issues: readonly DataIssue[]): number {
  if (issues.some((issue) => issue.severity === "error")) return 0;
  if (issues.some((issue) => issue.severity === "warning")) return 1;
  return 2;
}

function isPackedColumn(columnIndex: number): boolean {
  return columnIndex === 0
    || columnIndex === 1
    || columnIndex === 2
    || columnIndex === 7
    || columnIndex === 11
    || columnIndex === 14;
}

function packedCode(columnIndex: number, value: string): number {
  const first = value.charCodeAt(0);
  switch (columnIndex) {
    case 0: return value.length === 1 && first >= 65 && first <= 66 ? first - 64 : -1;
    case 1: {
      const second = value.charCodeAt(1);
      return value.length === 2 && first >= 48 && first <= 57 && second >= 48 && second <= 57
        ? (first - 48) * 10 + second - 48
        : -1;
    }
    case 2: return value.length === 1 && first >= 49 && first <= 54 ? first - 48 : -1;
    case 7: return value.length === 1 && first >= 49 && first <= 50 ? first - 48 : -1;
    case 11: return value.length === 1 && first >= 65 && first <= 68 ? first - 64 : -1;
    case 14: return value === "" ? 0 : value.length === 1 && first >= 49 && first <= 52 ? first - 48 : -1;
    default: return -1;
  }
}

function packedValue(columnIndex: number, code: number): string {
  switch (columnIndex) {
    case 0:
    case 11: return LETTERS[code] ?? "";
    case 1: return TWO_DIGITS[code] ?? "";
    case 2:
    case 7:
    case 14: return DIGITS[code] ?? "";
    default: return "";
  }
}

function dictionaryBuilder(rowCount: number): DictionaryBuilder {
  return { codes: new Uint8Array(rowCount), indices: new Map(), values: [] };
}

function addDictionaryValue(
  builder: DictionaryBuilder,
  value: string,
  rowIndex: number,
  rowCount: number,
): ColumnBuilder {
  const existing = builder.indices.get(value);
  if (existing !== undefined) {
    builder.codes[rowIndex] = existing;
    return builder;
  }
  if (builder.values.length < DICTIONARY_LIMIT - 1) {
    const code = builder.values.length;
    builder.values.push(value);
    builder.indices.set(value, code);
    builder.codes[rowIndex] = code;
    return builder;
  }
  const values = new Array<string>(rowCount);
  for (let index = 0; index < rowIndex; index += 1) {
    values[index] = builder.values[builder.codes[index]!] ?? "";
  }
  values[rowIndex] = value;
  return values;
}

function createCellDetail(cell: InternalCell, unpacked: boolean): CompactCellDetail | null {
  if (!unpacked && cell.finalValue === undefined && cell.issues.length === 0) return null;
  return {
    ...(cell.finalValue === undefined ? {} : { finalValue: cell.finalValue }),
    ...(cell.issues.length === 0 ? {} : { issues: cell.issues }),
    ...(unpacked ? { unpackedValue: cell.normalizedValue } : {}),
  };
}

export function compactInternalFile(file: InternalFile): CompactFile {
  const rowCount = file.rows.length;
  const builders: ColumnBuilder[] = Array.from(
    { length: FIELD_COUNT },
    (_, columnIndex) => isPackedColumn(columnIndex)
      ? new Uint8Array(rowCount)
      : dictionaryBuilder(rowCount),
  );
  const cellDetails = new Map<number, CompactCellDetail>();
  const rowDetails = new Map<number, CompactRowDetail>();
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
    if (row.issues.length > 0 || row.changes.length > 0) {
      rowDetails.set(rowIndex, {
        ...(row.changes.length === 0 ? {} : { changes: row.changes }),
        ...(row.issues.length === 0 ? {} : { issues: row.issues }),
      });
    }
    let rank = row.changes.length > 0 ? 1 : 2;
    rank = Math.min(rank, issueRank(fileIssuesBySourceRow.get(row.sourceRow) ?? EMPTY_DATA_ISSUES));
    rank = Math.min(rank, issueRank(row.issues));
    row.cells.forEach((cell, columnIndex) => {
      const builder = builders[columnIndex]!;
      let unpacked = false;
      if (builder instanceof Uint8Array) {
        const code = packedCode(columnIndex, cell.normalizedValue);
        if (code < 0) unpacked = true;
        else builder[rowIndex] = code;
      } else if (Array.isArray(builder)) {
        builder[rowIndex] = cell.normalizedValue;
      } else {
        builders[columnIndex] = addDictionaryValue(builder, cell.normalizedValue, rowIndex, rowCount);
      }
      const detail = createCellDetail(cell, unpacked);
      if (detail) cellDetails.set(cellKey(rowIndex, columnIndex), detail);
      rank = Math.min(rank, issueRank(cell.issues));
    });
    ranks[rowIndex] = rank;
  });
  const ordered = Array.from({ length: rowCount }, (_, index) => index)
    .sort((left, right) => ranks[left]! - ranks[right]! || sourceRows[left]! - sourceRows[right]!);
  const columns = builders.map((builder): CompactColumn => {
    if (builder instanceof Uint8Array) return { kind: "packed", codes: builder };
    if (Array.isArray(builder)) return { kind: "strings", values: builder };
    return { kind: "dictionary", codes: builder.codes, values: builder.values };
  });

  return {
    blankSourceRows: file.blankSourceRows,
    cellDetails,
    columns,
    fileIssues: file.issues,
    hasBlockingIssues: hasBlockingFileIssues(file),
    id: file.id,
    included,
    metadata: file.metadata,
    orderedRowIndices: Uint32Array.from(ordered),
    outputCache: new Map(),
    ranks,
    rejectedRecords: file.rejectedRecords,
    rowDetails,
    selectionRevision: 0,
    sourceRows,
    summary: file.summary,
    virtualPath: file.virtualPath,
  };
}

function baseValue(file: CompactFile, rowIndex: number, columnIndex: number, detail?: CompactCellDetail): string {
  if (detail?.unpackedValue !== undefined) return detail.unpackedValue;
  const column = file.columns[columnIndex];
  if (!column) return "";
  switch (column.kind) {
    case "dictionary": return column.values[column.codes[rowIndex]!] ?? "";
    case "packed": return packedValue(columnIndex, column.codes[rowIndex]!);
    case "strings": return column.values[rowIndex] ?? "";
  }
}

export function compactValue(file: CompactFile, rowIndex: number, columnIndex: number): string {
  const detail = compactCellDetail(file, rowIndex, columnIndex);
  return detail?.finalValue ?? baseValue(file, rowIndex, columnIndex, detail);
}

export function compactCellDetail(
  file: CompactFile,
  rowIndex: number,
  columnIndex: number,
): CompactCellDetail | undefined {
  return file.cellDetails.get(cellKey(rowIndex, columnIndex));
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
  const rowDetail = file.rowDetails.get(rowIndex);
  return {
    sourceRow: file.sourceRows[rowIndex]!,
    included: file.included[rowIndex] === 1,
    cells: Array.from({ length: FIELD_COUNT }, (_, columnIndex) => {
      const detail = file.cellDetails.get(cellKey(rowIndex, columnIndex));
      const finalValue = detail?.finalValue;
      return {
        fieldIndex: columnIndex + 1,
        normalizedValue: baseValue(file, rowIndex, columnIndex, detail),
        ...(finalValue === undefined ? {} : { finalValue }),
        issues: detail?.issues ?? EMPTY_DATA_ISSUES,
      };
    }),
    issues: rowDetail?.issues ?? EMPTY_DATA_ISSUES,
    changes: rowDetail?.changes ?? EMPTY_TRANSFORMATION_CHANGES,
  };
}
