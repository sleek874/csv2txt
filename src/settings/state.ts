import type { ConverterSettings } from "../core/types";

export type SettingsKind = "default" | "custom" | "invalid";
export type SettingsPersistenceState = "synced" | "pending" | "unavailable";

export function settingsEqual(
  left: Readonly<ConverterSettings>,
  right: Readonly<ConverterSettings>,
): boolean {
  return left.version === right.version
    && left.removeWhitespace === right.removeWhitespace
    && left.alignment === right.alignment
    && left.expectedRows === right.expectedRows
    && left.columns.length === right.columns.length
    && left.columns.every((column, index) => {
      const otherColumn = right.columns[index];
      return otherColumn !== undefined
        && column.required === otherColumn.required
        && column.defaultValue === otherColumn.defaultValue
        && column.widthBytes === otherColumn.widthBytes;
    });
}

export function determineSettingsKind(
  settings: Readonly<ConverterSettings> | null,
  defaults: Readonly<ConverterSettings>,
): SettingsKind {
  if (settings === null) {
    return "invalid";
  }
  return settingsEqual(settings, defaults) ? "default" : "custom";
}
