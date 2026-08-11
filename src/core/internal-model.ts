export type { OutputFormat } from "./file-formats";
export type IssueSeverity = "error" | "warning";
export type IssueStage = "adapter" | "source" | "final";

export interface DataIssue {
  severity: IssueSeverity;
  stage: IssueStage;
  code: string;
  message: string;
  replacementCharacterIndices?: readonly number[];
  sourceRow?: number;
  fieldIndex?: number;
  relatedFieldIndices?: readonly number[];
  technicalDetail?: string;
}

export function issueFieldIndices(issue: DataIssue): readonly number[] {
  return [...new Set([
    ...(issue.fieldIndex === undefined ? [] : [issue.fieldIndex]),
    ...(issue.relatedFieldIndices ?? []),
  ])];
}

export interface TransformationChange {
  kind: "telephone-default" | "private-use-recovery" | "id-gender-correction";
  sourceRow: number;
  fieldIndex: number;
  before: string;
  after: string;
  reason: string;
}

export interface InternalCell {
  fieldIndex: number;
  normalizedValue: string;
  sourceValue?: string;
  finalValue?: string;
  issues: DataIssue[];
}

export interface InternalRow {
  sourceRow: number;
  included: boolean;
  cells: InternalCell[];
  issues: DataIssue[];
  changes: TransformationChange[];
}

export interface FileSummary {
  blankRows: number;
  correctRows: number;
  dataRows: number;
  errorRows: number;
  includedRows: number;
  rejectedRows: number;
  sourceRecords: number;
  warningRows: number;
}

export interface RejectedSourceRecord {
  fieldIndex?: number;
  message: string;
  original: string;
  sourceRow: number;
  technicalDetail?: string;
}

export interface InternalFile {
  blankSourceRows: number[];
  id: string;
  virtualPath: string;
  rows: InternalRow[];
  issues: DataIssue[];
  summary: FileSummary;
  metadata: {
    decoderLabel?: string;
    sheetName?: string;
  };
  rejectedRecords: RejectedSourceRecord[];
}

export function cellValue(cell: InternalCell): string {
  return cell.finalValue ?? cell.normalizedValue;
}

export function collectIssues(file: Pick<InternalFile, "issues" | "rows">): DataIssue[] {
  return [
    ...file.issues,
    ...file.rows.flatMap((row) => [
      ...row.issues,
      ...row.cells.flatMap((cell) => cell.issues),
    ]),
  ];
}

export function collectRowIssues(
  row: InternalRow,
  fileIssues: readonly DataIssue[] = [],
): DataIssue[] {
  return [
    ...fileIssues.filter((issue) => issue.sourceRow === row.sourceRow),
    ...row.issues,
    ...row.cells.flatMap((cell) => cell.issues),
  ];
}

export function summarizeInternalFile(
  file: Pick<InternalFile, "blankSourceRows" | "issues" | "rejectedRecords" | "rows">,
  sourceRecords: number,
): FileSummary {
  const errorRows = new Set<number>();
  const warningRows = new Set<number>();

  for (const issue of collectIssues(file)) {
    if (issue.sourceRow === undefined) continue;
    if (issue.severity === "error") {
      errorRows.add(issue.sourceRow);
    } else {
      warningRows.add(issue.sourceRow);
    }
  }
  file.rows.filter((row) => row.changes.length > 0).forEach((row) => warningRows.add(row.sourceRow));
  errorRows.forEach((sourceRow) => warningRows.delete(sourceRow));
  const correctRows = Math.max(0, file.rows.length - errorRows.size - warningRows.size);

  return {
    blankRows: file.blankSourceRows.length,
    correctRows,
    dataRows: file.rows.length,
    errorRows: errorRows.size,
    includedRows: file.rows.filter((row) => row.included).length,
    rejectedRows: file.rejectedRecords.length,
    sourceRecords,
    warningRows: warningRows.size,
  };
}

export function hasBlockingFileIssues(file: InternalFile): boolean {
  return file.rejectedRecords.length > 0
    || file.issues.some((issue) => issue.severity === "error" && issue.sourceRow === undefined);
}
