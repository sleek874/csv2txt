export type FieldValidationHook =
  | "date-before-today"
  | "optional-date-after-field-13"
  | "optional-id-warning"
  | "required-id-checksum"
  | "field-5-gender-match"
  | "field-14-15-pair";

export interface FixedFieldDefinition {
  index: number;
  widthBytes: number;
  pattern: RegExp;
  formatErrorMessage: string;
  description: string;
  hooks: readonly FieldValidationHook[];
}

export const FIXED_RECORD_WIDTH_BYTES = 208;

export const FIXED_FIELDS: readonly FixedFieldDefinition[] = [
  { index: 1, widthBytes: 1, pattern: /^[AB]$/u, formatErrorMessage: "只能填 A 或 B。", description: "必填", hooks: [] },
  { index: 2, widthBytes: 2, pattern: /^[0-9]{2}$/u, formatErrorMessage: "請輸入 2 位數字。", description: "必填", hooks: [] },
  { index: 3, widthBytes: 1, pattern: /^[1-6]$/u, formatErrorMessage: "只能填 1 至 6。", description: "必填", hooks: [] },
  { index: 4, widthBytes: 10, pattern: /^[0-9]{10}$/u, formatErrorMessage: "請輸入 10 位數字。", description: "必填", hooks: [] },
  { index: 5, widthBytes: 10, pattern: /^[A-Z0-9]{5,10}$/u, formatErrorMessage: "請輸入 5 至 10 個英文字母或數字。", description: "轉大寫；證號無效時警告；有效證號可修正欄位8", hooks: ["optional-id-warning", "field-5-gender-match"] },
  { index: 6, widthBytes: 8, pattern: /^[0-9]{8}$/u, formatErrorMessage: "請輸入 8 位西元日期，例如 20250831。", description: "真實日期且早於今天", hooks: ["date-before-today"] },
  { index: 7, widthBytes: 12, pattern: /^.+$/u, formatErrorMessage: "請輸入內容。", description: "必填；TXT 轉換後最多 12 bytes", hooks: [] },
  { index: 8, widthBytes: 1, pattern: /^[12]$/u, formatErrorMessage: "只能填 1 或 2。", description: "與有效證號不符時依欄位5修正並警告", hooks: ["field-5-gender-match"] },
  { index: 9, widthBytes: 120, pattern: /^.+$/u, formatErrorMessage: "請輸入內容。", description: "必填；TXT 轉換後最多 120 bytes", hooks: [] },
  { index: 10, widthBytes: 15, pattern: /^[0-9()+#-]{1,15}$/u, formatErrorMessage: "只能使用數字及 ( ) + # -，最多 15 個字元。", description: "來源可空；空值明確補 0000000000", hooks: [] },
  { index: 11, widthBytes: 10, pattern: /^[A-Z][12][0-9]{8}$/u, formatErrorMessage: "請輸入 1 個大寫英文字母與 9 位數字，第二碼須為 1 或 2。", description: "轉大寫；必須通過臺灣身分證檢查碼", hooks: ["required-id-checksum"] },
  { index: 12, widthBytes: 1, pattern: /^[ABCD]$/u, formatErrorMessage: "只能填 A、B、C 或 D。", description: "必填", hooks: [] },
  { index: 13, widthBytes: 8, pattern: /^[0-9]{8}$/u, formatErrorMessage: "請輸入 8 位西元日期，例如 20250831。", description: "真實日期且早於今天", hooks: ["date-before-today"] },
  { index: 14, widthBytes: 8, pattern: /^(?:[0-9]{8})?$/u, formatErrorMessage: "請輸入 8 位西元日期，例如 20250831，或留空。", description: "有值時晚於欄位13且早於今天", hooks: ["optional-date-after-field-13", "field-14-15-pair"] },
  { index: 15, widthBytes: 1, pattern: /^[1-4]?$/u, formatErrorMessage: "只能填 1 至 4，或留空。", description: "與欄位14同時有值或同時空白", hooks: ["field-14-15-pair"] },
];

export const FIXED_FIELD_COUNT = FIXED_FIELDS.length;
export const FIXED_WIDTHS = FIXED_FIELDS.map((field) => field.widthBytes);

const calculatedWidth = FIXED_WIDTHS.reduce((total, width) => total + width, 0);
if (calculatedWidth !== FIXED_RECORD_WIDTH_BYTES) {
  throw new Error(`固定欄位總寬度應為 ${FIXED_RECORD_WIDTH_BYTES}，實際為 ${calculatedWidth}。`);
}
