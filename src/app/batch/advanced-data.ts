import type { AdvancedPrimaryRow } from "../../core/advanced/lookup";
import { compactValue, type CompactFile } from "./compact-workspace";

function approximateAge(dateValue: string, currentYear: number): string {
  if (!/^[0-9]{8}$/u.test(dateValue)) return "";
  const birthYear = Number(dateValue.slice(0, 4));
  return Number.isInteger(birthYear) && birthYear > 0 ? String(currentYear - birthYear) : "";
}

export function collectCompactAdvancedRows(file: CompactFile, currentYear: number): AdvancedPrimaryRow[] {
  const rows: AdvancedPrimaryRow[] = [];
  for (let rowIndex = 0; rowIndex < file.sourceRows.length; rowIndex += 1) {
    if (file.included[rowIndex] !== 1) continue;
    const field5 = compactValue(file, rowIndex, 4);
    const field6 = compactValue(file, rowIndex, 5);
    const field8 = compactValue(file, rowIndex, 7);
    const field11 = compactValue(file, rowIndex, 10);
    rows.push({
      lookupKey: field11.trim().toLocaleUpperCase("en-US"),
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
    });
  }
  return rows;
}
