import { outputPath, type OutputFormat } from "../../core/file-formats";
import { cellValue, hasBlockingFileIssues, type InternalFile } from "../../core/internal-model";
import { describeOutputIssue, validateOutput } from "../../core/output-validation";
import type { SerializableRow } from "../../core/formats/types";
import type { CodecManager } from "../resources/codec-manager";

export interface CreatedOutput {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}

export interface OutputAdapter {
  create(files: readonly InternalFile[], format: OutputFormat, createdAt?: Date): Promise<CreatedOutput>;
}

const MIME_TYPES: Record<OutputFormat, string> = {
  "big5-txt": "application/octet-stream",
  csv: "text/csv;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function selectedRows(file: InternalFile): SerializableRow[] {
  return file.rows
    .filter((row) => row.included)
    .map((row) => ({
      sourceRow: row.sourceRow,
      values: row.cells.map(cellValue),
    }));
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function taipeiMinuteStamp(date: Date): string {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Taipei",
    year: "numeric",
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}`;
}

export function createOutputAdapter(codecs: CodecManager): OutputAdapter {
  return {
    async create(files, format, createdAt = new Date()) {
      if (files.length === 0) throw new Error("工作區沒有可輸出的檔案。");
      const outputIssue = validateOutput(files, format)[0];
      if (outputIssue) throw new Error(describeOutputIssue(outputIssue));
      const planned = files.map((file) => {
        if (hasBlockingFileIssues(file)) {
          throw new Error(`${file.virtualPath} 仍有無法逐列處理的錯誤。`);
        }
        const rows = selectedRows(file);
        if (rows.length === 0) throw new Error(`${file.virtualPath} 尚未選擇任何輸出列。`);
        return { path: outputPath(file.virtualPath, format), rows };
      });
      const paths = new Set<string>();
      for (const { path } of planned) {
        if (paths.has(path)) throw new Error(`輸出路徑碰撞：${path}`);
        paths.add(path);
      }

      let serialize: (rows: SerializableRow[]) => Uint8Array;
      switch (format) {
        case "big5-txt":
          serialize = (await codecs.big5Txt()).serializeBig5Txt;
          break;
        case "csv":
          serialize = (await codecs.csv()).serializeCsv;
          break;
        case "xlsx":
          serialize = (await codecs.spreadsheet()).serializeSpreadsheet;
          break;
      }
      const outputs = planned.map(({ path, rows }) => ({ path, bytes: serialize(rows) }));
      if (outputs.length > 1) {
        return {
          bytes: await (await codecs.zip()).serializeZip(outputs),
          filename: `${format}-${taipeiMinuteStamp(createdAt)}.zip`,
          mimeType: "application/zip",
        };
      }
      const output = outputs[0];
      if (!output) throw new Error("工作區沒有可輸出的檔案。");
      return {
        bytes: output.bytes,
        filename: basename(output.path),
        mimeType: MIME_TYPES[format],
      };
    },
  };
}
