import assert from "node:assert/strict";
import test from "node:test";

import { utils, write } from "xlsx";

import { detectInputFileType, detectSourceFileType } from "../src/core/file-formats.ts";
import {
  inspectSpreadsheet,
  parseSpreadsheet,
  serializeSpreadsheet,
} from "../src/core/formats/spreadsheet.ts";

test("creates an XLSX with text cells and no added header row", () => {
  const rows = [["00123", "中文", ""], ["00002", "A", "尾端"]];
  const bytes = serializeSpreadsheet(rows.map((values, index) => ({ sourceRow: index + 1, values })));
  assert.deepEqual(inspectSpreadsheet(bytes).sheetNames, ["資料"]);
  const parsed = parseSpreadsheet(bytes, 3);
  assert.equal(parsed.sheetName, "資料");
  assert.deepEqual(parsed.rows, rows);
  assert.deepEqual(parsed.errors, []);
});

test("source type detection accepts supported single-file and ZIP inputs", () => {
  assert.equal(detectSourceFileType("data.csv"), "csv");
  assert.equal(detectSourceFileType("DATA.XLS"), "xls");
  assert.equal(detectSourceFileType("report.final.XLSX"), "xlsx");
  assert.equal(detectSourceFileType("records.TXT"), "txt");
  assert.equal(detectSourceFileType("data.xlsm"), null);
  assert.equal(detectInputFileType("batch.ZIP"), "zip");
  assert.equal(detectSourceFileType("batch.zip"), null);
});

for (const bookType of ["xlsx", "biff8"]) {
  test(`parses formatted values and normalizes blank cells from ${bookType}`, () => {
    const sheet = utils.aoa_to_sheet([
      ["00123", 0.125, 45_292, true, { t: "n", v: 3, f: "1+2", z: "0.00" }, "中文", { t: "n", v: 45_292, z: "m/d/yy" }],
      ["second row"],
    ]);
    sheet.B1.z = "0.0%";
    sheet.C1.z = "yyyy-mm-dd";
    sheet.P2 = { t: "s", v: "extra column" };
    sheet["!ref"] = "A1:P2";
    const workbook = utils.book_new(sheet, "資料");
    const parsed = parseSpreadsheet(new Uint8Array(write(workbook, { type: "array", bookType })), 15);
    assert.equal(parsed.sheetName, "資料");
    assert.deepEqual(parsed.rows[0].slice(0, 7), ["00123", "12.5%", "2024-01-01", "TRUE", "3.00", "中文", "2024/01/01"]);
    assert.equal(parsed.rows[0].length, 15);
    assert.equal(parsed.rows[1].length, 16);
    assert.equal(parsed.rows[1][15], "extra column");
  });
}

test("supports explicit worksheet selection for future reference workbooks", () => {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["first"]]), "First");
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["second"]]), "Reference");
  const bytes = new Uint8Array(write(workbook, { type: "array", bookType: "xlsx" }));
  assert.deepEqual(inspectSpreadsheet(bytes).sheetNames, ["First", "Reference"]);
  assert.deepEqual(parseSpreadsheet(bytes, 1, "Reference").rows, [["second"]]);
});

test("preserves leading blank rows and reports formulas without cached results", () => {
  const sheet = utils.sheet_new();
  sheet.A2 = { t: "n", f: "1+2" };
  sheet["!ref"] = "A2:A2";
  const workbook = utils.book_new(sheet, "Sheet1");
  const parsed = parseSpreadsheet(new Uint8Array(write(workbook, { type: "array", bookType: "xlsx" })), 15);
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[0], Array(15).fill(""));
  assert.match(parsed.errors[0] ?? "", /A2.*公式沒有已儲存的計算結果/u);
});
