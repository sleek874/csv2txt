import {
  collectRowIssues,
  hasBlockingFileIssues,
  type InternalFile,
} from "../../../core/internal-model";
import type { WorkspaceSnapshot } from "../../state/workspace-types";

export interface OutputSummary {
  errorCount: number;
  excludedBlankRows: number;
  fileCount: number;
  includedRows: number;
  modifiedCount: number;
  sourceRows: number;
  warningCount: number;
}

export interface OutputPlan {
  blockingFileCount: number;
  canDownload: boolean;
  emptyFileCount: number;
  failedFileCount: number;
  files: readonly InternalFile[];
  forcedRowCount: number;
  omittedRowCount: number;
  processingFileCount: number;
  summary: OutputSummary;
}

export function createOutputPlan(snapshot: WorkspaceSnapshot): OutputPlan {
  const files = snapshot.files.flatMap((item) => item.file ? [item.file] : []);
  const processingFileCount = snapshot.files.filter((item) => item.state === "processing").length;
  const failedFileCount = snapshot.files.filter(
    (item) => item.state === "error" || (item.state !== "processing" && !item.file),
  ).length;
  const blockingFileCount = files.filter(hasBlockingFileIssues).length;
  const emptyFileCount = files.filter((file) => file.summary.includedRows === 0).length;
  const summary = files.reduce<OutputSummary>((total, file) => ({
    errorCount: total.errorCount + file.summary.errorCount,
    excludedBlankRows: total.excludedBlankRows + file.summary.excludedBlankRows,
    fileCount: total.fileCount,
    includedRows: total.includedRows + file.summary.includedRows,
    modifiedCount: total.modifiedCount + file.summary.modifiedCount,
    sourceRows: total.sourceRows + file.summary.sourceRows,
    warningCount: total.warningCount + file.summary.warningCount,
  }), {
    errorCount: failedFileCount,
    excludedBlankRows: 0,
    fileCount: snapshot.files.length,
    includedRows: 0,
    modifiedCount: 0,
    sourceRows: 0,
    warningCount: 0,
  });

  return {
    blockingFileCount,
    canDownload: snapshot.files.length > 0
      && processingFileCount === 0
      && failedFileCount === 0
      && blockingFileCount === 0
      && emptyFileCount === 0,
    emptyFileCount,
    failedFileCount,
    files,
    forcedRowCount: files.reduce((total, file) => total + file.rows.filter(
      (row) => row.included && collectRowIssues(row).length > 0,
    ).length, 0),
    omittedRowCount: files.reduce(
      (total, file) => total + file.rows.length - file.summary.includedRows,
      0,
    ),
    processingFileCount,
    summary,
  };
}
