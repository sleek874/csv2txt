import type { OutputFormat } from "../../../core/file-formats";

export interface OutputPresentation {
  buttonLabel: string;
  help: string;
  label: string;
  preparingLabel: string;
}

export const OUTPUT_PRESENTATIONS: Record<OutputFormat, OutputPresentation> = {
  "big5-txt": {
    buttonLabel: "下載 Big5 TXT",
    help: "固定 208 bytes／筆。",
    label: "Big5 TXT",
    preparingLabel: "正在建立 Big5 TXT",
  },
  csv: {
    buttonLabel: "下載 CSV",
    help: "UTF-8 CSV；試算表軟體可能自行轉換前置零。",
    label: "CSV（UTF-8）",
    preparingLabel: "正在建立 CSV",
  },
  xlsx: {
    buttonLabel: "下載 XLSX",
    help: "15 欄文字資料，不含標題列。",
    label: "XLSX",
    preparingLabel: "正在建立 XLSX",
  },
};
