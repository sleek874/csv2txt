import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { utils, write } from "xlsx";

import { parseCsv } from "../src/core/csv.ts";
import { detectSourceFileType } from "../src/core/source.ts";
import { parseSpreadsheet } from "../src/core/spreadsheet.ts";

const fixtureDirectory = new URL("./fixtures/", import.meta.url);

test("source type detection only accepts CSV, XLS, and XLSX extensions", () => {
  assert.equal(detectSourceFileType("data.csv"), "csv");
  assert.equal(detectSourceFileType("DATA.XLS"), "xls");
  assert.equal(detectSourceFileType("report.final.XLSX"), "xlsx");
  assert.equal(detectSourceFileType("data.xlsm"), null);
  assert.equal(detectSourceFileType("data.csv.txt"), null);
  assert.equal(detectSourceFileType("csv"), null);
});

for (const bookType of ["xlsx", "biff8"]) {
  test(`parses formatted values and normalizes blank cells from ${bookType}`, () => {
    const sheet = utils.aoa_to_sheet([
      [
        "00123",
        0.125,
        45_292,
        true,
        { t: "n", v: 3, f: "1+2", z: "0.00" },
        "中文",
        { t: "n", v: 45_292, z: "m/d/yy" },
      ],
      ["second row"],
    ]);
    sheet.B1.z = "0.0%";
    sheet.C1.z = "yyyy-mm-dd";
    sheet.P2 = { t: "s", v: "extra column" };
    sheet["!ref"] = "A1:P2";

    const workbook = utils.book_new(sheet, "資料");
    const bytes = new Uint8Array(write(workbook, { type: "array", bookType }));
    const parsed = parseSpreadsheet(bytes, 15);

    assert.equal(parsed.sheetName, "資料");
    assert.deepEqual(parsed.rows[0].slice(0, 7), [
      "00123",
      "12.5%",
      "2024-01-01",
      "TRUE",
      "3.00",
      "中文",
      "2024/01/01",
    ]);
    assert.equal(parsed.rows[0].length, 15);
    assert.equal(parsed.rows[1].length, 16);
    assert.equal(parsed.rows[1][14], "");
    assert.equal(parsed.rows[1][15], "extra column");
    assert.deepEqual(parsed.errors, []);
  });
}

test("preserves leading blank rows and reports formulas without cached results", () => {
  const sheet = utils.sheet_new();
  sheet.A2 = { t: "n", f: "1+2" };
  sheet["!ref"] = "A2:A2";
  const workbook = utils.book_new(sheet, "Sheet1");
  const bytes = new Uint8Array(write(workbook, { type: "array", bookType: "xlsx" }));

  const parsed = parseSpreadsheet(bytes, 15);

  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[0], Array(15).fill(""));
  assert.match(parsed.errors[0] ?? "", /A2.*公式沒有已儲存的計算結果/u);
});

for (const baseName of ["synthetic-valid-200", "synthetic-invalid-boundaries"]) {
  test(`generated XLS and XLSX fixtures match ${baseName} CSV values`, () => {
    const csvText = readFileSync(new URL(`${baseName}.utf8.csv`, fixtureDirectory), "utf8");
    const csvRows = parseCsv(csvText).rows;

    for (const extension of ["xls", "xlsx"]) {
      const bytes = readFileSync(new URL(`${baseName}.${extension}`, fixtureDirectory));
      const spreadsheet = parseSpreadsheet(bytes, 15);
      assert.deepEqual(spreadsheet.rows, csvRows);
      assert.deepEqual(spreadsheet.errors, []);
    }
  });
}
