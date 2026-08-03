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
  const summaries = {
    errorCount: requireDescendant<HTMLElement>(root, "#output-error-summary"),
    excludedBlankRows: requireDescendant<HTMLElement>(root, "#output-blank-row-summary"),
    fileCount: requireDescendant<HTMLElement>(root, "#output-file-summary"),
    includedRows: requireDescendant<HTMLElement>(root, "#output-row-summary"),
    modifiedCount: requireDescendant<HTMLElement>(root, "#output-modified-summary"),
    sourceRows: requireDescendant<HTMLElement>(root, "#output-source-row-summary"),
    warningCount: requireDescendant<HTMLElement>(root, "#output-warning-summary"),
  };

  return {
    bind(options) {
      select.addEventListener("change", () => options.onFormatChange(outputFormat(select.value)));
      downloadButton.addEventListener("click", options.onDownload);
    },
    render(plan, format, busy) {
      if (select.value !== format) {
        select.value = format;
      }
      const presentation = OUTPUT_PRESENTATIONS[format];
      help.textContent = presentation.help;
      Object.entries(summaries).forEach(([key, element]) => {
        element.textContent = String(plan.summary[key as keyof typeof plan.summary]);
      });
      summaries.errorCount.dataset.tone = plan.summary.errorCount > 0 ? "error" : "success";
      summaries.warningCount.dataset.tone = plan.summary.warningCount > 0 ? "warning" : "success";
      summaries.modifiedCount.dataset.tone = plan.summary.modifiedCount > 0 ? "warning" : "success";
      downloadButton.textContent = plan.summary.fileCount > 1 ? "下載 ZIP" : presentation.buttonLabel;
      if (busy) {
        select.disabled = true;
        downloadButton.disabled = true;
        downloadTitle.textContent = plan.summary.fileCount > 1 ? "正在建立 ZIP" : presentation.preparingLabel;
        downloadDetail.textContent = "請稍候，不要關閉頁面。";
        return;
      }
      select.disabled = false;
      if (plan.summary.fileCount === 0) {
        downloadButton.disabled = true;
        downloadTitle.textContent = "尚未準備下載";
        downloadDetail.textContent = "請先新增檔案並完成驗證。";
        return;
      }
      if (plan.processingFileCount > 0) {
        downloadButton.disabled = true;
        downloadTitle.textContent = "檔案仍在處理";
        downloadDetail.textContent = `尚有 ${plan.processingFileCount} 個檔案未完成。`;
        return;
      }
      if (plan.failedFileCount > 0 || plan.blockingFileCount > 0) {
        downloadButton.disabled = true;
        downloadTitle.textContent = "工作區錯誤尚未排除";
        downloadDetail.textContent = plan.failedFileCount > 0
          ? `共有 ${plan.failedFileCount} 個檔案無法處理。`
          : `共有 ${plan.blockingFileCount} 個檔案含有無法逐列排除的錯誤。`;
        return;
      }
      if (plan.emptyFileCount > 0) {
        downloadButton.disabled = true;
        downloadTitle.textContent = "部分檔案沒有輸出列";
        downloadDetail.textContent = `請為 ${plan.emptyFileCount} 個檔案各勾選至少一列。`;
        return;
      }
      downloadButton.disabled = false;
      downloadTitle.textContent = "可以下載";
      const target = plan.summary.fileCount > 1
        ? `將把 ${plan.summary.fileCount} 個檔案、共 ${plan.summary.includedRows} 列打包為 ZIP`
        : `將輸出 ${plan.summary.includedRows} 列`;
      downloadDetail.textContent = plan.forcedRowCount > 0
        ? `${target}；其中 ${plan.forcedRowCount} 列有錯誤或警告，已依勾選強制納入。`
        : plan.omittedRowCount > 0
          ? `${target}；另有 ${plan.omittedRowCount} 列未勾選。`
          : `${target}。`;
    },
    renderError(detail) {
      downloadTitle.textContent = "無法建立下載";
      downloadDetail.textContent = detail;
    },
    save(output) {
      downloadBytes(output.bytes, output.mimeType, output.filename);
    },
  };
}
