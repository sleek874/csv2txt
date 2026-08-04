import type { OutputFormat } from "../../../core/file-formats";

export interface OutputPresentation {
  buttonLabel: string;
  help: string;
  label: string;
  preparingLabel: string;
}

export const OUTPUT_PRESENTATIONS: Record<OutputFormat, OutputPresentation> = {
  "big5-txt": {
    buttonLabel: "下載 TXT（BIG-5E）",
    help: "每筆固定 15 欄、208 bytes。",
    label: "TXT（BIG-5E）",
    preparingLabel: "正在建立 TXT（BIG-5E）",
  },
  csv: {
    buttonLabel: "下載 CSV",
    help: "15 欄 UTF-8 文字值，不含標題列。",
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
