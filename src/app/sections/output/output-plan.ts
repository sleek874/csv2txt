import { outputPath } from "../../../core/file-formats";
import { hasBlockingFileIssues, type InternalFile } from "../../../core/internal-model";
import { validateOutput, type OutputIssue } from "../../../core/output-validation";
import type { WorkspaceSnapshot } from "../../state/workspace-types";

export interface OutputScopeSummary {
  downloadableRows: number;
  problemCount: number;
  selectedRows: number;
}

export interface OutputPlan {
  canDownload: boolean;
  files: readonly InternalFile[];
  omittedRowCount: number;
  outputIssues: readonly OutputIssue[];
  problems: readonly string[];
  processingFileCount: number;
  selectedLabel: string;
  selectedSummary: OutputScopeSummary;
  totalSummary: OutputScopeSummary & { fileCount: number };
}

export function createOutputPlan(snapshot: WorkspaceSnapshot): OutputPlan {
  const outputEntries = snapshot.files.filter((item) => item.state !== "ignored");
  const files = snapshot.files.flatMap((item) => item.file ? [item.file] : []);
  const outputIssues = validateOutput(files, snapshot.outputFormat);
  const processingFileCount = snapshot.files.filter((item) => item.state === "processing").length;
  const issueRows = new Map<string, Set<number>>();
  outputIssues.forEach((issue) => {
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
    ...outputEntries.flatMap((item) => (
      item.state === "error" || (item.state !== "processing" && !item.file)
        ? [`${item.virtualPath}：無法讀取或解析。`]
        : []
    )),
    ...files.flatMap((file) => file.issues
      .filter((issue) => issue.severity === "error" && issue.sourceRow === undefined)
      .map((issue) => `${file.virtualPath}：${issue.message}`)),
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
      if (item.state === "error" || (item.state !== "processing" && !item.file)) {
        problemKeys.add(`failed:${item.id}`);
      } else if (item.file) {
        if (hasBlockingFileIssues(item.file)) problemKeys.add(`file:${item.id}`);
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
      && processingFileCount === 0
      && problems.length === 0
      && outputIssues.length === 0,
    files,
    omittedRowCount: files.reduce(
      (total, file) => total + file.rows.length - file.summary.includedRows,
      0,
    ),
    outputIssues,
    problems,
    processingFileCount,
    selectedLabel: selected?.virtualPath.split("/").at(-1) ?? "尚未選擇檔案",
    selectedSummary: scope(selectedIds),
    totalSummary: { ...scope(allIds), fileCount: outputEntries.length },
  };
}
