import type { OutputFormat } from "../../core/file-formats";
import type { InternalFile } from "../../core/internal-model";

export type WorkspaceFileState = "processing" | "ready" | "error" | "ignored";
export type WorkspaceIgnoredReason = "symlink" | "unsupported-type";
export type WorkspaceSourceKind = "file" | "archive";

export interface WorkspaceSource {
  id: string;
  kind: WorkspaceSourceKind;
  name: string;
}

export interface WorkspaceItem {
  error?: string;
  file?: InternalFile;
  id: string;
  ignoredReason?: WorkspaceIgnoredReason;
  size: number;
  sourceId: string;
  state: WorkspaceFileState;
  relativePath: string;
  unread?: boolean;
  virtualPath: string;
}

export interface WorkspaceSnapshot {
  files: readonly WorkspaceItem[];
  outputFormat: OutputFormat;
  selectedFileId: string | null;
  sources: readonly WorkspaceSource[];
}
