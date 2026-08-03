import { decodeBig5 } from "./encoding";

export interface ParsedFixedWidth {
  rows: string[][];
  sourceRowNumbers: number[];
  sourceRowCount: number;
  excludedBlankRows: number;
  errors: string[];
  recordWidthBytes: number;
}

function splitRecords(bytes: Uint8Array): Uint8Array[] {
  const records: Uint8Array[] = [];
  let start = 0;

  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x0a) {
      continue;
    }
    const end = index > start && bytes[index - 1] === 0x0d
      ? index - 1
      : index;
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

export function parseFixedWidthBig5(
  bytes: Uint8Array,
  widths: readonly number[],
): ParsedFixedWidth {
  const recordWidthBytes = widths.reduce((total, width) => total + width, 0);
  if (bytes.length === 0) {
    return {
      rows: [],
      sourceRowNumbers: [],
      sourceRowCount: 0,
      excludedBlankRows: 0,
      errors: ["檔案沒有內容。"],
      recordWidthBytes,
    };
  }

  const records = splitRecords(bytes);
  const rows: string[][] = [];
  const sourceRowNumbers: number[] = [];
  const errors: string[] = [];
  let excludedBlankRows = 0;

  records.forEach((record, rowIndex) => {
    const sourceRow = rowIndex + 1;
    if (record.length === 0 || record.every((byte) => byte === 0x20)) {
      excludedBlankRows += 1;
      return;
    }
    if (record.includes(0x0d)) {
      errors.push(`第 ${sourceRow} 筆含有未配對的 CR 換行位元組。`);
      return;
    }
    if (record.length !== recordWidthBytes) {
      errors.push(
        `第 ${sourceRow} 筆共有 ${record.length} 位元組，應為 ${recordWidthBytes} 位元組。`,
      );
      return;
    }

    const row: string[] = [];
    let offset = 0;
    for (let columnIndex = 0; columnIndex < widths.length; columnIndex += 1) {
      const width = widths[columnIndex] ?? 0;
      const fieldBytes = removePadding(record.subarray(offset, offset + width));
      offset += width;

      try {
        row.push(fieldBytes.length === 0 ? "" : decodeBig5(fieldBytes));
      } catch {
        errors.push(
          `第 ${sourceRow} 筆、欄位${columnIndex + 1}含有無法安全解讀的 Big5 位元組。`,
        );
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
    excludedBlankRows,
    errors,
    recordWidthBytes,
  };
}
