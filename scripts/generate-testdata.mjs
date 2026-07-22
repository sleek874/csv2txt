import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import iconv from "iconv-lite";
import * as cptable from "xlsx/dist/cpexcel.full.mjs";
import { set_cptable, utils, write } from "xlsx";

set_cptable(cptable);

const WIDTHS = [1, 2, 1, 10, 10, 8, 12, 1, 120, 15, 10, 1, 8, 8, 1];
const RECORD_COUNT = 200;
const fixtureDirectory = fileURLToPath(new URL("../tests/fixtures/", import.meta.url));

const familyNames = ["王", "陳", "林", "張", "李", "黃", "吳", "劉", "蔡", "楊"];
const givenNames = ["小明", "美玲", "志宏", "雅婷", "建國", "怡君", "俊傑", "淑芬", "承翰", "麗華"];
const cities = ["台北市", "新北市", "桃園市", "台中市", "台南市", "高雄市"];
const districts = ["測試區", "範例區", "和平區", "幸福區", "文化區", "中央區"];
const streets = ["範例路", "測試街", "和平路", "幸福街", "文化路", "中央街"];
const categoryCharacters = ["甲", "乙", "丙", "丁"];

let randomState = 0x5eed1234;

function randomInteger(maximum) {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState % maximum;
}

function pick(values) {
  return values[randomInteger(values.length)];
}

function paddedNumber(value, length) {
  return String(value).padStart(length, "0");
}

function fakeDate(year, index) {
  const month = (index % 12) + 1;
  const day = (index % 28) + 1;
  return `${year}${paddedNumber(month, 2)}${paddedNumber(day, 2)}`;
}

function ordinaryAddress(index) {
  const city = pick(cities);
  const district = pick(districts);
  const street = pick(streets);
  const number = (index * 17) % 999 + 1;
  const floor = index % 12 + 1;

  if (index === 2) {
    return `${city}${district}${street}${number}號,${floor}樓`;
  }

  if (index === 3) {
    return `${city}${district}${street}${number}號"測試戶"${floor}樓`;
  }

  if (index === 4) {
    return `${city} ${district}${street}${number}號 ${floor}樓`;
  }

  return `${city}${district}${street}${number}號${floor}樓`;
}

function exactWidthAddress() {
  const text = "台北市測試區範例路壹貳參肆伍陸柒捌玖拾號".repeat(3);
  return [...text].slice(0, 60).join("");
}

function makeValidRow(index) {
  const sequence = index + 1;
  const name = index === 0
    ? "歐陽王小明"
    : `${pick(familyNames)}${pick(givenNames)}`;
  const address = index === 0 ? exactWidthAddress() : ordinaryAddress(sequence);

  return [
    ["A", "B", "C"][randomInteger(3)],
    pick(categoryCharacters),
    sequence % 2 === 0 ? "1" : "0",
    `TST${paddedNumber(sequence, 7)}`,
    name,
    fakeDate(1970 + (sequence % 35), sequence),
    paddedNumber(sequence, 12),
    ["N", "R", "S"][randomInteger(3)],
    address,
    `FAKE${paddedNumber(sequence, 11)}`,
    paddedNumber((sequence * 7919) % 10_000_000_000, 10),
    sequence % 3 === 0 ? "N" : "Y",
    fakeDate(2026, sequence + 3),
    `B${paddedNumber(sequence, 7)}`,
    ["0", "1", "2"][randomInteger(3)],
  ];
}

function big5Bytes(value) {
  return iconv.encode(value, "big5");
}

function assertValidRow(row, rowNumber) {
  assert.equal(row.length, WIDTHS.length, `record ${rowNumber} must contain 15 fields`);

  row.forEach((value, fieldIndex) => {
    const encoded = big5Bytes(value);
    const decoded = iconv.decode(encoded, "big5");
    assert.equal(decoded, value, `record ${rowNumber}, field ${fieldIndex + 1} is not Big5-safe`);
    assert.ok(
      encoded.length <= WIDTHS[fieldIndex],
      `record ${rowNumber}, field ${fieldIndex + 1} uses ${encoded.length} of ${WIDTHS[fieldIndex]} bytes`,
    );
  });
}

function escapeCsv(value) {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function serialize(rows) {
  return `${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}\r\n`;
}

function serializeSpreadsheet(rows, bookType) {
  const worksheet = utils.aoa_to_sheet(rows);
  const workbook = utils.book_new(worksheet, "資料");
  return write(workbook, {
    type: "buffer",
    bookType,
    compression: bookType === "xlsx",
  });
}

function writeFixtureSet(baseName, rows) {
  writeFileSync(join(fixtureDirectory, `${baseName}.utf8.csv`), serialize(rows), "utf8");
  writeFileSync(join(fixtureDirectory, `${baseName}.xls`), serializeSpreadsheet(rows, "biff8"));
  writeFileSync(join(fixtureDirectory, `${baseName}.xlsx`), serializeSpreadsheet(rows, "xlsx"));
}

const validRows = Array.from({ length: RECORD_COUNT }, (_, index) => makeValidRow(index));
validRows.forEach((row, index) => assertValidRow(row, index + 1));
assert.equal(big5Bytes(validRows[0][4]).length, WIDTHS[4]);
assert.equal(big5Bytes(validRows[0][8]).length, WIDTHS[8]);

const invalidRows = Array.from({ length: 5 }, (_, index) => [...validRows[index + 10]]);
invalidRows[0][0] = "AB"; // Field 1: 2 bytes, maximum 1.
invalidRows[1][4] = "超過五個中文字"; // Field 5: more than 10 Big5 bytes.
invalidRows[2][8] = "測".repeat(61); // Field 9: 122 bytes, maximum 120.
invalidRows[3][8] = "台北市測試路😀一號"; // Field 9: emoji cannot be represented in Big5.
invalidRows[4][9] = "FAKE-ID-TOO-LONG"; // Field 10: 16 bytes, maximum 15.
invalidRows.forEach((row, index) => {
  assert.equal(row.length, WIDTHS.length, `invalid record ${index + 1} must still contain 15 fields`);
});

mkdirSync(fixtureDirectory, { recursive: true });
writeFixtureSet("synthetic-valid-200", validRows);
writeFixtureSet("synthetic-invalid-boundaries", invalidRows);

console.log(
  `Generated CSV, XLS, and XLSX fixtures with ${validRows.length} valid records and ${invalidRows.length} invalid records.`,
);
