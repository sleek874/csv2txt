export const SOURCE_ENCODINGS = ["auto", "utf-8", "utf-16", "big5"] as const;
export const ALIGNMENTS = ["left", "right"] as const;

export type SourceEncodingPreference = (typeof SOURCE_ENCODINGS)[number];
export type Alignment = (typeof ALIGNMENTS)[number];
export type DetectedEncoding = "utf-8" | "utf-16le" | "utf-16be" | "big5";

export interface ColumnSetting {
  required: boolean;
  defaultValue: string;
  widthBytes: number;
}

export interface ConverterSettings {
  version: 2;
  sourceEncoding: SourceEncodingPreference;
  alignment: Alignment;
  expectedRows: number;
  columns: ColumnSetting[];
}

export type ValidationSeverity = "error" | "warning";

export type ValidationCode =
  | "MISSING_REQUIRED"
  | "INVALID_COLUMN_COUNT"
  | "INVALID_RECORD_COUNT"
  | "EMPTY_RECORD"
  | "WHITESPACE_ONLY_RECORD"
  | "WHITESPACE_ONLY_FIELD"
  | "LEADING_WHITESPACE"
  | "TRAILING_WHITESPACE"
  | "NON_ASCII_WHITESPACE"
  | "UNSUPPORTED_CONTROL_CHARACTER"
  | "UNENCODABLE_BIG5"
  | "WIDTH_OVERFLOW"
  | "MALFORMED_CSV";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: ValidationCode;
  sourceRow?: number;
  fieldIndex?: number;
  message: string;
}

export interface FieldPreview {
  fieldIndex: number;
  sourceValue: string;
  resolvedValue: string;
  usedDefault: boolean;
  valueBytes: number;
  paddingBytes: number;
}

export interface RowConversion {
  sourceRow: number;
  valid: boolean;
  fields: FieldPreview[];
}

export interface ConversionResult {
  outputBytes: Uint8Array | null;
  issues: ValidationIssue[];
  rows: RowConversion[];
  validRows: number;
  invalidRows: number;
  warningCount: number;
  recordWidthBytes: number;
}
