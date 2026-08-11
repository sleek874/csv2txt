import type { OutputFormat } from "../../../core/file-formats";

export interface OutputPresentation {
  buttonLabel: string;
  label: string;
  preparingLabel: string;
}

export const OUTPUT_PRESENTATIONS: Record<OutputFormat, OutputPresentation> = {
  "big5-txt": {
    buttonLabel: "下載 TXT",
    label: "TXT",
    preparingLabel: "正在建立 TXT",
  },
  csv: {
    buttonLabel: "下載 CSV",
    label: "CSV",
    preparingLabel: "正在建立 CSV",
  },
  xlsx: {
    buttonLabel: "下載 XLSX",
    label: "XLSX",
    preparingLabel: "正在建立 XLSX",
  },
};
