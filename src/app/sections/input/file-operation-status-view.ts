import { requireDescendant } from "../../../browser/dom";
import { FILE_SIZE_LIMIT_LABEL } from "../../../core/file-size-policy";
import { FILE_FORMAT_LABELS, type FileFormat } from "../../../core/file-formats";
import type { ProcessingProgress } from "../../batch/protocol";
import { createStateTransition } from "../../shell/state-transition";

export type FileOperationTone = "error" | "neutral" | "success" | "warning";

export interface UploadFailureGroup {
  files: readonly string[];
  label: string;
  tone: "error" | "warning";
}

export type FileOperationStatus =
  | { kind: "idle" }
  | { kind: "processing"; progress: ProcessingProgress }
  | { kind: "cancelling" }
  | { kind: "result"; activeCount: number; activeFormat: FileFormat; failures: readonly UploadFailureGroup[]; otherCount: number }
  | { kind: "cancelled" }
  | { kind: "cleared" }
  | { kind: "removing" }
  | { kind: "restoring" }
  | { kind: "resetting" }
  | { kind: "error"; detail: string }
  | { kind: "removed"; detail: string; onUndo: () => void }
  | { kind: "restored"; detail: string };

export interface FileOperationStatusView {
  bind(options: { onCancel: () => void; onMarkAllViewed: () => void }): void;
  render(status: FileOperationStatus): void;
  setUnreadCount(count: number): void;
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function processingDetail(progress: ProcessingProgress): string {
  if (progress.phase === "extracting") return `正在整理 ${basename(progress.virtualPath)}。`;
  if (progress.phase === "finalizing") return "正在整理本次新增結果。";
  return progress.total > 0
    ? `正在檢查 ${basename(progress.virtualPath)}，已完成 ${progress.current} / ${progress.total} 個檔案。`
    : `正在檢查 ${basename(progress.virtualPath)}。`;
}

export function createFileOperationStatusView(root: HTMLElement): FileOperationStatusView {
  const box = requireDescendant<HTMLElement>(root, "#file-operation-status");
  const title = requireDescendant<HTMLElement>(box, "#file-operation-title");
  const detail = requireDescendant<HTMLElement>(box, "#file-operation-detail");
  const spinner = requireDescendant<HTMLElement>(box, "#file-operation-spinner");
  const cancel = requireDescendant<HTMLButtonElement>(box, "#cancel-file-operation");
  const undo = requireDescendant<HTMLButtonElement>(box, "#undo-file-operation");
  const markAllViewed = requireDescendant<HTMLButtonElement>(box, "#mark-all-viewed-button");
  const details = requireDescendant<HTMLDetailsElement>(box, "#file-operation-details");
  const detailsSummary = requireDescendant<HTMLElement>(box, "#file-operation-details-summary");
  const failures = requireDescendant<HTMLElement>(box, "#file-operation-failures");
  const copy = requireDescendant<HTMLElement>(box, ".file-operation-copy");
  const transition = createStateTransition(copy);
  let unreadCount = 0;
  let busy = false;
  let undoAction: (() => void) | null = null;

  function updateMarkAllViewed(): void {
    markAllViewed.hidden = busy || unreadCount === 0;
  }

  function setCopy(nextTitle: string, nextDetail: string, tone: FileOperationTone): void {
    title.textContent = nextTitle;
    detail.textContent = nextDetail;
    box.dataset.tone = tone;
  }

  return {
    bind(options) {
      cancel.addEventListener("click", options.onCancel);
      undo.addEventListener("click", () => undoAction?.());
      markAllViewed.addEventListener("click", options.onMarkAllViewed);
      document.addEventListener("pointerdown", (event) => {
        if (details.open && event.target instanceof Node && !details.contains(event.target)) {
          details.open = false;
        }
      });
      document.addEventListener("keydown", (event) => {
        if (details.open && event.key === "Escape") {
          details.open = false;
          detailsSummary.focus({ preventScroll: true });
        }
      });
    },
    render(status) {
      busy = status.kind === "processing"
        || status.kind === "cancelling"
        || status.kind === "removing"
        || status.kind === "restoring"
        || status.kind === "resetting";
      spinner.hidden = !busy;
      cancel.hidden = status.kind !== "processing";
      undo.hidden = status.kind !== "removed";
      details.hidden = true;
      details.open = false;
      failures.replaceChildren();
      undoAction = status.kind === "removed" ? status.onUndo : null;

      if (status.kind === "idle") setCopy("請加入檔案", `可加入 TXT、CSV、XLS、XLSX 或 ZIP；每個檔案上限 ${FILE_SIZE_LIMIT_LABEL}。`, "neutral");
      if (status.kind === "processing") setCopy("正在處理本次新增", processingDetail(status.progress), "neutral");
      if (status.kind === "cancelling") setCopy("正在取消本次新增", "正在停止處理並捨棄這次選取的結果。", "neutral");
      if (status.kind === "cancelled") setCopy("已取消本次新增", "這次選取的檔案都沒有加入；先前的檔案仍保留。", "neutral");
      if (status.kind === "cleared") setCopy("清單已清空", "電腦中的原始檔案沒有變更。", "neutral");
      if (status.kind === "removing") setCopy("正在從清單移除", "完成後可立即復原。", "neutral");
      if (status.kind === "restoring") setCopy("正在復原到清單", "完成後會重新顯示檔案與預覽。", "neutral");
      if (status.kind === "resetting") setCopy("正在清空清單", "正在停止目前工作並清除主要工作區。", "neutral");
      if (status.kind === "error") setCopy("無法完成檔案操作", status.detail, "error");
      if (status.kind === "removed") setCopy("已從清單移除", status.detail, "neutral");
      if (status.kind === "restored") setCopy("已復原到清單", status.detail, "success");
      if (status.kind === "result") {
        const failureCount = status.failures.reduce((total, group) => total + group.files.length, 0);
        const addedCount = status.activeCount + status.otherCount;
        const tone = status.failures.some((group) => group.tone === "error")
          ? "error"
          : failureCount > 0 ? "warning" : "success";
        const countDetail = `本次新增：${FILE_FORMAT_LABELS[status.activeFormat]} ${status.activeCount} 個已加入目前清單；${status.otherCount} 個已保留在「其他檔案」。`;
        setCopy(
          failureCount === 0 ? "檔案已加入" : addedCount > 0 ? "新增完成，有些項目未加入" : "這次沒有加入檔案",
          failureCount > 0 ? `${countDetail}另有 ${failureCount} 個未加入。` : countDetail,
          tone,
        );
        if (failureCount > 0) {
          detailsSummary.textContent = `查看 ${failureCount} 個未加入項目`;
          status.failures.forEach((group) => {
            const section = document.createElement("section");
            section.className = "upload-failure-group";
            section.dataset.tone = group.tone;
            const label = document.createElement("strong");
            label.textContent = group.label;
            const list = document.createElement("ul");
            group.files.forEach((file) => {
              const item = document.createElement("li");
              item.textContent = file;
              list.append(item);
            });
            section.append(label, list);
            failures.append(section);
          });
          details.hidden = false;
        }
      }
      updateMarkAllViewed();
      transition.update(status.kind === "processing"
        ? `processing:${status.progress.sourceId}:${status.progress.virtualPath}`
        : status.kind);
    },
    setUnreadCount(count) {
      unreadCount = count;
      updateMarkAllViewed();
    },
  };
}
