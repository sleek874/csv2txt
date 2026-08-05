export type { OutputFormat } from "./file-formats";
export type IssueSeverity = "error" | "warning";
export type IssueStage = "adapter" | "source" | "final";

export interface DataIssue {
  severity: IssueSeverity;
  stage: IssueStage;
  code: string;
  message: string;
  sourceRow?: number;
  fieldIndex?: number;
  relatedFieldIndices?: readonly number[];
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
  sourceRows: number;
  includedRows: number;
  outputRows: number;
  errorCount: number;
  warningCount: number;
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
  file: Pick<InternalFile, "issues" | "rows">,
  sourceRows: number,
): FileSummary {
  const errorRows = new Set<number>();
  const warningRows = new Set<number>();
  let fileErrors = 0;
  let fileWarnings = 0;

  for (const issue of collectIssues(file)) {
    if (issue.sourceRow === undefined) {
      if (issue.severity === "error") fileErrors += 1;
      else fileWarnings += 1;
    } else if (issue.severity === "error") {
      errorRows.add(issue.sourceRow);
    } else {
      warningRows.add(issue.sourceRow);
    }
  }
  file.rows.filter((row) => row.changes.length > 0).forEach((row) => warningRows.add(row.sourceRow));
  errorRows.forEach((sourceRow) => warningRows.delete(sourceRow));

  return {
    sourceRows,
    includedRows: file.rows.filter((row) => row.included).length,
    outputRows: Math.max(0, sourceRows - errorRows.size - warningRows.size),
    errorCount: fileErrors + errorRows.size,
    warningCount: fileWarnings + warningRows.size,
  };
}

export function hasBlockingFileIssues(file: InternalFile): boolean {
  return file.issues.some((issue) => issue.severity === "error" && issue.sourceRow === undefined);
}
