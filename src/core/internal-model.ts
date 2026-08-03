export type OutputFormat = "big5-txt" | "xlsx";
export type IssueSeverity = "error" | "warning";
export type IssueStage = "adapter" | "source" | "final";

export interface DataIssue {
  severity: IssueSeverity;
  stage: IssueStage;
  code: string;
  message: string;
  sourceRow?: number;
  fieldIndex?: number;
}

export interface TransformationChange {
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
  sourceRows: number;
  includedRows: number;
  excludedBlankRows: number;
  errorCount: number;
  warningCount: number;
  modifiedCount: number;
}

export interface InternalFile {
  id: string;
  virtualPath: string;
  rows: InternalRow[];
  issues: DataIssue[];
  summary: FileSummary;
  metadata: {
    decoderLabel?: string;
    sheetName?: string;
  };
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

export function collectRowIssues(row: InternalRow): DataIssue[] {
  return [
    ...row.issues,
    ...row.cells.flatMap((cell) => cell.issues),
  ];
}

export function summarizeInternalFile(
  file: Pick<InternalFile, "issues" | "rows">,
  sourceRows: number,
  excludedBlankRows: number,
): FileSummary {
  const issues = collectIssues(file);
  return {
    sourceRows,
    includedRows: file.rows.filter((row) => row.included).length,
    excludedBlankRows,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    modifiedCount: file.rows.reduce((total, row) => total + row.changes.length, 0),
  };
}

export function hasBlockingFileIssues(file: InternalFile): boolean {
  return file.issues.some((issue) => issue.severity === "error");
}
