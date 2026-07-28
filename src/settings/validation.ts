import type {
  Alignment,
  ConverterSettings,
} from "../core/types";

const SUPPORTED_ALIGNMENTS: Record<Alignment, true> = {
  left: true,
  right: true,
};
const SETTINGS_KEYS = new Set([
  "version",
  "removeWhitespace",
  "alignment",
  "expectedRows",
  "columns",
]);
const COLUMN_KEYS = new Set(["required", "defaultValue", "widthBytes"]);

export type SettingsValidationResult =
  | { valid: true; settings: ConverterSettings }
  | { valid: false; reason: string };

export function validateConverterSettings(value: unknown): SettingsValidationResult {
  if (typeof value !== "object" || value === null) {
    return { valid: false, reason: "內容必須是 JSON 物件。" };
  }

  const candidate = value as Partial<ConverterSettings>;
  if (candidate.version !== 3) {
    return { valid: false, reason: "版本不受支援；目前只支援版本 3。" };
  }
  const unsupportedSetting = Object.keys(candidate).find((key) => !SETTINGS_KEYS.has(key));
  if (unsupportedSetting) {
    return { valid: false, reason: `包含不支援的設定：${unsupportedSetting}。` };
  }
  if (typeof candidate.removeWhitespace !== "boolean") {
    return { valid: false, reason: "移除空白字元設定必須是布林值。" };
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
    return { valid: false, reason: "欄位設定必須是非空陣列。" };
  }

  for (const [index, column] of candidate.columns.entries()) {
    const fieldLabel = `欄位${index + 1}`;
    if (typeof column !== "object" || column === null) {
      return { valid: false, reason: `${fieldLabel}的設定格式不正確。` };
    }
    const unsupportedColumnSetting = Object.keys(column)
      .find((key) => !COLUMN_KEYS.has(key));
    if (unsupportedColumnSetting) {
      return {
        valid: false,
        reason: `${fieldLabel}包含不支援的設定：${unsupportedColumnSetting}。`,
      };
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
