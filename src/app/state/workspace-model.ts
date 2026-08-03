import type { OutputFormat } from "../../core/file-formats";
import { summarizeInternalFile } from "../../core/internal-model";
import type { WorkspaceItem, WorkspaceSnapshot, WorkspaceSource } from "./workspace-types";

export interface WorkspaceModel {
  add(item: WorkspaceItem): void;
  addSource(source: WorkspaceSource): void;
  clear(): void;
  hasPath(path: string): boolean;
  remove(fileId: string): WorkspaceItem | null;
  removeSource(sourceId: string): WorkspaceItem[];
  select(fileId: string): boolean;
  selectedItem(): WorkspaceItem | null;
  setOutputFormat(format: OutputFormat): void;
  setRowIncluded(sourceRow: number, included: boolean): boolean;
  snapshot(): WorkspaceSnapshot;
  subscribe(listener: (snapshot: WorkspaceSnapshot) => void): () => void;
  update(fileId: string, update: (item: WorkspaceItem) => void): boolean;
  updateSource(sourceId: string, update: (source: WorkspaceSource) => void): boolean;
}

export function createWorkspaceModel(): WorkspaceModel {
  const entries: WorkspaceItem[] = [];
  const sources: WorkspaceSource[] = [];
  const listeners = new Set<(snapshot: WorkspaceSnapshot) => void>();
  let selectedFileId: string | null = null;
  let outputFormat: OutputFormat = "big5-txt";

  function currentSnapshot(): WorkspaceSnapshot {
    return { files: [...entries], outputFormat, selectedFileId, sources: [...sources] };
  }

  function emit(): void {
    const value = currentSnapshot();
    listeners.forEach((listener) => listener(value));
  }

  function normalizeSelection(): void {
    if (selectedFileId && !entries.some((entry) => entry.id === selectedFileId)) {
      selectedFileId = entries[0]?.id ?? null;
    }
    selectedFileId ??= entries[0]?.id ?? null;
  }

  return {
    add(item) {
      if (!sources.some((source) => source.id === item.sourceId)) {
        throw new Error(`工作區來源不存在：${item.sourceId}`);
      }
      entries.push(item);
      selectedFileId ??= item.id;
      emit();
    },
    addSource(source) {
      if (sources.some((current) => current.id === source.id)) {
        throw new Error(`工作區來源重複：${source.id}`);
      }
      sources.push(source);
      emit();
    },
    clear() {
      entries.splice(0);
      sources.splice(0);
      selectedFileId = null;
      emit();
    },
    hasPath(path) {
      return entries.some((entry) => entry.virtualPath === path);
    },
    remove(fileId) {
      const index = entries.findIndex((entry) => entry.id === fileId);
      if (index < 0) {
        return null;
      }
      const [removed] = entries.splice(index, 1);
      if (removed && !entries.some((entry) => entry.sourceId === removed.sourceId)) {
        const sourceIndex = sources.findIndex((source) => source.id === removed.sourceId);
        if (sourceIndex >= 0) sources.splice(sourceIndex, 1);
      }
      if (selectedFileId === fileId) {
        selectedFileId = entries[index]?.id ?? entries[index - 1]?.id ?? null;
      }
      normalizeSelection();
      emit();
      return removed ?? null;
    },
    removeSource(sourceId) {
      const sourceIndex = sources.findIndex((source) => source.id === sourceId);
      if (sourceIndex < 0) return [];
      sources.splice(sourceIndex, 1);
      const removed = entries.filter((entry) => entry.sourceId === sourceId);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (entries[index]?.sourceId === sourceId) entries.splice(index, 1);
      }
      normalizeSelection();
      emit();
      return removed;
    },
    select(fileId) {
      if (!entries.some((entry) => entry.id === fileId)) {
        return false;
      }
      selectedFileId = fileId;
      emit();
      return true;
    },
    selectedItem() {
      return entries.find((entry) => entry.id === selectedFileId) ?? null;
    },
    setOutputFormat(format) {
      if (outputFormat === format) {
        return;
      }
      outputFormat = format;
      emit();
    },
    setRowIncluded(sourceRow, included) {
      const file = entries.find((entry) => entry.id === selectedFileId)?.file;
      const row = file?.rows.find((candidate) => candidate.sourceRow === sourceRow);
      if (!file || !row) {
        return false;
      }
      row.included = included;
      file.summary = summarizeInternalFile(
        file,
        file.summary.sourceRows,
        file.summary.excludedBlankRows,
      );
      emit();
      return true;
    },
    snapshot: currentSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(fileId, update) {
      const item = entries.find((entry) => entry.id === fileId);
      if (!item) {
        return false;
      }
      update(item);
      emit();
      return true;
    },
    updateSource(sourceId, update) {
      const source = sources.find((current) => current.id === sourceId);
      if (!source) return false;
      update(source);
      emit();
      return true;
    },
  };
}
