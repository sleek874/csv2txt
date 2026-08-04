import * as cptable from "xlsx/dist/cpexcel.full.mjs";
import {
  read,
  set_cptable,
  utils,
  write,
  type CellObject,
  type WorkSheet,
} from "xlsx";

import type { ParsedRows, SerializableRow } from "./types";

set_cptable(cptable);

const MAX_SPREADSHEET_ROWS = 100_000;
const MAX_SPREADSHEET_COLUMNS = 1_024;

export interface ParsedSpreadsheet extends ParsedRows {
  sheetName: string;
}

export interface WorkbookSummary {
  sheetNames: readonly string[];
}

export function serializeSpreadsheet(rows: readonly SerializableRow[]): Uint8Array {
  const sheet = utils.aoa_to_sheet(rows.map((row) => [...row.values]));
  const workbook = utils.book_new(sheet, "資料");
  return new Uint8Array(write(workbook, {
    type: "array",
    bookType: "xlsx",
    compression: true,
  }));
}

function populatedCell(cell: CellObject | undefined): cell is CellObject {
  return cell !== undefined && (cell.v !== undefined || cell.f !== undefined);
}

function formattedCellValue(cell: CellObject | undefined): string {
  if (!cell || cell.v === undefined) {
    return "";
  }
  return cell.w ?? utils.format_cell(cell);
}

function worksheetCells(sheet: WorkSheet): Array<[string, CellObject]> {
  return Object.keys(sheet).flatMap((address) => {
    if (address.startsWith("!")) {
      return [];
    }
    const cell = sheet[address] as CellObject | undefined;
    return populatedCell(cell) ? [[address, cell]] : [];
  });
}

function readWorkbook(bytes: Uint8Array) {
  try {
    return read(bytes, {
      type: "array",
      dense: false,
      cellDates: false,
      cellFormula: true,
      cellNF: true,
      cellText: true,
      dateNF: "yyyy/mm/dd",
    });
  } catch {
    throw new Error("無法解析 Excel 檔案。請確認檔案未損毀、未加密，且副檔名與檔案格式相符。");
  }
}

export function inspectSpreadsheet(bytes: Uint8Array): WorkbookSummary {
  return { sheetNames: [...readWorkbook(bytes).SheetNames] };
}

export function parseSpreadsheet(
  bytes: Uint8Array,
  minimumColumnCount: number,
  requestedSheetName?: string,
): ParsedSpreadsheet {
  const workbook = readWorkbook(bytes);
  const sheetName = requestedSheetName ?? workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Excel 活頁簿不含任何工作表。");
  }
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Excel 活頁簿不含工作表「${sheetName}」。`);
  }

  const cells = worksheetCells(sheet);
  if (cells.length === 0) {
    throw new Error(`Excel 工作表「${sheetName}」沒有可匯入的資料。`);
  }

  const rowLastColumns = new Map<number, number>();
  let lastRow = 0;
  for (const [address] of cells) {
    const position = utils.decode_cell(address);
    if (position.r >= MAX_SPREADSHEET_ROWS || position.c >= MAX_SPREADSHEET_COLUMNS) {
      throw new Error(`Excel 工作表「${sheetName}」的資料超過支援範圍（最多 ${MAX_SPREADSHEET_ROWS.toLocaleString()} 列、${MAX_SPREADSHEET_COLUMNS.toLocaleString()} 欄）。`);
    }
    lastRow = Math.max(lastRow, position.r);
    rowLastColumns.set(position.r, Math.max(rowLastColumns.get(position.r) ?? 0, position.c));
  }

  const issues: ParsedSpreadsheet["issues"] = [];
  const rows = Array.from({ length: lastRow + 1 }, (_, rowIndex) => {
    const columnCount = Math.max(minimumColumnCount, (rowLastColumns.get(rowIndex) ?? 0) + 1);
    return Array.from({ length: columnCount }, (_, columnIndex) => {
      const address = utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = sheet[address] as CellObject | undefined;
      if (cell?.f !== undefined && cell.v === undefined) {
        issues.push({
          message: `Excel 儲存格 ${address} 的公式沒有已儲存的計算結果；請在試算表軟體中重新計算並儲存後再試。`,
          severity: "error",
          sourceRow: rowIndex + 1,
        });
      }
      return formattedCellValue(cell);
    });
  });

  return { rows, issues, sheetName };
}
