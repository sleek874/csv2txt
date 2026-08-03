import assert from "node:assert/strict";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as cptable from "xlsx/dist/cpexcel.full.mjs";
import { set_cptable, utils, write } from "xlsx";

import { serializeZip } from "../src/core/archive/zip.ts";
import { createInternalFile } from "../src/core/conversion-pipeline.ts";
import { encodeBig5 } from "../src/core/encoding.ts";
import {
  FIXED_FIELD_COUNT,
  FIXED_RECORD_WIDTH_BYTES,
  FIXED_WIDTHS,
} from "../src/core/fixed-profile.ts";
import { serializeBig5Txt } from "../src/core/formats/big5-txt.ts";

set_cptable(cptable);

const GENERATED_TODAY = "20260804";
const MAX_ROWS_PER_FILE = 6_000;
const MAX_DATA_FILES = 300;
const testdataDirectory = fileURLToPath(new URL("../testdata/", import.meta.url));
const formatDirectories = Object.fromEntries(
  ["csv", "xls", "xlsx", "txt", "zip"].map((format) => [
    format,
    join(testdataDirectory, format),
  ]),
);

const FIELD_NAMES = [
  "資料類別",
  "區域／機構代碼",
  "資料子類型",
  "來源紀錄編號",
  "選填證號",
  "出生／生效日期",
  "姓名／名稱",
  "性別代碼",
  "地址",
  "電話",
  "必填國民身分證字號",
  "分類代碼",
  "登錄日期",
  "異動／終止日期",
  "異動狀態",
];

const FIELD_NAME_NOTE = "欄位名稱僅供合成資料辨識，依 regex、寬度與跨欄 hook 推定；正式契約仍以欄位1至欄位15的位置規則為準。";

const TAIWAN_ID_LETTER_CODES = {
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17,
  I: 34, J: 18, K: 19, L: 20, M: 21, N: 22, O: 35, P: 23,
  Q: 24, R: 25, S: 26, T: 27, U: 28, V: 29, W: 32, X: 30,
  Y: 31, Z: 33,
};
const ID_LETTERS = Object.keys(TAIWAN_ID_LETTER_CODES);
const mockNames = ["測試甲", "測試乙", "範例丙", "範例丁", "虛構戊", "虛構己"];
const cities = ["台北市", "新北市", "桃園市", "台中市", "台南市", "高雄市"];
const districts = ["測試區", "範例區", "和平區", "幸福區", "文化區", "中央區"];
const streets = ["範例路", "測試街", "和平路", "幸福街", "文化路", "中央街"];

function paddedNumber(value, length) {
  return String(value).padStart(length, "0").slice(-length);
}

function validId(index, sexCode, allowedSecondDigits = ["1", "2"]) {
  const letter = ID_LETTERS[index % ID_LETTERS.length];
  assert.ok(letter);
  const secondDigit = allowedSecondDigits[(sexCode - 1) % allowedSecondDigits.length];
  assert.ok(secondDigit);
  const serial = paddedNumber(index * 7919 + 17, 7);
  const firstEightDigits = `${secondDigit}${serial}`;
  const letterCode = TAIWAN_ID_LETTER_CODES[letter];
  assert.ok(letterCode);
  const weighted = Math.floor(letterCode / 10)
    + (letterCode % 10) * 9
    + [...firstEightDigits].reduce(
      (total, digit, digitIndex) => total + Number(digit) * (8 - digitIndex),
      0,
    );
  const checkDigit = (10 - (weighted % 10)) % 10;
  return `${letter}${firstEightDigits}${checkDigit}`;
}

function fakeDate(year, index) {
  const month = index % 12 + 1;
  const day = index % 28 + 1;
  return `${year}${paddedNumber(month, 2)}${paddedNumber(day, 2)}`;
}

function exactWidthBig5Text(widthBytes) {
  const source = "測試地址甲乙丙丁戊己庚辛壬癸".repeat(20);
  let result = "";
  for (const character of source) {
    const candidate = `${result}${character}`;
    const encoded = encodeBig5(candidate);
    assert.ok(encoded);
    if (encoded.length > widthBytes) break;
    result = candidate;
  }
  assert.equal(encodeBig5(result)?.length, widthBytes);
  return result;
}

function baseRow(index) {
  const sequence = index + 1;
  const sexCode = sequence % 2 === 0 ? 2 : 1;
  const registrationYear = 2018 + sequence % 3;
  const hasOptionalPair = sequence % 3 !== 0;
  const validOptionalId = sequence % 5 === 0
    ? validId(sequence, sexCode, sexCode === 1 ? ["8"] : ["9"])
    : validId(sequence, sexCode);

  return [
    sequence % 2 === 0 ? "B" : "A",
    paddedNumber(sequence % 100, 2),
    String(sequence % 6 + 1),
    paddedNumber(sequence, 10),
    validOptionalId,
    fakeDate(1970 + sequence % 30, sequence),
    mockNames[sequence % mockNames.length],
    String(sexCode),
    `${cities[sequence % cities.length]}${districts[sequence % districts.length]}${streets[sequence % streets.length]}${sequence % 999 + 1}號`,
    `02-${paddedNumber(sequence, 4)}-${paddedNumber(sequence * 3, 4)}`,
    validId(sequence + 10_000, sexCode),
    ["A", "B", "C", "D"][sequence % 4],
    fakeDate(registrationYear, sequence + 4),
    hasOptionalPair ? fakeDate(2024, sequence + 8) : "",
    hasOptionalPair ? String(sequence % 4 + 1) : "",
  ];
}

function boundaryRow(index) {
  const row = baseRow(index);
  row[6] = exactWidthBig5Text(FIXED_WIDTHS[6]);
  row[8] = exactWidthBig5Text(FIXED_WIDTHS[8]);
  row[9] = "+886(2)0000-001";
  assert.equal(encodeBig5(row[6])?.length, 12);
  assert.equal(encodeBig5(row[8])?.length, 120);
  assert.equal(encodeBig5(row[9])?.length, 15);
  return row;
}

function warningRow(index) {
  const row = baseRow(index);
  row[4] = `MOCK${paddedNumber(index, 4)}`;
  return row;
}

function errorRow(index) {
  const row = baseRow(index);
  switch (index % 14) {
    case 0: row[0] = "C"; break;
    case 1: row[1] = "A1"; break;
    case 2: row[3] = "123456789"; break;
    case 3: row[5] = "20230230"; break;
    case 4: row[6] = ""; break;
    case 5: row[7] = "3"; break;
    case 6: row[8] = ""; break;
    case 7: row[9] = "TEL"; break;
    case 8: row[10] = "A123456788"; break;
    case 9: row[11] = "Z"; break;
    case 10: row[12] = "20230230"; break;
    case 11:
      row[12] = "20200101";
      row[13] = "20190101";
      row[14] = "1";
      break;
    case 12:
      row[13] = "20240101";
      row[14] = "";
      break;
    case 13:
      row[4] = validId(index + 20_000, 1);
      row[7] = "2";
      break;
  }
  return row;
}

function mixedRow(index, errorEvery, warningEvery, modifiedEvery) {
  if (index % errorEvery === 0) return errorRow(index);
  if (index % warningEvery === 0) return warningRow(index);
  const row = baseRow(index);
  if (index % modifiedEvery === 0) row[9] = "";
  return row;
}

const datasetDefinitions = [
  { name: "clean-single", rowCount: 1, category: "clean", makeRow: baseRow },
  { name: "clean-small-25", rowCount: 25, category: "clean", makeRow: baseRow },
  { name: "clean-medium-250", rowCount: 250, category: "clean", makeRow: baseRow },
  { name: "clean-large-6000", rowCount: 6_000, category: "clean", makeRow: baseRow },
  { name: "clean-boundaries", rowCount: 4, category: "clean", makeRow: boundaryRow },
  {
    name: "modified-phone-default",
    rowCount: 30,
    category: "modified",
    makeRow(index) {
      const row = baseRow(index);
      row[9] = "";
      return row;
    },
  },
  { name: "warning-optional-id", rowCount: 40, category: "warning", makeRow: warningRow },
  { name: "error-validation", rowCount: 40, category: "error", makeRow: errorRow },
  {
    name: "mixed-conditions-200",
    rowCount: 200,
    category: "mixed",
    makeRow: (index) => mixedRow(index, 17, 11, 7),
  },
  {
    name: "mixed-large-1200",
    rowCount: 1_200,
    category: "mixed",
    makeRow: (index) => mixedRow(index, 29, 19, 13),
  },
];

function assertSerializableRow(row, rowNumber) {
  assert.equal(row.length, FIXED_FIELD_COUNT, `第 ${rowNumber} 列必須有 ${FIXED_FIELD_COUNT} 欄`);
  row.forEach((value, fieldIndex) => {
    const encoded = encodeBig5(value);
    assert.ok(encoded, `第 ${rowNumber} 列欄位${fieldIndex + 1}必須可安全轉為 Big5`);
    assert.ok(
      encoded.length <= FIXED_WIDTHS[fieldIndex],
      `第 ${rowNumber} 列欄位${fieldIndex + 1}不得超過 ${FIXED_WIDTHS[fieldIndex]} bytes`,
    );
  });
}

function escapeCsv(value) {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function serializeCsv(rows) {
  return `${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}\r\n`;
}

function serializeSpreadsheet(rows, bookType) {
  const worksheet = utils.aoa_to_sheet(rows);
  const range = utils.decode_range(worksheet["!ref"] ?? "A1:O1");
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = 0; column < FIXED_FIELD_COUNT; column += 1) {
      const address = utils.encode_cell({ r: row, c: column });
      const cell = worksheet[address];
      if (cell) {
        cell.t = "s";
        cell.z = "@";
      }
    }
  }
  const workbook = utils.book_new(worksheet, "資料");
  return write(workbook, {
    type: "buffer",
    bookType,
    compression: bookType === "xlsx",
  });
}

function summarizeRows(definition, rows) {
  const file = createInternalFile(
    definition.name,
    `${definition.name}.csv`,
    { rows },
    GENERATED_TODAY,
  );
  const summary = file.summary;
  if (definition.category === "clean") {
    assert.equal(summary.errorCount, 0);
    assert.equal(summary.warningCount, 0);
    assert.equal(summary.modifiedCount, 0);
  } else if (definition.category === "modified") {
    assert.equal(summary.errorCount, 0);
    assert.equal(summary.warningCount, 0);
    assert.ok(summary.modifiedCount > 0);
  } else if (definition.category === "warning") {
    assert.equal(summary.errorCount, 0);
    assert.ok(summary.warningCount > 0);
  } else if (definition.category === "error") {
    assert.ok(summary.errorCount > 0);
  } else {
    assert.ok(summary.errorCount > 0);
    assert.ok(summary.warningCount > 0);
    assert.ok(summary.modifiedCount > 0);
  }
  return summary;
}

const generatedDatasets = datasetDefinitions.map((definition) => {
  assert.ok(definition.rowCount <= MAX_ROWS_PER_FILE);
  const rows = Array.from({ length: definition.rowCount }, (_, index) => definition.makeRow(index));
  rows.forEach(assertSerializableRow);
  return {
    ...definition,
    rows,
    summary: summarizeRows(definition, rows),
  };
});

const archiveDefinitions = [
  {
    name: "clean-mixed-formats.zip",
    entries: [
      ["clean/clean-single.csv", "csv", "clean-single"],
      ["clean/clean-small-25.xls", "xls", "clean-small-25"],
      ["clean/clean-medium-250.xlsx", "xlsx", "clean-medium-250"],
      ["clean/clean-boundaries.txt", "txt", "clean-boundaries"],
    ],
  },
  {
    name: "warning-mixed-formats.zip",
    entries: [
      ["warning/source.csv", "csv", "warning-optional-id"],
      ["warning/source.xls", "xls", "warning-optional-id"],
      ["warning/source.xlsx", "xlsx", "warning-optional-id"],
      ["warning/source.txt", "txt", "warning-optional-id"],
    ],
  },
  {
    name: "error-mixed-formats.zip",
    entries: [
      ["error/source.csv", "csv", "error-validation"],
      ["error/source.xls", "xls", "error-validation"],
      ["error/source.xlsx", "xlsx", "error-validation"],
      ["error/source.txt", "txt", "error-validation"],
    ],
  },
  {
    name: "mixed-nested-formats.zip",
    entries: [
      ["batch/a/mixed.csv", "csv", "mixed-conditions-200"],
      ["batch/b/mixed.xls", "xls", "mixed-conditions-200"],
      ["batch/c/mixed.xlsx", "xlsx", "mixed-large-1200"],
      ["batch/d/mixed.txt", "txt", "modified-phone-default"],
    ],
  },
];

async function writeArchives() {
  mkdirSync(formatDirectories.zip, { recursive: true });
  for (const archive of archiveDefinitions) {
    const entries = archive.entries.map(([path, format, dataset]) => ({
      path,
      bytes: new Uint8Array(readFileSync(join(formatDirectories[format], `${dataset}.${format}`))),
    }));
    writeFileSync(join(formatDirectories.zip, archive.name), await serializeZip(entries));
  }
}

async function generateAll() {
  for (const directory of Object.values(formatDirectories)) {
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
  }

  for (const dataset of generatedDatasets) {
    const serializableRows = dataset.rows.map((values, index) => ({ sourceRow: index + 1, values }));
    writeFileSync(join(formatDirectories.csv, `${dataset.name}.csv`), serializeCsv(dataset.rows), "utf8");
    writeFileSync(join(formatDirectories.xls, `${dataset.name}.xls`), serializeSpreadsheet(dataset.rows, "biff8"));
    writeFileSync(join(formatDirectories.xlsx, `${dataset.name}.xlsx`), serializeSpreadsheet(dataset.rows, "xlsx"));
    writeFileSync(join(formatDirectories.txt, `${dataset.name}.txt`), serializeBig5Txt(serializableRows));
  }

  await writeArchives();

  const dataFileCount = generatedDatasets.length * 4 + archiveDefinitions.length;
  assert.ok(dataFileCount <= MAX_DATA_FILES);
  const manifest = {
    generatedAt: "2026-08-04",
    deterministicToday: GENERATED_TODAY,
    fieldNameNote: FIELD_NAME_NOTE,
    fixedRecordWidthBytes: FIXED_RECORD_WIDTH_BYTES,
    maximumRowsPerFile: MAX_ROWS_PER_FILE,
    maximumDistinctDataFiles: MAX_DATA_FILES,
    generatedDataFileCount: dataFileCount,
    fieldNames: FIELD_NAMES.map((name, index) => ({
      field: index + 1,
      name,
      widthBytes: FIXED_WIDTHS[index],
    })),
    formats: ["csv", "xls", "xlsx", "txt"],
    datasets: generatedDatasets.map(({ name, rowCount, category, summary }) => ({
      name,
      rowCount,
      category,
      expectedSummary: summary,
    })),
    archives: archiveDefinitions.map((archive) => ({
      name: archive.name,
      entries: archive.entries.map(([path, format, dataset]) => ({ path, format, dataset })),
    })),
  };
  writeFileSync(join(testdataDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

if (process.argv.includes("--archives-only")) {
  await writeArchives();
  console.log(`Regenerated ${archiveDefinitions.length} ZIP files from the current format folders.`);
} else {
  await generateAll();
  console.log(
    `Generated ${generatedDatasets.length} logical datasets in CSV, XLS, XLSX, and Big5 TXT, plus ${archiveDefinitions.length} mixed-format ZIP files.`,
  );
  console.log(`Largest dataset: ${Math.max(...generatedDatasets.map((dataset) => dataset.rowCount))} rows; total data files: ${generatedDatasets.length * 4 + archiveDefinitions.length}.`);
  console.log(`Example output: ${basename(join(formatDirectories.csv, "clean-large-6000.csv"))}`);
}
