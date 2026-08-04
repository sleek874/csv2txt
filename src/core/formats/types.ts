export interface ParseIssue {
  message: string;
  severity: "error" | "warning";
  sourceRow?: number;
}

export interface ParsedRows {
  rows: string[][];
  issues: ParseIssue[];
}

export interface SerializableRow {
  sourceRow: number;
  values: readonly string[];
}
