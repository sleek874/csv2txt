import type { CreatedOutput } from "./output-artifact";
import type { WorkspaceFileRecord } from "../state/workspace-types";
import type { SourceFileType, OutputFormat } from "../../core/file-formats";
import type {
  DataIssue,
  InternalRow,
  RejectedSourceRecord,
} from "../../core/internal-model";
import type { OutputIssue } from "../../core/output-validation";
import type { HeaderedSpreadsheet } from "../../core/formats/spreadsheet";
import type { ArchiveDiscardReason } from "../../core/archive/types";

export type PreviewFilter =
  | "all"
  | "rejected"
  | "error"
  | "warning"
  | "valid"
  | "excluded"
  | "output";

export type PreviewRecord =
  | { kind: "data"; row: InternalRow }
  | { kind: "rejected"; record: RejectedSourceRecord };

export interface PreviewPage {
  fileId: string;
  fileIssues: readonly DataIssue[];
  filter: PreviewFilter;
  filterCounts: Readonly<Record<PreviewFilter, number>>;
  outputIssues: readonly OutputIssue[];
  page: number;
  pageCount: number;
  pageStart: number;
  records: readonly PreviewRecord[];
  totalRecords: number;
  virtualPath: string;
}

export interface ProcessedEntry {
  file: WorkspaceFileRecord;
  id: string;
  relativePath: string;
  size: number;
  sourceFormat: "txt" | "csv" | "xlsx";
  virtualPath: string;
}

export interface SkippedEntry {
  reason: ArchiveDiscardReason;
  relativePath: string;
  virtualPath: string;
}

export interface ProcessSourceResult {
  entries: readonly ProcessedEntry[];
  skippedEntries: readonly SkippedEntry[];
}

export interface AdvancedReferenceSummary {
  headers: readonly string[];
  issues: readonly string[];
  sheetName: string;
  sheetNames: readonly string[];
}

export interface AdvancedResultSummary {
  resultRowCount: number;
  selectedRowCount: number;
  unmatchedRowCount: number;
}

export type BatchRequest =
  | { type: "ping" }
  | {
      type: "process-source";
      workspaceEpoch: number;
      sourceId: string;
      sourceName: string;
      inputType: SourceFileType | "zip";
      bytes: Uint8Array;
      today: string;
      existingPaths: readonly string[];
      outputFormat: OutputFormat;
    }
  | { type: "cancel-source"; sourceId: string; workspaceEpoch: number }
  | { type: "reset-workspace"; workspaceEpoch: number }
  | { type: "preview-page"; fileId: string; filter: PreviewFilter; page: number; outputFormat: OutputFormat; workspaceEpoch: number }
  | { type: "set-row-included"; fileId: string; sourceRow: number; included: boolean; outputFormat: OutputFormat; workspaceEpoch: number }
  | { type: "set-rows-included"; fileId: string; sourceRows: readonly number[]; included: boolean; outputFormat: OutputFormat; workspaceEpoch: number }
  | { type: "refresh-output"; fileIds: readonly string[]; outputFormat: OutputFormat; workspaceEpoch: number }
  | { type: "cancel-output"; workspaceEpoch: number }
  | { type: "create-output"; fileIds: readonly string[]; outputFormat: OutputFormat; createdAt: string; workspaceEpoch: number }
  | { type: "discard-files"; fileIds: readonly string[]; workspaceEpoch: number }
  | { type: "remove-files"; fileIds: readonly string[]; workspaceEpoch: number }
  | { type: "restore-files"; fileIds: readonly string[]; workspaceEpoch: number }
  | { type: "inspect-reference"; bytes: Uint8Array }
  | { type: "clear-reference" }
  | { type: "select-reference-sheet"; sheetName: string }
  | { type: "advanced-result"; fileIds: readonly string[]; keyColumnIndex: number; selectedColumnIndices: readonly number[]; workspaceEpoch: number }
  | { type: "create-advanced-output"; fileIds: readonly string[]; keyColumnIndex: number; selectedColumnIndices: readonly number[]; createdAt: string; workspaceEpoch: number };

export type BatchResponseValue =
  | ProcessSourceResult
  | PreviewPage
  | WorkspaceFileRecord
  | readonly WorkspaceFileRecord[]
  | CreatedOutput
  | AdvancedReferenceSummary
  | AdvancedResultSummary
  | null;

export interface BatchRequestMessage {
  requestId: number;
  request: BatchRequest;
}

export type BatchWorkerMessage =
  | { type: "response"; requestId: number; value: BatchResponseValue }
  | { type: "error"; requestId: number; message: string }
  | { type: "fatal"; message: string }
  | ({ type: "output-progress"; requestId: number } & OutputProgress)
  | { type: "progress"; sourceId: string; current: number; total: number; virtualPath: string; phase: "extracting" | "processing" | "finalizing" };

export interface ProcessingProgress {
  current: number;
  phase: "extracting" | "processing" | "finalizing";
  sourceId: string;
  total: number;
  virtualPath: string;
}

export interface OutputProgress {
  current: number;
  phase: "processing" | "finalizing";
  total: number;
  virtualPath: string;
}

export interface StoredReference {
  bytes: Uint8Array;
  table: HeaderedSpreadsheet;
  sheetNames: readonly string[];
}
