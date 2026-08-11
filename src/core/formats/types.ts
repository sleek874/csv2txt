export interface ParseIssue {
  code?: string;
  fieldIndex?: number;
  message: string;
  replacementCharacterIndices?: readonly number[];
  severity: "error" | "warning";
  sourceRow?: number;
  technicalDetail?: string;
}

export interface RejectedRecord {
  fieldIndex?: number;
  message: string;
  original: string;
  sourceRow: number;
  technicalDetail?: string;
}

export interface ParsedRows {
  blankSourceRows?: number[];
  rows: string[][];
  issues: ParseIssue[];
  rejectedRecords?: RejectedRecord[];
}

export interface SerializableRow {
  sourceRow: number;
  values: readonly string[];
}
