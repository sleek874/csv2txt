import { FIXED_FIELD_COUNT } from "./fixed-profile";
import type { DataIssue, InternalCell, InternalRow } from "./internal-model";

export interface NormalizationResult {
  issues: DataIssue[];
  rows: InternalRow[];
  sourceRows: number;
}

function removeWhitespace(value: string): string {
  return value.replace(/\p{White_Space}+/gu, "");
}

function normalizeCell(value: string, fieldIndex: number): string {
  const compact = removeWhitespace(value);
  return fieldIndex === 5 || fieldIndex === 11
    ? compact.toUpperCase()
    : compact;
}

function createStructureIssue(sourceRow: number, actualCount: number): DataIssue {
  return {
    severity: "error",
    stage: "source",
    code: "INVALID_COLUMN_COUNT",
    sourceRow,
    message: `共有 ${actualCount} 欄，應為 ${FIXED_FIELD_COUNT} 欄。`,
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

  sourceRows.forEach((source, rowIndex) => {
    const sourceRow = options.sourceRowNumbers?.[rowIndex] ?? rowIndex + 1;
    const normalizedSource = source.map((value, columnIndex) =>
      normalizeCell(String(value), columnIndex + 1));

    if (normalizedSource.every((value) => value === "")) {
      issues.push({
        severity: "warning",
        stage: "source",
        code: "EMPTY_ROW",
        message: "空白列不會輸出。",
        sourceRow,
      });
      return;
    }

    const rowIssues = source.length === FIXED_FIELD_COUNT
      ? []
      : [createStructureIssue(sourceRow, source.length)];
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
      issues: rowIssues,
      changes: [],
    });
  });

  return {
    issues,
    rows,
    sourceRows: options.sourceRowCount ?? sourceRows.length,
  };
}
