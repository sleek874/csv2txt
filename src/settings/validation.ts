import type {
  Alignment,
  ConverterSettings,
  SourceEncodingPreference,
} from "../core/types";

const SUPPORTED_SOURCE_ENCODINGS: Record<SourceEncodingPreference, true> = {
  auto: true,
  "utf-8": true,
  "utf-16": true,
  big5: true,
};
const SUPPORTED_ALIGNMENTS: Record<Alignment, true> = {
  left: true,
  right: true,
};

export type SettingsValidationResult =
  | { valid: true; settings: ConverterSettings }
  | { valid: false; reason: string };

export function validateConverterSettings(value: unknown): SettingsValidationResult {
  if (typeof value !== "object" || value === null) {
    return { valid: false, reason: "內容必須是 JSON 物件。" };
  }

  const candidate = value as Partial<ConverterSettings>;
  if (candidate.version !== 2) {
    return { valid: false, reason: "版本不受支援；目前只支援版本 2。" };
  }
  if (
    typeof candidate.sourceEncoding !== "string"
    || !Object.hasOwn(SUPPORTED_SOURCE_ENCODINGS, candidate.sourceEncoding)
  ) {
    return { valid: false, reason: "來源編碼設定不受支援。" };
  }
  if (
    typeof candidate.alignment !== "string"
    || !Object.hasOwn(SUPPORTED_ALIGNMENTS, candidate.alignment)
  ) {
    return { valid: false, reason: "對齊設定不受支援。" };
  }
  if (!Number.isInteger(candidate.expectedRows) || (candidate.expectedRows ?? 0) <= 0) {
    return { valid: false, reason: "預期筆數必須是大於 0 的整數。" };
  }
  if (!Array.isArray(candidate.columns) || candidate.columns.length === 0) {
    return { valid: false, reason: "欄位設定必須是非空白陣列。" };
  }

  for (const [index, column] of candidate.columns.entries()) {
    const fieldLabel = `欄位${index + 1}`;
    if (typeof column !== "object" || column === null) {
      return { valid: false, reason: `${fieldLabel}的設定格式不正確。` };
    }
    if (typeof column.required !== "boolean") {
      return { valid: false, reason: `${fieldLabel}的「不可空白」必須是布林值。` };
    }
    if (typeof column.defaultValue !== "string") {
      return { valid: false, reason: `${fieldLabel}的空值預設必須是文字。` };
    }
    if (!Number.isInteger(column.widthBytes) || column.widthBytes <= 0) {
      return { valid: false, reason: `${fieldLabel}的輸出寬度必須是大於 0 的整數。` };
    }
    if (column.required && column.defaultValue !== "") {
      return { valid: false, reason: `${fieldLabel}設為不可空白時，空值預設必須留空。` };
    }
  }

  return { valid: true, settings: candidate as ConverterSettings };
}
