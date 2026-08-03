export interface ParsedRows {
  rows: string[][];
  errors: string[];
}

export interface SerializableRow {
  sourceRow: number;
  values: readonly string[];
}
