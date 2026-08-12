import type { FileFormat, OutputFormat } from "../../core/file-formats";
import type {
  OutputPreparationState,
  WorkspaceFileRecord,
  WorkspaceItem,
  WorkspaceSnapshot,
  WorkspaceSource,
} from "./workspace-types";

export interface WorkspaceModel {
  addBatch(sources: readonly WorkspaceSource[], items: readonly WorkspaceItem[]): void;
  clear(): void;
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
  setOutputFormat(format: OutputFormat, preparationState?: OutputPreparationState): void;
  setOutputPreparation(state: OutputPreparationState, error?: string | null): void;
  snapshot(): WorkspaceSnapshot;
  subscribe(listener: (snapshot: WorkspaceSnapshot) => void): () => void;
  update(fileId: string, update: (item: WorkspaceItem) => void): boolean;
  updateFileRecords(records: readonly WorkspaceFileRecord[]): number;
}

export function createWorkspaceModel(): WorkspaceModel {
  const entries: WorkspaceItem[] = [];
  const sources: WorkspaceSource[] = [];
  const listeners = new Set<(snapshot: WorkspaceSnapshot) => void>();
  let selectedFileId: string | null = null;
  let inputFormat: FileFormat = "txt";
  let outputFormat: OutputFormat = "big5-txt";
  let outputPreparationError: string | null = null;
  let outputPreparationState: OutputPreparationState = "ready";

  function currentSnapshot(): WorkspaceSnapshot {
    return {
      files: [...entries],
      inputFormat,
      outputFormat,
      outputPreparationError,
      outputPreparationState,
      selectedFileId,
      sources: [...sources],
    };
  }

  function emit(): void {
    const value = currentSnapshot();
    listeners.forEach((listener) => listener(value));
  }

  function normalizeSelection(): void {
    const active = entries.filter((entry) => entry.sourceFormat === inputFormat);
    if (selectedFileId && !active.some((entry) => entry.id === selectedFileId)) {
      selectedFileId = active[0]?.id ?? null;
    }
    selectedFileId ??= active[0]?.id ?? null;
  }

  return {
    addBatch(newSources, items) {
      const sourceIds = new Set(sources.map((source) => source.id));
      newSources.forEach((source) => {
        if (sourceIds.has(source.id)) throw new Error(`工作區來源重複：${source.id}`);
        sourceIds.add(source.id);
      });
      items.forEach((item) => {
        if (!sourceIds.has(item.sourceId)) throw new Error(`工作區來源不存在：${item.sourceId}`);
      });
      sources.push(...newSources);
      entries.push(...items);
      normalizeSelection();
      if (newSources.length > 0 || items.length > 0) emit();
    },
    clear() {
      entries.splice(0);
      sources.splice(0);
      selectedFileId = null;
      outputPreparationError = null;
      outputPreparationState = "ready";
      emit();
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
      if (!entry || entry.sourceFormat !== inputFormat) {
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
        && entry.sourceFormat === inputFormat
      )) ?? null;
    },
    setInputFormat(format) {
      if (inputFormat === format) return;
      inputFormat = format;
      normalizeSelection();
      emit();
    },
    setOutputFormat(format, preparationState = "ready") {
      if (outputFormat === format && outputPreparationState === preparationState) return;
      outputFormat = format;
      outputPreparationState = preparationState;
      outputPreparationError = null;
      emit();
    },
    setOutputPreparation(state, error = null) {
      if (outputPreparationState === state && outputPreparationError === error) return;
      outputPreparationState = state;
      outputPreparationError = error;
      emit();
    },
    markAllViewed() {
      const unread = entries.filter((entry) => entry.unread && entry.sourceFormat === inputFormat);
      unread.forEach((entry) => { entry.unread = false; });
      if (unread.length > 0) emit();
      return unread.length;
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
    updateFileRecords(records) {
      const byId = new Map(records.map((record) => [record.id, record]));
      let changed = 0;
      entries.forEach((item) => {
        const record = byId.get(item.id);
        if (!record) return;
        item.file = record;
        changed += 1;
      });
      if (changed > 0) emit();
      return changed;
    },
  };
}
