import assert from "node:assert/strict";
import test from "node:test";

import { createInternalFile } from "../src/core/conversion-pipeline.ts";
import {
  FIXED_FIELDS,
  FIXED_RECORD_WIDTH_BYTES,
  FIXED_WIDTHS,
} from "../src/core/fixed-profile.ts";
import { serializeFixedWidthBig5 } from "../src/core/fixed-width.ts";
import { parseFixedWidthBig5 } from "../src/core/fixed-width-inverse.ts";
import {
  isValidNewResidentId,
  isValidTaiwanNationalId,
} from "../src/core/validation.ts";

function validRow(overrides = {}) {
  const row = [
    "A", "01", "1", "0000000001", "A123456789",
    "20000101", "中文", "1", "台北", "",
    "A123456789", "A", "20200101", "", "",
  ];
  Object.entries(overrides).forEach(([fieldIndex, value]) => {
    row[Number(fieldIndex) - 1] = value;
  });
  return row;
}

function issuesFor(file) {
  return [
    ...file.issues,
    ...file.rows.flatMap((row) => [
      ...row.issues,
      ...row.cells.flatMap((cell) => cell.issues),
    ]),
  ];
}

test("normalizes one shared row, records the telephone change, and emits 208-byte Big5 records", () => {
  const file = createInternalFile(
    "file-1",
    "sample.csv",
    { rows: [[...validRow(), "ignored"], ["　", " "]] },
    "20260803",
  );

  assert.equal(file.summary.sourceRows, 2);
  assert.equal(file.summary.excludedBlankRows, 1);
  assert.equal(file.summary.errorCount, 1, "the extra source column remains a visible error");
  assert.equal(file.rows[0]?.included, false);
  assert.throws(() => serializeFixedWidthBig5(file), /尚未選擇任何輸出列/u);

  const validFile = createInternalFile(
    "file-2",
    "sample.csv",
    { rows: [[" A ", ...validRow().slice(1)]] },
    "20260803",
  );
  assert.equal(validFile.summary.errorCount, 0);
  assert.equal(validFile.summary.modifiedCount, 1);
  assert.equal(validFile.rows[0]?.included, true);
  assert.equal(validFile.rows[0]?.cells[9]?.finalValue, "0000000000");

  const bytes = serializeFixedWidthBig5(validFile);
  assert.equal(bytes.length, FIXED_RECORD_WIDTH_BYTES + 2);
  assert.deepEqual(bytes.slice(-2), new Uint8Array([0x0d, 0x0a]));

  const parsed = parseFixedWidthBig5(bytes, FIXED_WIDTHS);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.rows[0], validRow({ 10: "0000000000" }));
});

test("blocks checksum, date, cross-field, width, and Big5 failures without hidden correction", () => {
  const file = createInternalFile(
    "file-1",
    "invalid.xlsx",
    {
      rows: [validRow({
        5: "ABCDE",
        6: "20260230",
        7: "😀",
        8: "2",
        11: "A123456788",
        13: "20210101",
        14: "20200101",
        15: "",
      })],
    },
    "20260803",
  );
  const issues = issuesFor(file);

  assert.ok(issues.some((issue) => issue.code === "OPTIONAL_ID_INVALID" && issue.severity === "warning"));
  assert.ok(issues.some((issue) => issue.code === "UNENCODABLE_BIG5"));
  assert.ok(issues.some((issue) => issue.code === "REQUIRED_ID_INVALID"));
  assert.ok(issues.some((issue) => issue.code === "INVALID_DATE"));
  assert.ok(issues.some((issue) => issue.code === "OPTIONAL_FIELDS_MISMATCH"));
  assert.ok(issues.some((issue) => issue.code === "DATE_ORDER_INVALID"));
  assert.equal(file.summary.errorCount > 0, true);
});

test("uses regex alone for field format and empty-value acceptance", () => {
  const expectedPatterns = new Map([
    [5, "^[a-z0-9]{5,10}$"],
    [7, "^.+$"],
    [9, "^.+$"],
    [14, "^(?:[0-9]{8})?$"],
    [15, "^[1-4]?$"],
  ]);
  expectedPatterns.forEach((pattern, fieldIndex) => {
    assert.equal(FIXED_FIELDS[fieldIndex - 1]?.pattern.source, pattern);
  });

  const validFile = createInternalFile(
    "regex-valid",
    "regex-valid.csv",
    { rows: [validRow({ 5: "ab123", 7: "中", 9: "台北", 14: "", 15: "" })] },
    "20260803",
  );
  assert.equal(validFile.summary.errorCount, 0, "only the field 14/15 pair may be empty");

  const invalidFile = createInternalFile(
    "regex-invalid",
    "regex-invalid.csv",
    { rows: [validRow({ 5: "AB-12", 7: "", 9: "", 14: "2020", 15: "9" })] },
    "20260803",
  );
  const formatIssues = issuesFor(invalidFile)
    .filter((issue) => issue.code === "PATTERN_MISMATCH");
  assert.deepEqual(
    [...new Set(formatIssues.map((issue) => issue.fieldIndex))].sort((left, right) => left - right),
    [5, 7, 9, 14, 15],
  );
  assert.equal(issuesFor(invalidFile).some((issue) => issue.code === "MISSING_REQUIRED"), false);
});

test("accepts valid new resident IDs in field 5 and maps their sex code", () => {
  assert.equal(isValidTaiwanNationalId("A123456789"), true);
  assert.equal(isValidNewResidentId("A800000014"), true);
  assert.equal(isValidNewResidentId("A900000016"), true);
  assert.equal(isValidNewResidentId("A800000015"), false);

  for (const [residentId, field8] of [
    ["A800000014", "1"],
    ["A900000016", "2"],
  ]) {
    const file = createInternalFile(
      `resident-${field8}`,
      "resident.csv",
      { rows: [validRow({ 5: residentId, 8: field8 })] },
      "20260803",
    );
    const issues = issuesFor(file);
    assert.equal(issues.some((issue) => issue.code === "OPTIONAL_ID_INVALID"), false);
    assert.equal(issues.some((issue) => issue.code === "ID_GENDER_MISMATCH"), false);
  }

  const mismatchFile = createInternalFile(
    "resident-mismatch",
    "resident-mismatch.csv",
    { rows: [validRow({ 5: "A800000014", 8: "2" })] },
    "20260803",
  );
  const mismatchIssues = issuesFor(mismatchFile);
  assert.equal(mismatchIssues.some((issue) => issue.code === "OPTIONAL_ID_INVALID"), false);
  const genderMismatch = mismatchIssues.find((issue) => issue.code === "ID_GENDER_MISMATCH");
  assert.equal(genderMismatch?.severity, "error");
  assert.equal(mismatchFile.summary.errorCount, 1);
  assert.equal(mismatchFile.rows[0]?.included, false);

  const invalidFile = createInternalFile(
    "resident-invalid",
    "resident-invalid.csv",
    { rows: [validRow({ 5: "A800000015", 8: "1" })] },
    "20260803",
  );
  assert.equal(
    issuesFor(invalidFile).some((issue) => issue.code === "OPTIONAL_ID_INVALID"),
    true,
  );
  assert.equal(invalidFile.summary.warningCount, 1);
  assert.equal(invalidFile.summary.errorCount, 0);
  assert.equal(invalidFile.rows[0]?.included, false);
});

test("defaults issue rows to excluded and serializes them only after an explicit row decision", () => {
  const file = createInternalFile(
    "row-output-decisions",
    "row-output-decisions.csv",
    {
      rows: [
        validRow(),
        validRow({ 5: "A123456789", 8: "2", 9: "" }),
      ],
    },
    "20260803",
  );

  assert.deepEqual(file.rows.map((row) => row.included), [true, false]);
  assert.equal(file.summary.includedRows, 1);
  assert.equal(issuesFor(file).some((issue) => issue.code === "ID_GENDER_MISMATCH"), true);
  assert.equal(
    issuesFor(file).some((issue) => issue.code === "PATTERN_MISMATCH" && issue.fieldIndex === 9),
    true,
  );
  assert.equal(serializeFixedWidthBig5(file).length, FIXED_RECORD_WIDTH_BYTES + 2);

  file.rows[1].included = true;
  assert.equal(serializeFixedWidthBig5(file).length, (FIXED_RECORD_WIDTH_BYTES + 2) * 2);
});
