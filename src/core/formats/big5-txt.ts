import { concatenateBytes } from "../bytes";
import { decodeBig5EPartially, encodeBig5EWithReplacement } from "../encoding";
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

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
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
  const blankSourceRows: number[] = [];
  const rejectedRecords: NonNullable<ParsedBig5Txt["rejectedRecords"]> = [];
  const sourceRowNumbers: number[] = [];
  const issues: ParsedBig5Txt["issues"] = [];

  records.forEach((record, rowIndex) => {
    const sourceRow = rowIndex + 1;
    if (record.length === 0 || record.every((byte) => byte === 0x20)) {
      blankSourceRows.push(sourceRow);
      return;
    }
    if (record.includes(0x0d)) {
      rejectedRecords.push({
        message: "這列含有不完整的換行符號。",
        original: hex(record),
        sourceRow,
        technicalDetail: "原始位元組中含有未配對的 CR（0D）。",
      });
      return;
    }
    if (record.length !== recordWidthBytes) {
      rejectedRecords.push({
        message: `共有 ${record.length} 位元組，應為 ${recordWidthBytes} 位元組。`,
        original: hex(record),
        sourceRow,
        technicalDetail: `實際 ${record.length} bytes；固定格式要求 ${recordWidthBytes} bytes。`,
      });
      return;
    }

    const row: string[] = [];
    let offset = 0;
    for (let columnIndex = 0; columnIndex < widths.length; columnIndex += 1) {
      const width = widths[columnIndex] ?? 0;
      const fieldBytes = removePadding(record.subarray(offset, offset + width));
      offset += width;
      const decoded = decodeBig5EPartially(fieldBytes);
      row.push(decoded.text);
      if (decoded.unrecognized.length > 0) {
        const evidence = decoded.unrecognized.map((segment) => {
          const segmentBytes = new Uint8Array(segment.bytes);
          const start = segment.offset + 1;
          const end = segment.offset + segment.bytes.length;
          return `${hex(segmentBytes)}（欄內第 ${start}${end === start ? "" : `–${end}`} 位元組）`;
        }).join("；");
        issues.push({
          code: "UNDECODABLE_BIG5E_BYTES",
          fieldIndex: columnIndex + 1,
          message: "部分內容無法辨識，已以？代替；預覽以 ■ 標示，請核對來源。",
          replacementCharacterIndices: decoded.unrecognized.map((segment) => segment.characterIndex),
          severity: "error",
          sourceRow,
          technicalDetail: `欄位${columnIndex + 1}無法對照的位元組：${evidence}。`,
        });
      }
    }
    rows.push(row);
    sourceRowNumbers.push(sourceRow);
  });

  return {
    blankSourceRows,
    rows,
    sourceRowNumbers,
    sourceRowCount: records.length,
    issues,
    rejectedRecords,
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
      const encoded = encodeBig5EWithReplacement(value).bytes;
      if (encoded.length > width) {
        throw new Error(`第 ${row.sourceRow} 列、欄位${columnIndex + 1}內容太長，無法輸出為 BIG-5E TXT。`);
      }
      chunks.push(encoded, new Uint8Array(width - encoded.length).fill(0x20));
    });
    chunks.push(new Uint8Array([0x0d, 0x0a]));
  }
  return concatenateBytes(chunks);
}
