import assert from "node:assert/strict";
import test from "node:test";

import {
  compactInternalFile,
  compactValue,
  materializeCompactRow,
} from "../src/app/batch/compact-workspace.ts";
import { createInternalFile } from "../src/core/conversion-pipeline.ts";

function validRow(overrides = {}) {
  const row = [
    "A", "01", "1", "1234567890", "A123456789", "20000101", "測試",
    "1", "測試地址", "0212345678", "A123456789", "A", "20200101", "", "",
  ];
  Object.entries(overrides).forEach(([field, value]) => { row[Number(field) - 1] = value; });
  return row;
}

test("packs fixed domains and uses dictionaries only below ten distinct values", () => {
  const file = createInternalFile("compact", "compact.csv", {
    rows: Array.from({ length: 10 }, (_, index) => validRow({
      4: String(index % 9).padStart(10, "0"),
      7: `姓名${index}`,
      9: `地址${index}`,
    })),
  }, "20260822");
  const compact = compactInternalFile(file);

  assert.deepEqual([0, 1, 2, 7, 11, 14].map((index) => compact.columns[index]?.kind),
    Array(6).fill("packed"));
  assert.equal(compact.columns[3]?.kind, "dictionary");
  assert.equal(compact.columns[3]?.values.length, 9);
  assert.equal(compact.columns[8]?.kind, "strings", "the tenth distinct value uses raw strings");
  assert.equal(compact.columns[10]?.kind, "dictionary");
  assert.equal(compact.columns[10]?.values.length, 1);
  assert.deepEqual(file.rows.map((row) => row.cells.map((cell) => cell.finalValue ?? cell.normalizedValue)),
    file.rows.map((_, rowIndex) => Array.from({ length: 15 }, (__, columnIndex) => (
      compactValue(compact, rowIndex, columnIndex)
    ))));
});

test("keeps an invalid packed value and its issue together without padding it", () => {
  const file = createInternalFile("invalid", "invalid.csv", { rows: [validRow({ 2: "2" })] }, "20260822");
  const compact = compactInternalFile(file);
  const row = materializeCompactRow(compact, 0);

  assert.equal(compact.columns[1]?.kind, "packed");
  assert.equal(row.cells[1]?.normalizedValue, "2");
  assert.equal(compactValue(compact, 0, 1), "2");
  assert.deepEqual(row.cells[1]?.issues, file.rows[0]?.cells[1]?.issues);
});

test("preserves packed base values, sparse final values, row changes, and issues", () => {
  const file = createInternalFile("changed", "changed.csv", { rows: [validRow({ 8: "2" })] }, "20260822");
  const compact = compactInternalFile(file);
  const row = materializeCompactRow(compact, 0);

  assert.equal(row.cells[7]?.normalizedValue, "2");
  assert.equal(row.cells[7]?.finalValue, "1");
  assert.equal(compactValue(compact, 0, 7), "1");
  assert.deepEqual(row.changes, file.rows[0]?.changes);
  assert.deepEqual(row.issues, file.rows[0]?.issues);
});

test("materializes the same worker-facing IR after packing and dictionary fallback", () => {
  const file = createInternalFile("round-trip", "round-trip.csv", {
    rows: Array.from({ length: 12 }, (_, index) => validRow({
      2: index === 0 ? "2" : String(index).padStart(2, "0"),
      5: index === 1 ? "a123456789" : "A123456789",
      7: `姓名${index}`,
      8: index === 1 ? "2" : "1",
      9: `地址${index}`,
      10: index === 1 ? "" : "0212345678",
      11: index === 1 ? "a123456789" : "A123456789",
    })),
  }, "20260822");
  const compact = compactInternalFile(file);
  const workerFacingRows = file.rows.map((row) => ({
    ...row,
    cells: row.cells.map(({ sourceValue: _sourceValue, ...cell }) => cell),
  }));

  assert.deepEqual(
    Array.from({ length: file.rows.length }, (_, rowIndex) => materializeCompactRow(compact, rowIndex)),
    workerFacingRows,
  );
});
