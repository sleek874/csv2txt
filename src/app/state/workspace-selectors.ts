import type { WorkspaceItem, WorkspaceSnapshot } from "./workspace-types";

export function activeWorkspaceItems(snapshot: WorkspaceSnapshot): WorkspaceItem[] {
  return snapshot.files.filter((item) => item.sourceFormat === snapshot.inputFormat);
}

export function otherWorkspaceItems(snapshot: WorkspaceSnapshot): WorkspaceItem[] {
  const activeIds = new Set(activeWorkspaceItems(snapshot).map((item) => item.id));
  return snapshot.files.filter((item) => !activeIds.has(item.id));
}

export function activeWorkspaceSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const files = activeWorkspaceItems(snapshot);
  const sourceIds = new Set(files.map((file) => file.sourceId));
  return {
    ...snapshot,
    files,
    selectedFileId: files.some((file) => file.id === snapshot.selectedFileId)
      ? snapshot.selectedFileId
      : files[0]?.id ?? null,
    sources: snapshot.sources.filter((source) => sourceIds.has(source.id)),
  };
}
