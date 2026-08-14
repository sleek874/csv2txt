import { downloadBytes } from "../../../browser/download";
import { requireDescendant, requireElement } from "../../../browser/dom";
import { FILE_FORMAT_LABELS, fileFormatForOutput, type OutputFormat } from "../../../core/file-formats";
import { describeOutputIssue } from "../../../core/output-validation";
import type { CreatedOutput } from "../../adapters/output-adapter";
import { OUTPUT_PRESENTATIONS } from "./output-presentations";
import type { OutputPlan } from "./output-plan";
import { createStateTransition } from "../../shell/state-transition";

export interface OutputView {
  bind(options: {
    onDownload: () => void;
  }): void;
  render(plan: OutputPlan, format: OutputFormat, busy: boolean): void;
  renderError(detail: string, canRetry: boolean): void;
  save(output: CreatedOutput): void;
}

export function createOutputView(): OutputView {
  const root = requireElement<HTMLElement>("#output-step");
  const downloadStatus = requireDescendant<HTMLElement>(root, "#output-download-status");
  const downloadButton = requireDescendant<HTMLButtonElement>(root, "#download-button");
  const downloadTitle = requireDescendant<HTMLElement>(root, "#download-status-title");
  const downloadSpinner = requireDescendant<HTMLElement>(root, "#download-status-spinner");
  const downloadSummary = requireDescendant<HTMLElement>(root, "#download-status-summary");
  const downloadDetail = requireDescendant<HTMLElement>(root, "#download-status-detail");
  const issueDisclosure = requireDescendant<HTMLDetailsElement>(root, "#output-issue-disclosure");
  const issueSummary = requireDescendant<HTMLElement>(root, "#output-issue-summary");
  const issueBlock = requireDescendant<HTMLElement>(issueDisclosure, ".issue-detail-block");
  const problemLink = requireDescendant<HTMLAnchorElement>(root, "#output-problem-link");
  const outputIssueList = requireDescendant<HTMLUListElement>(root, "#output-issue-list");
  const downloadCopy = requireDescendant<HTMLElement>(downloadStatus, ".action-copy");
  const transition = createStateTransition(downloadCopy);

  function clearOutputIssues(): void {
    outputIssueList.replaceChildren();
    issueDisclosure.open = false;
    issueDisclosure.hidden = true;
    problemLink.hidden = true;
  }

  function renderProblems(plan: OutputPlan): void {
    const details = [
      ...plan.problems,
      ...plan.outputIssues.map(describeOutputIssue),
      ...(plan.replacementRowCount > 0 && !plan.outputIssues.some((issue) => !issue.blocking)
        ? [`有 ${plan.replacementRowCount.toLocaleString("zh-TW")} 列會以？代替無法轉出的字元，請核對。`]
        : []),
    ];
    outputIssueList.replaceChildren(...details.map((detail) => {
      const item = document.createElement("li");
      item.textContent = detail;
      return item;
    }));
    issueSummary.textContent = `查看 ${details.length.toLocaleString("zh-TW")} 個${plan.hasProblems ? "問題" : "提醒"}`;
    issueBlock.dataset.tone = plan.hasProblems ? "error" : "warning";
    issueDisclosure.hidden = details.length === 0;
  }

  return {
    bind(options) {
      downloadButton.addEventListener("click", options.onDownload);
    },
    render(plan, format, busy) {
      clearOutputIssues();
      const presentation = OUTPUT_PRESENTATIONS[format];
      const processing = busy || plan.preparationState === "loading";
      downloadStatus.toggleAttribute("aria-busy", processing);
      downloadSpinner.hidden = !processing;
      downloadSummary.textContent = `${FILE_FORMAT_LABELS[fileFormatForOutput(format)]}：${plan.totalSummary.fileCount.toLocaleString("zh-TW")} 個檔案，已勾選 ${plan.totalSummary.selectedRows.toLocaleString("zh-TW")} 列。`;
      downloadButton.textContent = plan.totalSummary.fileCount > 1 ? "下載 ZIP" : presentation.buttonLabel;
      if (busy) {
        downloadButton.disabled = true;
        downloadTitle.textContent = "正在建立下載";
        downloadDetail.textContent = "完成後會自動下載。";
        transition.update("creating");
        return;
      }
      if (plan.totalSummary.fileCount === 0) {
        downloadButton.disabled = true;
        downloadTitle.textContent = "尚未準備下載";
        downloadDetail.textContent = "請加入符合第 0 區輸入格式的檔案。";
        transition.update("empty");
        return;
      }
      if (plan.preparationState === "loading") {
        downloadButton.disabled = true;
        downloadTitle.textContent = "正在準備下載";
        downloadDetail.textContent = "請稍候。";
        transition.update("preparing");
        return;
      }
      if (plan.preparationState === "error") {
        downloadButton.disabled = true;
        downloadTitle.textContent = "無法完成輸出檢查";
        downloadDetail.textContent = plan.preparationError ?? "請重新選擇輸出格式後再試一次。";
        transition.update("preparation-error");
        return;
      }
      if (plan.hasProblems) {
        downloadButton.disabled = true;
        downloadTitle.textContent = "請先處理問題";
        downloadDetail.textContent = "請依下列提示處理後再下載。";
        problemLink.hidden = false;
        renderProblems(plan);
        transition.update("problems");
        return;
      }
      downloadButton.disabled = false;
      downloadTitle.textContent = "可以下載";
      downloadDetail.textContent = plan.replacementRowCount > 0
        ? "請查看下列提醒，確認後再下載。"
        : `按「${downloadButton.textContent}」儲存結果。`;
      if (plan.replacementRowCount > 0) {
        problemLink.hidden = false;
        renderProblems(plan);
      }
      transition.update(plan.replacementRowCount > 0 ? "ready-with-notices" : "ready");
    },
    renderError(detail, canRetry) {
      clearOutputIssues();
      downloadStatus.removeAttribute("aria-busy");
      downloadSpinner.hidden = true;
      downloadButton.disabled = !canRetry;
      downloadTitle.textContent = "無法建立下載";
      downloadDetail.textContent = detail;
      transition.update("download-error");
    },
    save(output) {
      downloadBytes(output.bytes, output.mimeType, output.filename);
    },
  };
}
