import { concatenateBytes } from "../bytes";
import { decodeBig5E, encodeBig5E } from "../encoding";
import { FIXED_WIDTHS } from "../fixed-profile";
import type { ParsedRows, SerializableRow } from "./types";

export interface ParsedBig5Txt extends ParsedRows {
  sourceRowNumbers: number[];
  sourceRowCount: number;
  recordWidthBytes: number;
}

function splitRecords(bytes: Uint8Array): Uint8Array[] {
  const records: Uint8Array[] = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x0a) {
      continue;
    }
    const end = index > start && bytes[index - 1] === 0x0d ? index - 1 : index;
    records.push(bytes.subarray(start, end));
    start = index + 1;
  }
  if (start < bytes.length) {
    records.push(bytes.subarray(start));
  }
  return records;
}

function removePadding(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0x20) {
    end -= 1;
  }
  return bytes.subarray(0, end);
}

export function parseBig5Txt(
  bytes: Uint8Array,
  widths: readonly number[] = FIXED_WIDTHS,
): ParsedBig5Txt {
  const recordWidthBytes = widths.reduce((total, width) => total + width, 0);
  if (bytes.length === 0) {
    return {
      rows: [],
      sourceRowNumbers: [],
      sourceRowCount: 0,
      issues: [{ message: "檔案沒有內容。", severity: "error" }],
      recordWidthBytes,
    };
  }

  const records = splitRecords(bytes);
  const rows: string[][] = [];
  const sourceRowNumbers: number[] = [];
  const issues: ParsedBig5Txt["issues"] = [];

  records.forEach((record, rowIndex) => {
    const sourceRow = rowIndex + 1;
    if (record.length === 0 || record.every((byte) => byte === 0x20)) {
      issues.push({ message: "空白列不會輸出。", severity: "warning", sourceRow });
      return;
    }
    if (record.includes(0x0d)) {
      issues.push({ message: "含有未配對的 CR 換行位元組。", severity: "error", sourceRow });
      return;
    }
    if (record.length !== recordWidthBytes) {
      issues.push({
        message: `共有 ${record.length} 位元組，應為 ${recordWidthBytes} 位元組。`,
        severity: "error",
        sourceRow,
      });
      return;
    }

    const row: string[] = [];
    let offset = 0;
    for (let columnIndex = 0; columnIndex < widths.length; columnIndex += 1) {
      const width = widths[columnIndex] ?? 0;
      const fieldBytes = removePadding(record.subarray(offset, offset + width));
      offset += width;
      try {
        row.push(fieldBytes.length === 0 ? "" : decodeBig5E(fieldBytes));
      } catch {
        issues.push({
          message: `欄位${columnIndex + 1}含有無法依臺灣政府 BIG-5E 對照表解讀的位元組。`,
          severity: "error",
          sourceRow,
        });
        return;
      }
    }
    rows.push(row);
    sourceRowNumbers.push(sourceRow);
  });

  return {
    rows,
    sourceRowNumbers,
    sourceRowCount: records.length,
    issues,
    recordWidthBytes,
  };
}

export function serializeBig5Txt(
  rows: readonly SerializableRow[],
  widths: readonly number[] = FIXED_WIDTHS,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const row of rows) {
    if (row.values.length !== widths.length) {
      throw new Error(`第 ${row.sourceRow} 筆共有 ${row.values.length} 欄，應為 ${widths.length} 欄。`);
    }
    row.values.forEach((value, columnIndex) => {
      const width = widths[columnIndex];
      if (width === undefined) {
        throw new Error("固定欄位設定不完整。");
      }
      const encoded = encodeBig5E(value);
      if (!encoded) {
        throw new Error(`第 ${row.sourceRow} 列、欄位${columnIndex + 1}無法輸出為 BIG-5E TXT。`);
      }
      if (encoded.length > width) {
        throw new Error(`第 ${row.sourceRow} 列、欄位${columnIndex + 1}內容太長，無法輸出為 BIG-5E TXT。`);
      }
      chunks.push(encoded, new Uint8Array(width - encoded.length).fill(0x20));
    });
    chunks.push(new Uint8Array([0x0d, 0x0a]));
  }
  return concatenateBytes(chunks);
}
