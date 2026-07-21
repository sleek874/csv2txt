import { encodeBig5 } from "./encoding";
import type {
  ConversionResult,
  ConverterSettings,
  FieldPreview,
  RowConversion,
  ValidationIssue,
} from "./types";

const UNSUPPORTED_CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });

  return output;
}

function issue(
  issues: ValidationIssue[],
  severity: ValidationIssue["severity"],
  code: ValidationIssue["code"],
  message: string,
  sourceRow?: number,
  fieldIndex?: number,
): void {
  issues.push({ severity, code, message, sourceRow, fieldIndex });
}

function inspectWhitespace(
  value: string,
  sourceRow: number,
  fieldIndex: number,
  issues: ValidationIssue[],
): void {
  if (value.length > 0 && /^\s/u.test(value)) {
    issue(issues, "warning", "LEADING_WHITESPACE", `第 ${sourceRow} 筆的欄位${fieldIndex}前方含有空白字元。`, sourceRow, fieldIndex);
  }
  if (value.length > 0 && /\s$/u.test(value)) {
    issue(issues, "warning", "TRAILING_WHITESPACE", `第 ${sourceRow} 筆的欄位${fieldIndex}後方含有空白字元。`, sourceRow, fieldIndex);
  }
  if ([...value].some((character) => /\s/u.test(character) && character !== " ")) {
    issue(issues, "warning", "NON_ASCII_WHITESPACE", `第 ${sourceRow} 筆的欄位${fieldIndex}含有非一般空格的空白字元。`, sourceRow, fieldIndex);
  }
  if (value.length > 0 && !/\S/u.test(value)) {
    issue(issues, "warning", "WHITESPACE_ONLY_FIELD", `第 ${sourceRow} 筆的欄位${fieldIndex}只有空白字元。`, sourceRow, fieldIndex);
  }
}

export function convertRows(
  rows: readonly (readonly string[])[],
  settings: Readonly<ConverterSettings>,
): ConversionResult {
  const issues: ValidationIssue[] = [];
  const convertedRows: RowConversion[] = [];
  const outputChunks: Uint8Array[] = [];
  const recordWidthBytes = settings.columns.reduce((total, column) => total + column.widthBytes, 0);

  if (rows.length !== settings.expectedRows) {
    issue(
      issues,
      "error",
      "INVALID_RECORD_COUNT",
      `資料筆數錯誤：預期 ${settings.expectedRows} 筆，實際 ${rows.length} 筆。`,
    );
  }

  rows.forEach((row, rowIndex) => {
    const sourceRow = rowIndex + 1;
    const rowIssueStart = issues.length;
    const fields: FieldPreview[] = [];
    const fieldChunks: Uint8Array[] = [];
    const isEmptyRecord = row.every((value) => value === "");
    const isWhitespaceOnlyRecord = !isEmptyRecord
      && row.length > 0
      && row.every((value) => !/\S/u.test(value));

    if (isEmptyRecord) {
      issue(issues, "error", "EMPTY_RECORD", `第 ${sourceRow} 筆是空白列。`, sourceRow);
    } else if (isWhitespaceOnlyRecord) {
      issue(issues, "error", "WHITESPACE_ONLY_RECORD", `第 ${sourceRow} 筆只有空白字元。`, sourceRow);
    }

    if (row.length !== settings.columns.length) {
      issue(
        issues,
        "error",
        "INVALID_COLUMN_COUNT",
        `第 ${sourceRow} 筆共有 ${row.length} 欄，應為 ${settings.columns.length} 欄。`,
        sourceRow,
      );
    } else if (!isEmptyRecord && !isWhitespaceOnlyRecord) {
      settings.columns.forEach((column, columnIndex) => {
        const fieldIndex = columnIndex + 1;
        const sourceValue = row[columnIndex] ?? "";
        const usedDefault = sourceValue === "" && column.defaultValue !== "";
        const resolvedValue = usedDefault ? column.defaultValue : sourceValue;
        let valueBytes = 0;
        let paddingBytes = 0;

        inspectWhitespace(resolvedValue, sourceRow, fieldIndex, issues);

        if (column.required && !/\S/u.test(resolvedValue)) {
          issue(issues, "error", "MISSING_REQUIRED", `第 ${sourceRow} 筆的欄位${fieldIndex}不可空白。`, sourceRow, fieldIndex);
        } else if (UNSUPPORTED_CONTROL.test(resolvedValue)) {
          issue(issues, "error", "UNSUPPORTED_CONTROL_CHARACTER", `第 ${sourceRow} 筆的欄位${fieldIndex}含有不支援的控制字元。`, sourceRow, fieldIndex);
        } else {
          const encoded = encodeBig5(resolvedValue);
          if (!encoded) {
            issue(issues, "error", "UNENCODABLE_BIG5", `第 ${sourceRow} 筆的欄位${fieldIndex}含有無法轉為 Big5 的字元。`, sourceRow, fieldIndex);
          } else {
            valueBytes = encoded.length;
            if (valueBytes > column.widthBytes) {
              issue(issues, "error", "WIDTH_OVERFLOW", `第 ${sourceRow} 筆的欄位${fieldIndex}需要 ${valueBytes} 位元組，超過欄寬 ${column.widthBytes}。`, sourceRow, fieldIndex);
            } else {
              paddingBytes = column.widthBytes - valueBytes;
              const padding = new Uint8Array(paddingBytes).fill(0x20);
              fieldChunks.push(...(settings.alignment === "left" ? [encoded, padding] : [padding, encoded]));
            }
          }
        }

        fields.push({
          fieldIndex,
          sourceValue,
          resolvedValue,
          usedDefault,
          valueBytes,
          paddingBytes,
        });
      });
    }

    const hasRowError = issues
      .slice(rowIssueStart)
      .some((currentIssue) => currentIssue.severity === "error");
    const valid = !hasRowError;

    if (valid) {
      outputChunks.push(concatenate(fieldChunks), new Uint8Array([0x0d, 0x0a]));
    }

    convertedRows.push({ sourceRow, valid, fields });
  });

  const validRows = convertedRows.filter((row) => row.valid).length;
  const hasError = issues.some((currentIssue) => currentIssue.severity === "error");

  return {
    outputBytes: hasError ? null : concatenate(outputChunks),
    issues,
    rows: convertedRows,
    validRows,
    invalidRows: convertedRows.length - validRows,
    warningCount: issues.filter((currentIssue) => currentIssue.severity === "warning").length,
    recordWidthBytes,
  };
}
