import { cellValue, type InternalFile, type InternalRow } from "../internal-model";

export const ADVANCED_PRIMARY_HEADERS = [
  "欄位5",
  "欄位6",
  "約略年齡",
  "欄位7",
  "欄位8",
  "欄位9",
  "欄位10",
  "欄位11",
  "欄位12",
] as const;

export interface AdvancedPrimaryRow {
  lookupKey: string;
  sourceFile: string;
  sourceRow: number;
  values: readonly string[];
}

export interface ReferenceTable {
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}

export interface AdvancedLookupResult {
  headers: readonly string[];
  matchedRowCount: number;
  resultRowCount: number;
  rows: readonly (readonly string[])[];
  selectedRowCount: number;
  unmatchedRowCount: number;
}

export interface AdvancedReferenceIndex {
  headers: readonly string[];
  rowsByKey: ReadonlyMap<string, readonly (readonly string[])[]>;
}

export function normalizedLookupKey(value: string): string {
  return value.trim().toLocaleUpperCase("en-US");
}

function rowValue(row: InternalRow, fieldIndex: number): string {
  const cell = row.cells.find((candidate) => candidate.fieldIndex === fieldIndex);
  return cell ? cellValue(cell) : "";
}

function approximateAge(dateValue: string, currentYear: number): string {
  if (!/^[0-9]{8}$/u.test(dateValue)) return "";
  const birthYear = Number(dateValue.slice(0, 4));
  if (!Number.isInteger(birthYear) || birthYear <= 0) return "";
  return String(currentYear - birthYear);
}

function mappedField8(value: string): string {
  if (value === "1") return "男";
  if (value === "2") return "女";
  return value;
}

export function taipeiCurrentYear(date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Taipei",
    year: "numeric",
  }).format(date));
}

export function collectAdvancedPrimaryRows(
  files: readonly InternalFile[],
  currentYear = taipeiCurrentYear(),
): AdvancedPrimaryRow[] {
  return files.flatMap((file) => file.rows
    .filter((row) => row.included)
    .map((row) => {
      const field5 = rowValue(row, 5);
      const field6 = rowValue(row, 6);
      const field11 = rowValue(row, 11);
      return {
        lookupKey: normalizedLookupKey(field11),
        sourceFile: file.virtualPath,
        sourceRow: row.sourceRow,
        values: [
          field5,
          field6,
          approximateAge(field6, currentYear),
          rowValue(row, 7),
          mappedField8(rowValue(row, 8)),
          rowValue(row, 9),
          rowValue(row, 10),
          field11,
          rowValue(row, 12),
        ],
      };
    }));
}

function outputHeaders(referenceHeaders: readonly string[]): string[] {
  const used = new Set<string>(ADVANCED_PRIMARY_HEADERS);
  return referenceHeaders.map((referenceHeader) => {
    const base = used.has(referenceHeader) ? `參照：${referenceHeader}` : referenceHeader;
    let header = base;
    let suffix = 2;
    while (used.has(header)) {
      header = `${base}（${suffix}）`;
      suffix += 1;
    }
    used.add(header);
    return header;
  });
}

export function createAdvancedReferenceIndex(
  reference: ReferenceTable,
  keyColumnIndex: number,
): AdvancedReferenceIndex {
  const rowsByKey = new Map<string, (readonly string[])[]>();
  for (const row of reference.rows) {
    const key = normalizedLookupKey(row[keyColumnIndex] ?? "");
    if (!key) continue;
    const matches = rowsByKey.get(key) ?? [];
    matches.push(row);
    rowsByKey.set(key, matches);
  }
  return { headers: reference.headers, rowsByKey };
}

export function joinAdvancedRowsWithIndex(
  primaryRows: Iterable<AdvancedPrimaryRow>,
  reference: AdvancedReferenceIndex,
  selectedColumnIndices: readonly number[],
): AdvancedLookupResult {
  const validSelectedIndices = [...new Set(selectedColumnIndices)]
    .filter((index) => index >= 0 && index < reference.headers.length);
  const rows: string[][] = [];
  let matchedRowCount = 0;
  let selectedRowCount = 0;
  let unmatchedRowCount = 0;
  for (const primaryRow of primaryRows) {
    selectedRowCount += 1;
    const matches = primaryRow.lookupKey
      ? reference.rowsByKey.get(primaryRow.lookupKey) ?? []
      : [];
    if (matches.length === 0) {
      unmatchedRowCount += 1;
      rows.push([
        ...primaryRow.values,
        ...validSelectedIndices.map(() => ""),
      ]);
      continue;
    }
    matchedRowCount += 1;
    for (const match of matches) {
      rows.push([
        ...primaryRow.values,
        ...validSelectedIndices.map((index) => match[index] ?? ""),
      ]);
    }
  }
  return {
    headers: [
      ...ADVANCED_PRIMARY_HEADERS,
      ...outputHeaders(validSelectedIndices.map((index) => reference.headers[index] ?? "")),
    ],
    matchedRowCount,
    resultRowCount: rows.length,
    rows,
    selectedRowCount,
    unmatchedRowCount,
  };
}

export function joinAdvancedRows(
  primaryRows: readonly AdvancedPrimaryRow[],
  reference: ReferenceTable,
  keyColumnIndex: number,
  selectedColumnIndices: readonly number[],
): AdvancedLookupResult {
  return joinAdvancedRowsWithIndex(
    primaryRows,
    createAdvancedReferenceIndex(reference, keyColumnIndex),
    selectedColumnIndices,
  );
}
