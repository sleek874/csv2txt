import type { FileFormat, OutputFormat } from "../../core/file-formats";
import { summarizeInternalFile } from "../../core/internal-model";
import type { WorkspaceItem, WorkspaceSnapshot, WorkspaceSource } from "./workspace-types";

export interface WorkspaceModel {
  add(item: WorkspaceItem): void;
  addSource(source: WorkspaceSource): void;
  clear(): void;
  hasPath(path: string): boolean;
  remove(fileId: string): WorkspaceItem | null;
  removeSource(sourceId: string): WorkspaceItem[];
  restore(
    item: WorkspaceItem,
    source: WorkspaceSource,
    fileIndex: number,
    sourceIndex: number,
    selected: boolean,
  ): boolean;
  restoreSource(
    source: WorkspaceSource,
    items: readonly { index: number; item: WorkspaceItem }[],
    sourceIndex: number,
    previousSelectedFileId: string | null,
  ): boolean;
  select(fileId: string): boolean;
  selectedItem(): WorkspaceItem | null;
  markAllViewed(): number;
  setInputFormat(format: FileFormat): void;
  setOutputFormat(format: OutputFormat): void;
  setRowsIncluded(sourceRows: readonly number[], included: boolean): number;
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
  let inputFormat: FileFormat = "txt";
  let outputFormat: OutputFormat = "big5-txt";

  function currentSnapshot(): WorkspaceSnapshot {
    return { files: [...entries], inputFormat, outputFormat, selectedFileId, sources: [...sources] };
  }

  function emit(): void {
    const value = currentSnapshot();
    listeners.forEach((listener) => listener(value));
  }

  function normalizeSelection(): void {
    const active = entries.filter((entry) => (
      entry.state !== "ignored" && entry.sourceFormat === inputFormat
    ));
    if (selectedFileId && !active.some((entry) => entry.id === selectedFileId)) {
      selectedFileId = active[0]?.id ?? null;
    }
    selectedFileId ??= active[0]?.id ?? null;
  }

  function refreshSummary(file: NonNullable<WorkspaceItem["file"]>): void {
    file.summary = summarizeInternalFile(file, file.summary.sourceRecords);
  }

  return {
    add(item) {
      if (!sources.some((source) => source.id === item.sourceId)) {
        throw new Error(`工作區來源不存在：${item.sourceId}`);
      }
      entries.push(item);
      if (item.state !== "ignored" && item.sourceFormat === inputFormat) {
        selectedFileId ??= item.id;
      }
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
    restore(item, source, fileIndex, sourceIndex, selected) {
      if (entries.some((entry) => entry.id === item.id)) return false;
      if (!sources.some((current) => current.id === source.id)) {
        sources.splice(Math.min(Math.max(sourceIndex, 0), sources.length), 0, source);
      }
      entries.splice(Math.min(Math.max(fileIndex, 0), entries.length), 0, item);
      if (selected) selectedFileId = item.id;
      normalizeSelection();
      emit();
      return true;
    },
    restoreSource(source, items, sourceIndex, previousSelectedFileId) {
      if (sources.some((current) => current.id === source.id)) return false;
      if (items.some(({ item }) => entries.some((entry) => entry.id === item.id))) return false;
      sources.splice(Math.min(Math.max(sourceIndex, 0), sources.length), 0, source);
      [...items]
        .sort((left, right) => left.index - right.index)
        .forEach(({ index, item }) => {
          entries.splice(Math.min(Math.max(index, 0), entries.length), 0, item);
        });
      if (previousSelectedFileId && entries.some((entry) => entry.id === previousSelectedFileId)) {
        selectedFileId = previousSelectedFileId;
      }
      normalizeSelection();
      emit();
      return true;
    },
    select(fileId) {
      const entry = entries.find((candidate) => candidate.id === fileId);
      if (!entry || entry.state === "ignored" || entry.sourceFormat !== inputFormat) {
        return false;
      }
      selectedFileId = fileId;
      entry.unread = false;
      emit();
      return true;
    },
    selectedItem() {
      return entries.find((entry) => (
        entry.id === selectedFileId
        && entry.state !== "ignored"
        && entry.sourceFormat === inputFormat
      )) ?? null;
    },
    setInputFormat(format) {
      if (inputFormat === format) return;
      inputFormat = format;
      normalizeSelection();
      emit();
    },
    setOutputFormat(format) {
      if (outputFormat === format) {
        return;
      }
      outputFormat = format;
      emit();
    },
    markAllViewed() {
      const unread = entries.filter((entry) => entry.unread && entry.sourceFormat === inputFormat);
      unread.forEach((entry) => { entry.unread = false; });
      if (unread.length > 0) emit();
      return unread.length;
    },
    setRowsIncluded(sourceRows, included) {
      const file = entries.find((entry) => entry.id === selectedFileId)?.file;
      if (!file) return 0;
      const selectedSourceRows = new Set(sourceRows);
      const rows = file.rows.filter(
        (row) => selectedSourceRows.has(row.sourceRow) && row.included !== included,
      );
      if (rows.length === 0) return 0;
      rows.forEach((row) => { row.included = included; });
      refreshSummary(file);
      emit();
      return rows.length;
    },
    setRowIncluded(sourceRow, included) {
      const file = entries.find((entry) => entry.id === selectedFileId)?.file;
      const row = file?.rows.find((candidate) => candidate.sourceRow === sourceRow);
      if (!file || !row) {
        return false;
      }
      row.included = included;
      refreshSummary(file);
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
