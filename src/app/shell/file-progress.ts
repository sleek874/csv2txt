interface FileProgress {
  current: number;
  phase: string;
  total: number;
  virtualPath: string;
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function fileProgressDetail(
  progress: FileProgress,
  labels: { processingVerb: string; finalizing: string },
): string {
  const action = progress.phase === "finalizing"
    ? labels.finalizing
    : `正在${labels.processingVerb} ${basename(progress.virtualPath)}`;
  return progress.total > 0
    ? `${action}，已完成 ${progress.current} / ${progress.total} 個檔案。`
    : `${action}。`;
}
