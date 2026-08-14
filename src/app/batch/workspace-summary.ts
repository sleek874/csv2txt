import type { OutputFormat } from "../../core/file-formats";
import {
  validateOutputRows,
  type OutputIssue,
  type OutputValidationRow,
} from "../../core/output-validation";
import type { WorkspaceFileRecord } from "../state/workspace-types";
import { compactValue, type CompactFile } from "./compact-workspace";

const FIELD_COUNT = 15;

function* validationRows(file: CompactFile): Iterable<OutputValidationRow> {
  for (let rowIndex = 0; rowIndex < file.sourceRows.length; rowIndex += 1) {
    yield {
      included: file.included[rowIndex] === 1,
      sourceRow: file.sourceRows[rowIndex]!,
      values: Array.from({ length: FIELD_COUNT }, (_, columnIndex) => compactValue(file, rowIndex, columnIndex)),
    };
  }
}

export function compactOutputIssues(file: CompactFile, format: OutputFormat): readonly OutputIssue[] {
  const cached = file.outputCache.get(format);
  if (cached?.selectionRevision === file.selectionRevision) return cached.issues;
  const issues = validateOutputRows([{
    id: file.id,
    rows: validationRows(file),
    virtualPath: file.virtualPath,
  }], format);
  file.outputCache.set(format, { issues, selectionRevision: file.selectionRevision });
  return issues;
}

export function compactFileRecord(file: CompactFile, outputFormat: OutputFormat): WorkspaceFileRecord {
  const outputIssues = compactOutputIssues(file, outputFormat);
  const blockingOutputIssues = outputIssues.filter((issue) => issue.blocking);
  return {
    blockingOutputIssues,
    fileIssueMessages: file.fileIssues
      .filter((issue) => issue.severity === "error" && issue.sourceRow === undefined)
      .map((issue) => issue.message),
    id: file.id,
    outputFormat,
    outputReplacementRows: new Set(outputIssues.filter((issue) => !issue.blocking).map((issue) => issue.sourceRow)).size,
    selectionRevision: file.selectionRevision,
    summary: file.summary,
    virtualPath: file.virtualPath,
  };
}
