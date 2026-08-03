import { encodeBig5 } from "./encoding";
import { FIXED_FIELDS } from "./fixed-profile";
import {
  cellValue,
  type DataIssue,
  type InternalCell,
  type InternalRow,
  type IssueStage,
} from "./internal-model";

const TAIWAN_ID_LETTER_CODES: Readonly<Record<string, number>> = {
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17,
  I: 34, J: 18, K: 19, L: 20, M: 21, N: 22, O: 35, P: 23,
  Q: 24, R: 25, S: 26, T: 27, U: 28, V: 29, W: 32, X: 30,
  Y: 31, Z: 33,
};

function issue(
  stage: IssueStage,
  severity: DataIssue["severity"],
  code: string,
  message: string,
  sourceRow: number,
  fieldIndex?: number,
  relatedFieldIndices?: readonly number[],
): DataIssue {
  return {
    severity,
    stage,
    code,
    message,
    sourceRow,
    ...(fieldIndex === undefined ? {} : { fieldIndex }),
    ...(relatedFieldIndices === undefined ? {} : { relatedFieldIndices }),
  };
}

function hasValidTaiwanIdChecksum(value: string): boolean {
  const letterCode = TAIWAN_ID_LETTER_CODES[value[0] ?? ""];
  if (letterCode === undefined) {
    return false;
  }

  const digits = [...value.slice(1)].map(Number);
  const sum = Math.floor(letterCode / 10)
    + (letterCode % 10) * 9
    + digits.slice(0, 8).reduce(
      (total, digit, index) => total + digit * (8 - index),
      0,
    )
    + (digits[8] ?? 0);
  return sum % 10 === 0;
}

export function isValidTaiwanNationalId(value: string): boolean {
  return /^[A-Z][12][0-9]{8}$/u.test(value)
    && hasValidTaiwanIdChecksum(value);
}

export function isValidNewResidentId(value: string): boolean {
  return /^[A-Z][89][0-9]{8}$/u.test(value)
    && hasValidTaiwanIdChecksum(value);
}

function isValidField5Id(value: string): boolean {
  return isValidTaiwanNationalId(value) || isValidNewResidentId(value);
}

function field8SexCode(value: string): "1" | "2" | null {
  if (!isValidField5Id(value)) {
    return null;
  }
  return value[1] === "1" || value[1] === "8" ? "1" : "2";
}

function parseCalendarDate(value: string): Date | null {
  if (!/^[0-9]{8}$/u.test(value)) {
    return null;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? date
    : null;
}

export function taipeiDateStamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year ?? "0000"}${values.month ?? "00"}${values.day ?? "00"}`;
}

function validateCalendarField(
  value: string,
  sourceRow: number,
  fieldIndex: number,
  stage: IssueStage,
  today: string,
): DataIssue[] {
  if (value === "" && fieldIndex === 14) {
    return [];
  }
  const parsed = parseCalendarDate(value);
  if (!parsed) {
    return [issue(stage, "error", "INVALID_DATE", "請輸入真實的西元日期。", sourceRow, fieldIndex)];
  }
  if (value >= today) {
    return [issue(stage, "error", "DATE_NOT_BEFORE_TODAY", "日期必須早於今天。", sourceRow, fieldIndex)];
  }
  return [];
}

function validateCell(
  cell: InternalCell,
  row: InternalRow,
  stage: IssueStage,
  today: string,
): DataIssue[] {
  const field = FIXED_FIELDS[cell.fieldIndex - 1];
  if (!field) {
    return [];
  }
  const value = stage === "source" ? cell.normalizedValue : cellValue(cell);
  const issues: DataIssue[] = [];
  const formatMatches = field.pattern.test(value);

  if (!formatMatches) {
    issues.push(issue(
      stage,
      "error",
      "PATTERN_MISMATCH",
      value === "" ? "此欄位不能空白。" : field.formatErrorMessage,
      row.sourceRow,
      field.index,
    ));
  }

  if (value === "") {
    return issues;
  }

  const encoded = encodeBig5(value);
  if (!encoded) {
    issues.push(issue(stage, "error", "UNENCODABLE_BIG5", "含有 Big5 無法使用的字元。", row.sourceRow, field.index));
  } else if (encoded.length > field.widthBytes) {
    issues.push(issue(
      stage,
      "error",
      "WIDTH_OVERFLOW",
      `內容太長：目前 ${encoded.length} bytes，此欄最多 ${field.widthBytes} bytes。`,
      row.sourceRow,
      field.index,
    ));
  }

  if (field.index === 5 && formatMatches && !isValidField5Id(value)) {
    issues.push(issue(stage, "warning", "OPTIONAL_ID_INVALID", "這個值不是有效的國民身分證或新式外來人口統一證號，請確認是否正確。", row.sourceRow, field.index));
  }
  if (field.index === 11 && formatMatches && !isValidTaiwanNationalId(value)) {
    issues.push(issue(stage, "error", "REQUIRED_ID_INVALID", "身分證字號的檢查碼不正確，請再次確認。", row.sourceRow, field.index));
  }
  if (formatMatches && (field.index === 6 || field.index === 13 || field.index === 14)) {
    issues.push(...validateCalendarField(value, row.sourceRow, field.index, stage, today));
  }

  return issues;
}

function valueAt(row: InternalRow, fieldIndex: number, stage: IssueStage): string {
  const cell = row.cells[fieldIndex - 1];
  if (!cell) {
    return "";
  }
  return stage === "source" ? cell.normalizedValue : cellValue(cell);
}

function validateCrossField(
  row: InternalRow,
  stage: IssueStage,
): DataIssue[] {
  const issues: DataIssue[] = [];
  const field5 = valueAt(row, 5, stage);
  const field8 = valueAt(row, 8, stage);
  const field13 = valueAt(row, 13, stage);
  const field14 = valueAt(row, 14, stage);
  const field15 = valueAt(row, 15, stage);
  const expectedSexCode = field8SexCode(field5);

  if (expectedSexCode && expectedSexCode !== field8) {
    issues.push(issue(
      stage,
      "error",
      "ID_GENDER_MISMATCH",
      "欄位5的證號性別與欄位8不一致，請確認兩個欄位。",
      row.sourceRow,
      undefined,
      [5, 8],
    ));
  }

  if ((field14 === "") !== (field15 === "")) {
    issues.push(issue(
      stage,
      "error",
      "OPTIONAL_FIELDS_MISMATCH",
      "欄位14與欄位15需一起填寫，或一起留空。",
      row.sourceRow,
      undefined,
      [14, 15],
    ));
  }

  if (
    field13 !== ""
    && field14 !== ""
    && parseCalendarDate(field13)
    && parseCalendarDate(field14)
    && field14 <= field13
  ) {
    issues.push(issue(
      stage,
      "error",
      "DATE_ORDER_INVALID",
      "欄位14的日期需晚於欄位13。",
      row.sourceRow,
      undefined,
      [13, 14],
    ));
  }

  return issues;
}

export function validateRows(
  rows: readonly InternalRow[],
  stage: "source" | "final",
  today: string,
): { rows: InternalRow[]; issues: DataIssue[] } {
  const fileIssues: DataIssue[] = [];
  const validatedRows = rows.map((row) => {
    const cells = row.cells.map((cell) => ({
      ...cell,
      issues: validateCell(cell, row, stage, today),
    }));
    const rowWithCells = { ...row, cells };
    const retainedStructureIssues = row.issues.filter(
      (currentIssue) => currentIssue.code === "INVALID_COLUMN_COUNT",
    );
    return {
      ...rowWithCells,
      issues: [
        ...retainedStructureIssues,
        ...validateCrossField(rowWithCells, stage),
      ],
    };
  });

  return { rows: validatedRows, issues: fileIssues };
}
