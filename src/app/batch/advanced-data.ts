import {
  joinAdvancedRowsWithIndex,
  normalizedLookupKey,
  type AdvancedLookupResult,
  type AdvancedPrimaryRow,
  type AdvancedReferenceIndex,
} from "../../core/advanced/lookup";
import type { AdvancedResultSummary } from "./protocol";
import {
  compactCellDetail,
  compactValue,
  type CompactColumn,
  type CompactFile,
} from "./compact-workspace";

const KEY_COLUMN_INDEX = 10;
const keyCountsCache = new WeakMap<CompactFile, {
  counts: ReadonlyMap<string, number>;
  selectionRevision: number;
}>();

function approximateAge(dateValue: string, currentYear: number): string {
  if (!/^[0-9]{8}$/u.test(dateValue)) return "";
  const birthYear = Number(dateValue.slice(0, 4));
  return Number.isInteger(birthYear) && birthYear > 0 ? String(currentYear - birthYear) : "";
}

function dictionaryKeys(column: CompactColumn): readonly string[] | null {
  return column.kind === "dictionary"
    ? column.values.map(normalizedLookupKey)
    : null;
}

function lookupKey(
  file: CompactFile,
  rowIndex: number,
  keys: readonly string[] | null,
): string {
  const column = file.columns[KEY_COLUMN_INDEX];
  const detail = compactCellDetail(file, rowIndex, KEY_COLUMN_INDEX);
  return keys && column?.kind === "dictionary"
    && detail?.finalValue === undefined && detail?.unpackedValue === undefined
    ? keys[column.codes[rowIndex]!] ?? ""
    : normalizedLookupKey(compactValue(file, rowIndex, KEY_COLUMN_INDEX));
}

function selectedKeyCounts(file: CompactFile): ReadonlyMap<string, number> {
  const cached = keyCountsCache.get(file);
  if (cached?.selectionRevision === file.selectionRevision) return cached.counts;
  const counts = new Map<string, number>();
  const keys = dictionaryKeys(file.columns[KEY_COLUMN_INDEX]!);
  for (let rowIndex = 0; rowIndex < file.sourceRows.length; rowIndex += 1) {
    if (file.included[rowIndex] !== 1) continue;
    const key = lookupKey(file, rowIndex, keys);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  keyCountsCache.set(file, { counts, selectionRevision: file.selectionRevision });
  return counts;
}

function* compactAdvancedRows(
  files: readonly CompactFile[],
  currentYear: number,
): Iterable<AdvancedPrimaryRow> {
  for (const file of files) {
    const keys = dictionaryKeys(file.columns[KEY_COLUMN_INDEX]!);
    for (let rowIndex = 0; rowIndex < file.sourceRows.length; rowIndex += 1) {
      if (file.included[rowIndex] !== 1) continue;
      const field5 = compactValue(file, rowIndex, 4);
      const field6 = compactValue(file, rowIndex, 5);
      const field8 = compactValue(file, rowIndex, 7);
      const field11 = compactValue(file, rowIndex, KEY_COLUMN_INDEX);
      yield {
        lookupKey: lookupKey(file, rowIndex, keys),
        sourceFile: file.virtualPath,
        sourceRow: file.sourceRows[rowIndex]!,
        values: [
          field5,
          field6,
          approximateAge(field6, currentYear),
          compactValue(file, rowIndex, 6),
          field8 === "1" ? "男" : field8 === "2" ? "女" : field8,
          compactValue(file, rowIndex, 8),
          compactValue(file, rowIndex, 9),
          field11,
          compactValue(file, rowIndex, 11),
        ],
      };
    }
  }
}

export function summarizeCompactAdvanced(
  files: readonly CompactFile[],
  reference: AdvancedReferenceIndex,
): AdvancedResultSummary {
  let resultRowCount = 0;
  let selectedRowCount = 0;
  let unmatchedRowCount = 0;
  for (const file of files) {
    for (const [key, count] of selectedKeyCounts(file)) {
      const matchCount = key ? reference.rowsByKey.get(key)?.length ?? 0 : 0;
      selectedRowCount += count;
      if (matchCount === 0) unmatchedRowCount += count;
      resultRowCount += count * Math.max(1, matchCount);
    }
  }
  return { resultRowCount, selectedRowCount, unmatchedRowCount };
}

export function createCompactAdvancedResult(
  files: readonly CompactFile[],
  reference: AdvancedReferenceIndex,
  selectedColumnIndices: readonly number[],
  currentYear: number,
): AdvancedLookupResult {
  return joinAdvancedRowsWithIndex(
    compactAdvancedRows(files, currentYear),
    reference,
    selectedColumnIndices,
  );
}
