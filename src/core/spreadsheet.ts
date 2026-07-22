import * as cptable from "xlsx/dist/cpexcel.full.mjs";
import {
  read,
  set_cptable,
  utils,
  type CellObject,
  type WorkSheet,
} from "xlsx";

set_cptable(cptable);

const MAX_SPREADSHEET_ROWS = 100_000;
const MAX_SPREADSHEET_COLUMNS = 1_024;

export interface ParsedSpreadsheet {
  rows: string[][];
  errors: string[];
  sheetName: string;
}

function populatedCell(cell: CellObject | undefined): cell is CellObject {
  return cell !== undefined && (cell.v !== undefined || cell.f !== undefined);
}

function formattedCellValue(cell: CellObject | undefined): string {
  if (!cell || cell.v === undefined) {
    return "";
  }
  if (cell.w !== undefined) {
    return cell.w;
  }
  return utils.format_cell(cell);
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

export function parseSpreadsheet(
  bytes: Uint8Array,
  minimumColumnCount: number,
): ParsedSpreadsheet {
  let workbook;
  try {
    workbook = read(bytes, {
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

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Excel 活頁簿不含任何工作表。");
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error("無法讀取 Excel 活頁簿的第一個工作表。");
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
      throw new Error(
        `Excel 工作表「${sheetName}」的資料超過支援範圍（最多 ${MAX_SPREADSHEET_ROWS.toLocaleString()} 列、${MAX_SPREADSHEET_COLUMNS.toLocaleString()} 欄）。`,
      );
    }
    lastRow = Math.max(lastRow, position.r);
    rowLastColumns.set(position.r, Math.max(rowLastColumns.get(position.r) ?? 0, position.c));
  }

  const errors: string[] = [];
  const rows = Array.from({ length: lastRow + 1 }, (_, rowIndex) => {
    const columnCount = Math.max(minimumColumnCount, (rowLastColumns.get(rowIndex) ?? 0) + 1);
    return Array.from({ length: columnCount }, (_, columnIndex) => {
      const address = utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = sheet[address] as CellObject | undefined;
      if (cell?.f !== undefined && cell.v === undefined) {
        errors.push(
          `Excel 儲存格 ${address} 的公式沒有已儲存的計算結果；請在試算表軟體中重新計算並儲存後再試。`,
        );
      }
      return formattedCellValue(cell);
    });
  });

  return { rows, errors, sheetName };
}
