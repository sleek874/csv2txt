import { serializeFixedWidthBig5 } from "../core/fixed-width";
import { cellValue, hasBlockingFileIssues, type InternalFile, type OutputFormat } from "../core/internal-model";
import type { SpreadsheetParser } from "./spreadsheet-loader";

export interface CreatedOutput {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}

export interface OutputAdapter {
  create(file: InternalFile, format: OutputFormat): Promise<CreatedOutput>;
}

function outputStem(fileName: string): string {
  return fileName.replace(/\.(?:csv|xlsx?|txt)$/iu, "");
}

export function createOutputAdapter(
  spreadsheet: SpreadsheetParser,
): OutputAdapter {
  return {
    async create(file, format) {
      if (hasBlockingFileIssues(file)) {
        throw new Error("檔案仍有無法逐列處理的錯誤，無法建立下載。");
      }
      if (!file.rows.some((row) => row.included)) {
        throw new Error("尚未選擇任何輸出列。");
      }
      const stem = outputStem(file.virtualPath);
      if (format === "big5-txt") {
        return {
          bytes: serializeFixedWidthBig5(file),
          filename: `${stem}.txt`,
          mimeType: "text/plain",
        };
      }

      const rows = file.rows
        .filter((row) => row.included)
        .map((row) => row.cells.map(cellValue));
      return {
        bytes: await spreadsheet.create(rows),
        filename: `${stem}.xlsx`,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    },
  };
}
