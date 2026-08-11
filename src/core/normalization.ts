import { FIXED_FIELD_COUNT } from "./fixed-profile";
import type {
  DataIssue,
  InternalCell,
  InternalRow,
  RejectedSourceRecord,
} from "./internal-model";

export interface NormalizationResult {
  blankSourceRows: number[];
  issues: DataIssue[];
  rejectedRecords: RejectedSourceRecord[];
  rows: InternalRow[];
  sourceRows: number;
}

function removeWhitespace(value: string): string {
  return value.replace(/\p{White_Space}+/gu, "");
}

function normalizeCell(value: string, fieldIndex: number): string {
  const compact = removeWhitespace(value).replaceAll("?", "？");
  return fieldIndex === 5 || fieldIndex === 11
    ? compact.toUpperCase()
    : compact;
}

export function normalizedCharacterIndex(
  value: string,
  characterIndex: number,
  fieldIndex: number,
): number {
  return [...normalizeCell([...value].slice(0, characterIndex).join(""), fieldIndex)].length;
}

function rejectedColumnCount(
  source: readonly string[],
  sourceRow: number,
): RejectedSourceRecord {
  return {
    message: `共有 ${source.length} 欄，應為 ${FIXED_FIELD_COUNT} 欄。`,
    original: source.map(String).join("｜"),
    sourceRow,
    technicalDetail: `來源記錄有 ${source.length} 個欄位；固定格式要求 ${FIXED_FIELD_COUNT} 個欄位。`,
  };
}

export function normalizeRows(
  sourceRows: readonly (readonly string[])[],
  options: {
    sourceRowNumbers?: readonly number[];
    sourceRowCount?: number;
  } = {},
): NormalizationResult {
  const rows: InternalRow[] = [];
  const issues: DataIssue[] = [];
  const blankSourceRows: number[] = [];
  const rejectedRecords: RejectedSourceRecord[] = [];

  sourceRows.forEach((source, rowIndex) => {
    const sourceRow = options.sourceRowNumbers?.[rowIndex] ?? rowIndex + 1;
    const normalizedSource = source.map((value, columnIndex) =>
      normalizeCell(String(value), columnIndex + 1));

    if (normalizedSource.every((value) => value === "")) {
      blankSourceRows.push(sourceRow);
      return;
    }

    if (source.length !== FIXED_FIELD_COUNT) {
      rejectedRecords.push(rejectedColumnCount(source, sourceRow));
      return;
    }
    const cells: InternalCell[] = Array.from(
      { length: FIXED_FIELD_COUNT },
      (_, columnIndex) => {
        const fieldIndex = columnIndex + 1;
        const sourceValue = String(source[columnIndex] ?? "");
        const normalizedValue = normalizedSource[columnIndex] ?? "";
        return {
          fieldIndex,
          normalizedValue,
          ...(sourceValue !== normalizedValue ? { sourceValue } : {}),
          issues: [],
        };
      },
    );

    rows.push({
      sourceRow,
      included: true,
      cells,
      issues: [],
      changes: [],
    });
  });

  return {
    blankSourceRows,
    issues,
    rejectedRecords,
    rows,
    sourceRows: options.sourceRowCount ?? sourceRows.length,
  };
}
