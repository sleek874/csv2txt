import assert from "node:assert/strict";
import test from "node:test";

import { createOutputAdapter } from "../src/app/adapters/output-adapter.ts";
import { createCodecManager } from "../src/app/resources/codec-manager.ts";
import {
  createInternalFile,
  createInternalFileWithRecovery,
} from "../src/core/conversion-pipeline.ts";
import {
  FIXED_FIELDS,
  FIXED_RECORD_WIDTH_BYTES,
  FIXED_WIDTHS,
} from "../src/core/fixed-profile.ts";
import { parseBig5Txt } from "../src/core/formats/big5-txt.ts";
import { issueFieldIndices } from "../src/core/internal-model.ts";
import {
  isValidNewResidentId,
  isValidTaiwanNationalId,
} from "../src/core/validation.ts";

const outputAdapter = createOutputAdapter(createCodecManager());

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

test("normalizes one shared row, records the telephone change, and emits 208-byte BIG-5E records", async () => {
  const file = createInternalFile(
    "file-1",
    "sample.csv",
    { rows: [[...validRow(), "ignored"], ["　", " "]] },
    "20260803",
  );

  assert.equal(file.summary.sourceRecords, 2);
  assert.equal(file.summary.blankRows, 1);
  assert.equal(file.summary.rejectedRows, 1, "the extra source column stays outside the IR");
  assert.equal(file.summary.dataRows, 0);
  assert.equal(file.summary.errorRows, 0);
  assert.equal(file.summary.warningRows, 0, "blank rows are counted separately");
  assert.equal(file.summary.correctRows, 0);
  assert.equal(file.rows.length, 0);
  assert.equal(file.summary.includedRows, 0);
  assert.equal(file.rejectedRecords[0]?.original.endsWith("｜ignored"), true);
  assert.match(file.rejectedRecords[0]?.technicalDetail ?? "", /16 個欄位/u);

  const validFile = createInternalFile(
    "file-2",
    "sample.csv",
    { rows: [[" A ", ...validRow().slice(1)]] },
    "20260803",
  );
  assert.equal(validFile.summary.errorRows, 0);
  assert.equal(validFile.summary.warningRows, 1);
  assert.equal(validFile.summary.correctRows, 0);
  assert.equal(validFile.rows[0]?.included, true);
  assert.equal(validFile.rows[0]?.cells[9]?.finalValue, "0000000000");

  const bytes = (await outputAdapter.create([validFile], "big5-txt")).bytes;
  assert.equal(bytes.length, FIXED_RECORD_WIDTH_BYTES + 2);
  assert.deepEqual(bytes.slice(-2), new Uint8Array([0x0d, 0x0a]));

  const parsed = parseBig5Txt(bytes, FIXED_WIDTHS);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.rows[0], validRow({ 10: "0000000000" }));
});

test("keeps semantic validation in the shared IR without applying an output codec", () => {
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
  assert.equal(issues.some((issue) => issue.code === "UNENCODABLE_BIG5E"), false);
  assert.equal(issues.some((issue) => issue.code === "WIDTH_OVERFLOW"), false);
  assert.ok(issues.some((issue) => issue.code === "REQUIRED_ID_INVALID"));
  assert.ok(issues.some((issue) => issue.code === "INVALID_DATE"));
  assert.deepEqual(
    issueFieldIndices(issues.find((issue) => issue.code === "OPTIONAL_FIELDS_MISMATCH")),
    [14, 15],
  );
  assert.deepEqual(
    issueFieldIndices(issues.find((issue) => issue.code === "DATE_ORDER_INVALID")),
    [13, 14],
  );
  assert.equal(file.summary.errorRows > 0, true);
});

test("recovers known legacy PUA values and warns for verification", async () => {
  const privateUse = String.fromCodePoint(0xe808);
  const file = await createInternalFileWithRecovery(
    "private-use",
    "private-use.xlsx",
    { rows: [validRow({ 7: `王${privateUse}` })] },
    "20260803",
  );
  const issues = issuesFor(file);
  const warning = issues.find((issue) => issue.code === "PRIVATE_USE_RECOVERED");

  assert.equal(warning?.severity, "warning");
  assert.equal(warning?.fieldIndex, 7);
  assert.equal(warning?.message, "請確認字元。");
  assert.equal(file.rows[0]?.cells[6]?.normalizedValue, `王${privateUse}`);
  assert.equal(file.rows[0]?.cells[6]?.finalValue, "王堃");
  assert.deepEqual(file.rows[0]?.changes.find((change) => change.fieldIndex === 7), {
    kind: "private-use-recovery",
    sourceRow: 1,
    fieldIndex: 7,
    before: `王${privateUse}`,
    after: "王堃",
    reason: "已還原舊系統字元",
  });
  assert.equal(issues.some((issue) => issue.severity === "error"), false);
  assert.equal(file.rows[0]?.included, true);
});

test("recovers an unambiguous CNS character for review before output gating", async () => {
  const privateUse = String.fromCodePoint(0xf4d1);
  const file = await createInternalFileWithRecovery(
    "cns-recovery",
    "cns-recovery.xlsx",
    { rows: [validRow({ 7: privateUse })] },
    "20260803",
  );

  assert.equal(file.rows[0]?.cells[6]?.normalizedValue, privateUse);
  assert.equal(file.rows[0]?.cells[6]?.finalValue, "𥠄");
  assert.equal(issuesFor(file).some((issue) => issue.code === "PRIVATE_USE_RECOVERED"), true);
  assert.equal(file.summary.errorRows, 0);
  assert.equal(file.summary.warningRows, 1);

  assert.equal((await outputAdapter.create([file], "csv")).filename, "cns-recovery.csv");
  const txt = await outputAdapter.create([file], "big5-txt");
  assert.equal(parseBig5Txt(txt.bytes).rows[0]?.[6], "？");
});

test("keeps U+E088 unresolved instead of guessing the address character", async () => {
  const privateUse = String.fromCodePoint(0xe088);
  const file = await createInternalFileWithRecovery(
    "unresolved-address",
    "unresolved-address.xlsx",
    { rows: [validRow({ 7: `台中市外埔區${privateUse}子路` })] },
    "20260803",
  );
  const issue = issuesFor(file).find((candidate) => candidate.code === "PRIVATE_USE_REMAINS");

  assert.equal(file.rows[0]?.cells[6]?.finalValue, undefined);
  assert.equal(issue?.severity, "error");
  assert.equal(issue?.message, "字元無法還原。");
  assert.equal(file.summary.errorRows, 1);
  assert.equal(file.summary.warningRows, 0);
  assert.equal(file.rows[0]?.included, true);
});

test("keeps unresolved PUA values for review and defers output compatibility", async () => {
  const privateUse = String.fromCodePoint(0xf0000);
  const file = await createInternalFileWithRecovery(
    "private-use-unresolved",
    "private-use-unresolved.xlsx",
    { rows: [validRow({ 7: `王${privateUse}` })] },
    "20260803",
  );
  const issues = issuesFor(file);
  const remaining = issues.find((issue) => issue.code === "PRIVATE_USE_REMAINS");

  assert.equal(remaining?.severity, "error");
  assert.equal(remaining?.message, "字元無法還原。");
  assert.equal(file.rows[0]?.cells[6]?.normalizedValue, `王${privateUse}`);
  assert.equal(file.rows[0]?.cells[6]?.finalValue, undefined);
  assert.equal(file.rows[0]?.changes.some((change) => change.fieldIndex === 7), false);
  assert.equal(file.summary.errorRows, 1);
  assert.equal(file.summary.warningRows, 0);
  assert.equal(file.rows[0]?.included, true);

  assert.equal((await outputAdapter.create([file], "csv")).filename, "private-use-unresolved.csv");
  const txt = await outputAdapter.create([file], "big5-txt");
  assert.equal(parseBig5Txt(txt.bytes).rows[0]?.[6], "王？");
});

test("records recovered characters and keeps unresolved characters for review", async () => {
  const recoverable = String.fromCodePoint(0xe808);
  const unresolved = String.fromCodePoint(0xf0000);
  const file = await createInternalFileWithRecovery(
    "private-use-mixed",
    "private-use-mixed.xlsx",
    { rows: [validRow({ 7: `王${recoverable}${unresolved}` })] },
    "20260803",
  );
  const issues = issuesFor(file);

  assert.equal(file.rows[0]?.cells[6]?.normalizedValue, `王${recoverable}${unresolved}`);
  assert.equal(file.rows[0]?.cells[6]?.finalValue, `王堃${unresolved}`);
  assert.equal(file.rows[0]?.changes.some((change) => change.kind === "private-use-recovery"), true);
  assert.equal(issues.some((issue) => issue.code === "PRIVATE_USE_RECOVERED"), false);
  assert.equal(issues.some((issue) => issue.code === "PRIVATE_USE_REMAINS"), true);
  assert.equal(file.summary.errorRows, 1);
  assert.equal(file.summary.warningRows, 0);
  assert.equal(file.rows[0]?.included, true);
});

test("keeps valid Unicode out of shared row findings regardless of BIG-5E mapping", async () => {
  const file = await createInternalFileWithRecovery(
    "unicode-review",
    "unicode-review.xlsx",
    { rows: [validRow({ 7: "台中市外埔區廍子路", 10: "0212345678" })] },
    "20260803",
  );
  assert.equal(
    issuesFor(file).some((issue) => issue.code === "CHARACTER_REVIEW_REQUIRED"),
    false,
  );
  assert.equal(file.summary.correctRows, 1);
  assert.equal(file.summary.warningRows, 0);
  assert.equal(file.rows[0]?.included, true);
});

test("uses regex for the contract but presents friendly format errors", () => {
  const expectedPatterns = new Map([
    [5, "^[A-Z0-9]{5,10}$"],
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
    { rows: [validRow({ 5: "ab123", 7: "中", 9: "台北", 11: "a123456789", 14: "", 15: "" })] },
    "20260803",
  );
  assert.equal(validFile.summary.errorRows, 0, "only the field 14/15 pair may be empty");
  assert.equal(validFile.rows[0]?.cells[4]?.normalizedValue, "AB123");
  assert.equal(validFile.rows[0]?.cells[10]?.normalizedValue, "A123456789");

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
  const messages = new Map(formatIssues.map((issue) => [issue.fieldIndex, issue.message]));
  assert.equal(messages.get(5), "請輸入 5 至 10 個英文字母或數字。");
  assert.equal(messages.get(7), "此欄位不能空白。");
  assert.equal(messages.get(9), "此欄位不能空白。");
  assert.equal(messages.get(14), "請輸入 8 位西元日期，例如 20250831，或留空。");
  assert.equal(messages.get(15), "只能填 1 至 4，或留空。");
  assert.equal(formatIssues.some((issue) => issue.message.includes("固定規則")), false);
  assert.equal(formatIssues.some((issue) => issue.message.includes("^")), false);
  assert.equal(issuesFor(invalidFile).some((issue) => issue.code === "MISSING_REQUIRED"), false);

  const malformedId = createInternalFile(
    "malformed-id",
    "malformed-id.csv",
    { rows: [validRow({ 11: "BAD" })] },
    "20260803",
  );
  const idIssues = issuesFor(malformedId);
  assert.equal(
    idIssues.find((issue) => issue.code === "PATTERN_MISMATCH" && issue.fieldIndex === 11)?.message,
    "請輸入 1 個大寫英文字母與 9 位數字，第二碼須為 1 或 2。",
  );
  assert.equal(idIssues.some((issue) => issue.code === "REQUIRED_ID_INVALID"), false);
});

test("accepts valid field-5 IDs and corrects a mismatched gender with a warning", () => {
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
  assert.equal(genderMismatch?.severity, "warning");
  assert.equal(genderMismatch?.message, "欄位8已依欄位5的有效證號修正，請確認。");
  assert.deepEqual(issueFieldIndices(genderMismatch), [5, 8]);
  assert.equal(mismatchFile.rows[0]?.cells[7]?.normalizedValue, "2");
  assert.equal(mismatchFile.rows[0]?.cells[7]?.finalValue, "1");
  assert.deepEqual(mismatchFile.rows[0]?.changes.find((change) => change.kind === "id-gender-correction"), {
    kind: "id-gender-correction",
    sourceRow: 1,
    fieldIndex: 8,
    before: "2",
    after: "1",
    reason: "依欄位5有效證號修正性別",
  });
  assert.equal(mismatchFile.summary.errorRows, 0);
  assert.equal(mismatchFile.summary.warningRows, 1);
  assert.equal(mismatchFile.rows[0]?.included, true);

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
  assert.equal(invalidFile.summary.warningRows, 1);
  assert.equal(invalidFile.summary.errorRows, 0);
  assert.equal(invalidFile.rows[0]?.included, true);
});

test("defaults every IR row to selected and honors explicit row deselection", async () => {
  const file = createInternalFile(
    "row-output-decisions",
    "row-output-decisions.csv",
    {
      rows: [
        validRow({ 10: "0212345678" }),
        validRow({ 5: "A123456789", 8: "2", 9: "" }),
      ],
    },
    "20260803",
  );

  assert.deepEqual(file.rows.map((row) => row.included), [true, true]);
  assert.equal(file.summary.includedRows, 2);
  assert.equal(
    issuesFor(file).find((issue) => issue.code === "ID_GENDER_MISMATCH")?.severity,
    "warning",
  );
  assert.equal(
    issuesFor(file).some((issue) => issue.code === "PATTERN_MISMATCH" && issue.fieldIndex === 9),
    true,
  );
  assert.equal((await outputAdapter.create([file], "big5-txt")).bytes.length, (FIXED_RECORD_WIDTH_BYTES + 2) * 2);

  file.rows[1].included = false;
  assert.equal((await outputAdapter.create([file], "big5-txt")).bytes.length, FIXED_RECORD_WIDTH_BYTES + 2);
});

test("flags literal question marks for review without deselecting the row", () => {
  const file = createInternalFile(
    "question-mark",
    "question-mark.csv",
    { rows: [validRow({ 7: "王?明" })] },
    "20260803",
  );

  const issue = issuesFor(file).find((candidate) => candidate.code === "QUESTION_MARK_PRESENT");
  assert.equal(issue?.severity, "warning");
  assert.equal(issue?.fieldIndex, 7);
  assert.equal(file.rows[0]?.cells[6]?.sourceValue, "王?明");
  assert.equal(file.rows[0]?.cells[6]?.normalizedValue, "王？明");
  assert.equal(file.rows[0]?.included, true);
  assert.equal(file.summary.warningRows, 1);
});
