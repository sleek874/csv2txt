import { outputPath } from "../../../core/file-formats";
import type { OutputIssue } from "../../../core/output-validation";
import { activeWorkspaceItems } from "../../state/workspace-selectors";
import type {
  OutputPreparationState,
  WorkspaceFileRecord,
  WorkspaceSnapshot,
} from "../../state/workspace-types";

export interface OutputScopeSummary {
  downloadableRows: number;
  problemCount: number;
  selectedRows: number;
}

export interface OutputPlan {
  canDownload: boolean;
  files: readonly WorkspaceFileRecord[];
  omittedRowCount: number;
  outputIssues: readonly OutputIssue[];
  preparationError: string | null;
  preparationState: OutputPreparationState;
  problems: readonly string[];
  replacementRowCount: number;
  selectedLabel: string;
  selectedSummary: OutputScopeSummary;
  totalSummary: OutputScopeSummary & { fileCount: number };
}

export function createOutputPlan(snapshot: WorkspaceSnapshot): OutputPlan {
  const outputEntries = activeWorkspaceItems(snapshot);
  const files = outputEntries.flatMap((item) => item.file ? [item.file] : []);
  const outputIssues = files.flatMap((file) => (
    file.outputFormat === snapshot.outputFormat ? file.outputIssues : []
  ));
  const blockingOutputIssues = outputIssues.filter((issue) => issue.blocking);
  const preparationState = snapshot.outputPreparationState
    ?? (files.some((file) => file.outputFormat !== snapshot.outputFormat) ? "loading" : "ready");
  const issueRows = new Map<string, Set<number>>();
  blockingOutputIssues.forEach((issue) => {
    const rows = issueRows.get(issue.fileId) ?? new Set<number>();
    rows.add(issue.sourceRow);
    issueRows.set(issue.fileId, rows);
  });
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

  function scope(fileIds: ReadonlySet<string>): OutputScopeSummary {
    const scopeFiles = files.filter((file) => fileIds.has(file.id));
    const selectedRows = scopeFiles.reduce((total, file) => total + file.summary.includedRows, 0);
    const blockedRows = scopeFiles.reduce((total, file) => total + (issueRows.get(file.id)?.size ?? 0), 0);
    const problemKeys = new Set<string>();
    issueRows.forEach((rows, fileId) => {
      if (fileIds.has(fileId)) rows.forEach((row) => problemKeys.add(`row:${fileId}:${row}`));
    });
    outputEntries.filter((item) => fileIds.has(item.id)).forEach((item) => {
      if (item.file) {
        if (item.file.hasBlockingIssues) problemKeys.add(`file:${item.id}`);
        if (item.file.summary.includedRows === 0) problemKeys.add(`empty:${item.id}`);
      }
    });
    [...pathFiles].filter(([, ids]) => ids.length > 1 && ids.some((id) => fileIds.has(id)))
      .forEach(([path]) => problemKeys.add(`path:${path}`));
    return {
      downloadableRows: Math.max(0, selectedRows - blockedRows),
      problemCount: problemKeys.size,
      selectedRows,
    };
  }

  const allIds = new Set(outputEntries.map((item) => item.id));
  const selected = outputEntries.find((item) => item.id === snapshot.selectedFileId);
  const selectedIds = new Set(selected ? [selected.id] : []);

  return {
    canDownload: outputEntries.length > 0
      && preparationState === "ready"
      && problems.length === 0
      && blockingOutputIssues.length === 0,
    files,
    omittedRowCount: files.reduce(
      (total, file) => total + file.rowCount - file.summary.includedRows,
      0,
    ),
    outputIssues,
    preparationError: snapshot.outputPreparationError ?? null,
    preparationState,
    problems,
    replacementRowCount: files.reduce((total, file) => (
      total + (file.outputFormat === snapshot.outputFormat ? file.outputReplacementRows : 0)
    ), 0),
    selectedLabel: selected?.virtualPath.split("/").at(-1) ?? "尚未選擇檔案",
    selectedSummary: scope(selectedIds),
    totalSummary: { ...scope(allIds), fileCount: outputEntries.length },
  };
}
