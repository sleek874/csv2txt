import assert from "node:assert/strict";
import test from "node:test";

import {
  ADVANCED_PRIMARY_HEADERS,
  collectAdvancedPrimaryRows,
  joinAdvancedRows,
} from "../src/core/advanced/lookup.ts";

function internalRow(sourceRow, values, included = true) {
  return {
    blankSourceRows: [],
    cells: values.map((normalizedValue, index) => ({
      fieldIndex: index + 1,
      issues: [],
      normalizedValue,
    })),
    changes: [],
    included,
    issues: [],
    sourceRow,
  };
}

function internalFile(virtualPath, rows) {
  return {
    id: virtualPath,
    issues: [],
    metadata: {},
    rejectedRecords: [],
    rows,
    summary: {
      blankRows: 0,
      correctRows: rows.length,
      dataRows: rows.length,
      errorRows: 0,
      includedRows: rows.filter((row) => row.included).length,
      rejectedRows: 0,
      sourceRecords: rows.length,
      warningRows: 0,
    },
    virtualPath,
  };
}

function fixedValues({ field5, field6, field8 = "1", field11 }) {
  const values = Array(15).fill("");
  values[4] = field5;
  values[5] = field6;
  values[6] = "欄位7值";
  values[7] = field8;
  values[8] = "欄位9值";
  values[9] = "0912345678";
  values[10] = field11;
  values[11] = "A";
  return values;
}

test("collects every checked row without deduplicating field 5", () => {
  const duplicateValues = fixedValues({
    field5: "same-key",
    field6: "20000805",
    field11: "a123456789",
  });
  const rows = collectAdvancedPrimaryRows([
    internalFile("one.csv", [
      internalRow(2, duplicateValues),
      internalRow(3, duplicateValues),
      internalRow(4, duplicateValues, false),
    ]),
  ], 2026);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.sourceRow), [2, 3]);
  assert.deepEqual(rows.map((row) => row.values[0]), ["same-key", "same-key"]);
  assert.deepEqual(rows.map((row) => row.values[2]), ["26", "26"]);
  assert.deepEqual(rows.map((row) => row.lookupKey), ["A123456789", "A123456789"]);
});

test("maps field 8 values for advanced output without adding a validation gate", () => {
  const rows = collectAdvancedPrimaryRows([
    internalFile("one.csv", [
      internalRow(1, fixedValues({ field5: "P1", field6: "20000101", field8: "1", field11: "A123456789" })),
      internalRow(2, fixedValues({ field5: "P2", field6: "20000101", field8: "2", field11: "B123456789" })),
      internalRow(3, fixedValues({ field5: "P3", field6: "20000101", field8: "9", field11: "C123456789" })),
    ]),
  ], 2026);

  assert.deepEqual(rows.map((row) => row.values[4]), ["男", "女", "9"]);
});

test("expands duplicate reference matches and keeps unmatched rows", () => {
  const primaryRows = collectAdvancedPrimaryRows([
    internalFile("one.csv", [
      internalRow(1, fixedValues({ field5: "P1", field6: "19900101", field11: "A123456789" })),
      internalRow(2, fixedValues({ field5: "P2", field6: "19920202", field11: "B123456789" })),
    ]),
  ], 2026);
  const result = joinAdvancedRows(primaryRows, {
    headers: ["身分證字號", "欄位7", "給付狀態"],
    rows: [
      [" a123456789 ", "參照甲", "完成"],
      ["A123456789", "參照乙", "待辦"],
      ["C123456789", "參照丙", "完成"],
    ],
  }, 0, [1, 2]);

  assert.equal(result.selectedRowCount, 2);
  assert.equal(result.matchedRowCount, 1);
  assert.equal(result.unmatchedRowCount, 1);
  assert.equal(result.resultRowCount, 3);
  assert.deepEqual(result.headers, [
    ...ADVANCED_PRIMARY_HEADERS,
    "參照：欄位7",
    "給付狀態",
  ]);
  assert.deepEqual(result.rows.map((row) => row.slice(-2)), [
    ["參照甲", "完成"],
    ["參照乙", "待辦"],
    ["", ""],
  ]);
});

test("allows downloading primary columns when no reference output columns are selected", () => {
  const primaryRows = collectAdvancedPrimaryRows([
    internalFile("one.csv", [
      internalRow(1, fixedValues({ field5: "P1", field6: "20000101", field11: "A123456789" })),
    ]),
  ], 2026);
  const result = joinAdvancedRows(primaryRows, {
    headers: ["ID"],
    rows: [],
  }, 0, []);

  assert.deepEqual(result.headers, ADVANCED_PRIMARY_HEADERS);
  assert.equal(result.unmatchedRowCount, 1);
  assert.equal(result.rows[0]?.length, ADVANCED_PRIMARY_HEADERS.length);
});
