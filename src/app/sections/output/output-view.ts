import { downloadBytes } from "../../../browser/download";
import { requireDescendant, requireElement } from "../../../browser/dom";
import { OUTPUT_FORMATS, type OutputFormat } from "../../../core/file-formats";
import type { CreatedOutput } from "../../adapters/output-adapter";
import { OUTPUT_PRESENTATIONS } from "./output-presentations";
import type { OutputPlan } from "./output-plan";

export interface OutputView {
  bind(options: {
    onDownload: () => void;
    onFormatChange: (format: OutputFormat) => void;
  }): void;
  render(plan: OutputPlan, format: OutputFormat, busy: boolean): void;
  renderError(detail: string): void;
  save(output: CreatedOutput): void;
}

function outputFormat(value: string): OutputFormat {
  return OUTPUT_FORMATS.find((format) => format === value) ?? "big5-txt";
}

export function createOutputView(): OutputView {
  const root = requireElement<HTMLElement>("#output-step");
  const select = requireDescendant<HTMLSelectElement>(root, "#output-format");
  const help = requireDescendant<HTMLElement>(root, "#output-format-help");
  const downloadButton = requireDescendant<HTMLButtonElement>(root, "#download-button");
  const downloadTitle = requireDescendant<HTMLElement>(root, "#download-status-title");
  const downloadDetail = requireDescendant<HTMLElement>(root, "#download-status-detail");
  const problemLink = requireDescendant<HTMLAnchorElement>(root, "#output-problem-link");
  const outputIssueList = requireDescendant<HTMLUListElement>(root, "#output-issue-list");

  function clearOutputIssues(): void {
    outputIssueList.replaceChildren();
    outputIssueList.hidden = true;
    problemLink.hidden = true;
  }

  function renderProblems(plan: OutputPlan): void {
    const details = plan.problems;
    outputIssueList.replaceChildren(...details.map((detail) => {
      const item = document.createElement("li");
      item.textContent = detail;
      return item;
    }));
    outputIssueList.hidden = details.length === 0;
  }

  return {
    bind(options) {
      select.addEventListener("change", () => options.onFormatChange(outputFormat(select.value)));
      downloadButton.addEventListener("click", options.onDownload);
    },
    render(plan, format, busy) {
      clearOutputIssues();
      if (select.value !== format) {
        select.value = format;
      }
      const presentation = OUTPUT_PRESENTATIONS[format];
      help.textContent = presentation.help;
      downloadButton.textContent = plan.totalSummary.fileCount > 1 ? "下載 ZIP" : presentation.buttonLabel;
      if (busy) {
        select.disabled = true;
        downloadButton.disabled = true;
        downloadTitle.textContent = plan.totalSummary.fileCount > 1 ? "正在建立 ZIP" : presentation.preparingLabel;
        downloadDetail.textContent = "完成後會自動開始下載。";
        return;
      }
      select.disabled = false;
      if (plan.totalSummary.fileCount === 0) {
        downloadButton.disabled = true;
        downloadTitle.textContent = "尚未準備下載";
        downloadDetail.textContent = "請先在第 1 區加入檔案。";
        return;
      }
      if (plan.processingFileCount > 0) {
        downloadButton.disabled = true;
        downloadTitle.textContent = "正在檢查檔案";
        downloadDetail.textContent = `尚有 ${plan.processingFileCount} 個檔案，完成後即可繼續。`;
        return;
      }
      if (plan.totalSummary.problemCount > 0) {
        downloadButton.disabled = true;
        downloadTitle.textContent = "下載前仍有問題";
        downloadDetail.textContent = `第 1 區還有 ${plan.totalSummary.problemCount} 個項目需要查看。`;
        problemLink.hidden = false;
        renderProblems(plan);
        return;
      }
      downloadButton.disabled = false;
      downloadTitle.textContent = "可以下載";
      const target = plan.totalSummary.fileCount > 1
        ? `將把 ${plan.totalSummary.fileCount} 個檔案、共 ${plan.totalSummary.selectedRows} 列打包為 ZIP`
        : `將輸出 ${plan.totalSummary.selectedRows} 列`;
      downloadDetail.textContent = plan.omittedRowCount > 0
        ? `${target}；另有 ${plan.omittedRowCount} 列未勾選。`
        : `${target}。`;
    },
    renderError(detail) {
      clearOutputIssues();
      downloadTitle.textContent = "無法建立下載";
      downloadDetail.textContent = detail;
    },
    save(output) {
      downloadBytes(output.bytes, output.mimeType, output.filename);
    },
  };
}
