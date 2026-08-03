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
  description: string;
  hooks: readonly FieldValidationHook[];
}

export const FIXED_RECORD_WIDTH_BYTES = 208;

export const FIXED_FIELDS: readonly FixedFieldDefinition[] = [
  { index: 1, widthBytes: 1, pattern: /^[AB]$/u, description: "必填", hooks: [] },
  { index: 2, widthBytes: 2, pattern: /^[0-9]{2}$/u, description: "必填；保留前置零", hooks: [] },
  { index: 3, widthBytes: 1, pattern: /^[1-6]$/u, description: "必填", hooks: [] },
  { index: 4, widthBytes: 10, pattern: /^[0-9]{10}$/u, description: "必填；不自動補零", hooks: [] },
  { index: 5, widthBytes: 10, pattern: /^[a-z0-9]{5,10}$/iu, description: "轉大寫；證號無效時提醒，性別不符時錯誤", hooks: ["optional-id-warning", "field-5-gender-match"] },
  { index: 6, widthBytes: 8, pattern: /^[0-9]{8}$/u, description: "真實日期且早於今天", hooks: ["date-before-today"] },
  { index: 7, widthBytes: 12, pattern: /^.+$/u, description: "可安全轉為 Big5", hooks: [] },
  { index: 8, widthBytes: 1, pattern: /^[12]$/u, description: "有效證號時與欄位5比對性別", hooks: ["field-5-gender-match"] },
  { index: 9, widthBytes: 120, pattern: /^.+$/u, description: "必填；可安全轉為 Big5", hooks: [] },
  { index: 10, widthBytes: 15, pattern: /^[0-9()+#-]{1,15}$/u, description: "來源可空；空值明確補 0000000000", hooks: [] },
  { index: 11, widthBytes: 10, pattern: /^[A-Z][12][0-9]{8}$/u, description: "必須通過臺灣身分證檢查碼", hooks: ["required-id-checksum"] },
  { index: 12, widthBytes: 1, pattern: /^[ABCD]$/u, description: "必填", hooks: [] },
  { index: 13, widthBytes: 8, pattern: /^[0-9]{8}$/u, description: "真實日期且早於今天", hooks: ["date-before-today"] },
  { index: 14, widthBytes: 8, pattern: /^(?:[0-9]{8})?$/u, description: "有值時晚於欄位13且早於今天", hooks: ["optional-date-after-field-13", "field-14-15-pair"] },
  { index: 15, widthBytes: 1, pattern: /^[1-4]?$/u, description: "與欄位14同時有值或同時空白", hooks: ["field-14-15-pair"] },
];

export const FIXED_FIELD_COUNT = FIXED_FIELDS.length;
export const FIXED_WIDTHS = FIXED_FIELDS.map((field) => field.widthBytes);

const calculatedWidth = FIXED_WIDTHS.reduce((total, width) => total + width, 0);
if (calculatedWidth !== FIXED_RECORD_WIDTH_BYTES) {
  throw new Error(`固定欄位總寬度應為 ${FIXED_RECORD_WIDTH_BYTES}，實際為 ${calculatedWidth}。`);
}
