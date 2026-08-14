import { outputPath } from "../../../core/file-formats";
import type { OutputIssue } from "../../../core/output-validation";
import { canonicalActiveWorkspaceItems } from "../../state/workspace-selectors";
import type {
  WorkspaceFileRecord,
  WorkspaceSnapshot,
} from "../../state/workspace-types";

export type OutputPreparationState = "error" | "loading" | "ready";

export interface OutputPlan {
  canDownload: boolean;
  files: readonly WorkspaceFileRecord[];
  hasProblems: boolean;
  outputIssues: readonly OutputIssue[];
  preparationError: string | null;
  preparationState: OutputPreparationState;
  problems: readonly string[];
  replacementRowCount: number;
  totalSummary: { fileCount: number; selectedRows: number };
}

export function createOutputPlan(
  snapshot: WorkspaceSnapshot,
  preparationState: OutputPreparationState = "ready",
  preparationError: string | null = null,
): OutputPlan {
  const outputEntries = canonicalActiveWorkspaceItems(snapshot);
  const files = outputEntries.flatMap((item) => item.file ? [item.file] : []);
  const blockingOutputIssues = files.flatMap((file) => (
    file.outputFormat === snapshot.outputFormat ? file.blockingOutputIssues : []
  ));
  const effectivePreparationState = files.some((file) => file.outputFormat !== snapshot.outputFormat)
    ? preparationState === "error" ? "error" : "loading"
    : preparationState;
  const pathFiles = new Map<string, string[]>();
  files.forEach((file) => {
    const path = outputPath(file.virtualPath, snapshot.outputFormat);
    pathFiles.set(path, [...(pathFiles.get(path) ?? []), file.id]);
  });
  const problems = [
    ...files.flatMap((file) => file.fileIssueMessages
      .map((message) => `${file.virtualPath}：${message}`)),
    ...files.flatMap((file) => file.summary.rejectedRows > 0
      ? [`${file.virtualPath}：有 ${file.summary.rejectedRows} 列無法解析，請修正來源或移除此檔案。`]
      : []),
    ...files.flatMap((file) => file.summary.includedRows === 0
      ? [`${file.virtualPath}：尚未勾選輸出列。`]
      : []),
    ...[...pathFiles].flatMap(([path, ids]) => ids.length > 1
      ? [`輸出路徑重複：${path}`]
      : []),
  ];

  const hasProblems = problems.length > 0 || blockingOutputIssues.length > 0;

  return {
    canDownload: outputEntries.length > 0
      && effectivePreparationState === "ready"
      && !hasProblems,
    files,
    hasProblems,
    outputIssues: blockingOutputIssues,
    preparationError,
    preparationState: effectivePreparationState,
    problems,
    replacementRowCount: files.reduce((total, file) => (
      total + (file.outputFormat === snapshot.outputFormat ? file.outputReplacementRows : 0)
    ), 0),
    totalSummary: {
      fileCount: outputEntries.length,
      selectedRows: files.reduce((total, file) => total + file.summary.includedRows, 0),
    },
  };
}
