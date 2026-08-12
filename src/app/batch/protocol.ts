import type { CreatedOutput } from "../adapters/output-adapter";
import type { WorkspaceFileRecord } from "../state/workspace-types";
import type { SourceFileType, OutputFormat } from "../../core/file-formats";
import type {
  DataIssue,
  InternalRow,
  RejectedSourceRecord,
} from "../../core/internal-model";
import type { OutputIssue } from "../../core/output-validation";
import type { HeaderedSpreadsheet } from "../../core/formats/spreadsheet";

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
  reason: "symlink" | "unsupported-type";
  relativePath: string;
  virtualPath: string;
}

export interface ProcessSourceResult {
  entries: readonly ProcessedEntry[];
  skippedEntries: readonly SkippedEntry[];
}

export interface AdvancedReferenceSummary {
  headers: readonly string[];
  issueCount: number;
  sheetName: string;
  sheetNames: readonly string[];
}

export interface AdvancedResultSummary {
  matchedRowCount: number;
  resultRowCount: number;
  selectedRowCount: number;
  unmatchedRowCount: number;
}

export type BatchRequest =
  | {
      type: "process-source";
      sourceId: string;
      sourceName: string;
      inputType: SourceFileType | "zip";
      bytes: Uint8Array;
      today: string;
      existingPaths: readonly string[];
      outputFormat: OutputFormat;
    }
  | { type: "cancel-source"; sourceId: string }
  | { type: "clear-files" }
  | { type: "preview-page"; fileId: string; filter: PreviewFilter; page: number; outputFormat: OutputFormat }
  | { type: "set-row-included"; fileId: string; sourceRow: number; included: boolean; outputFormat: OutputFormat }
  | { type: "set-rows-included"; fileId: string; sourceRows: readonly number[]; included: boolean; outputFormat: OutputFormat }
  | { type: "refresh-output"; fileIds: readonly string[]; outputFormat: OutputFormat }
  | { type: "create-output"; fileIds: readonly string[]; outputFormat: OutputFormat; createdAt: string }
  | { type: "discard-files"; fileIds: readonly string[] }
  | { type: "remove-files"; fileIds: readonly string[] }
  | { type: "restore-files"; fileIds: readonly string[] }
  | { type: "inspect-reference"; bytes: Uint8Array }
  | { type: "clear-reference" }
  | { type: "select-reference-sheet"; sheetName: string }
  | { type: "advanced-result"; fileIds: readonly string[]; keyColumnIndex: number; selectedColumnIndices: readonly number[] }
  | { type: "create-advanced-output"; fileIds: readonly string[]; keyColumnIndex: number; selectedColumnIndices: readonly number[]; createdAt: string };

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
  | { type: "progress"; sourceId: string; current: number; total: number; virtualPath: string; phase: "extracting" | "processing" | "finalizing" };

export interface ProcessingProgress {
  current: number;
  phase: "extracting" | "processing" | "finalizing";
  sourceId: string;
  total: number;
  virtualPath: string;
}

export interface StoredReference {
  bytes: Uint8Array;
  table: HeaderedSpreadsheet;
  sheetNames: readonly string[];
}
