import type { FileFormat, OutputFormat } from "../../core/file-formats";
import type { FileSummary } from "../../core/internal-model";
import type { OutputIssue } from "../../core/output-validation";

export type OutputPreparationState = "error" | "loading" | "ready";
export type WorkspaceSourceKind = "file" | "archive";

export interface WorkspaceSource {
  id: string;
  kind: WorkspaceSourceKind;
  name: string;
}

export interface WorkspaceFileRecord {
  blockingOutputIssues: readonly OutputIssue[];
  fileIssueMessages: readonly string[];
  hasBlockingIssues: boolean;
  id: string;
  outputBlockingRows: number;
  outputFormat: OutputFormat;
  outputIssues: readonly OutputIssue[];
  outputReplacementRows: number;
  rowCount: number;
  selectionRevision: number;
  summary: FileSummary;
  virtualPath: string;
}

export interface WorkspaceItem {
  file?: WorkspaceFileRecord;
  id: string;
  size: number;
  sourceId: string;
  sourceFormat: FileFormat;
  relativePath: string;
  unread?: boolean;
  virtualPath: string;
}

export interface WorkspaceSnapshot {
  files: readonly WorkspaceItem[];
  inputFormat: FileFormat;
  outputFormat: OutputFormat;
  outputPreparationError: string | null;
  outputPreparationState: OutputPreparationState;
  selectedFileId: string | null;
  sources: readonly WorkspaceSource[];
}
