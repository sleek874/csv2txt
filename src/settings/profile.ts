import type { ConverterSettings } from "../core/types";

export const PRESET_WIDTHS = [
  1, 2, 1, 10, 10, 8, 12, 1, 120, 15, 10, 1, 8, 8, 1,
] as const;
export const DEFAULT_COLUMN_COUNT = PRESET_WIDTHS.length;
export const PRESET_EXPECTED_ROWS = 200;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function createDefaultSettings(): ConverterSettings {
  return {
    version: 2,
    sourceEncoding: "auto",
    alignment: "left",
    expectedRows: PRESET_EXPECTED_ROWS,
    columns: PRESET_WIDTHS.map((widthBytes) => ({
      required: false,
      defaultValue: "",
      widthBytes,
    })),
  };
}
