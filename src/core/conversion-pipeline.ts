import type { DataIssue, InternalFile } from "./internal-model";
import { collectRowIssues, summarizeInternalFile } from "./internal-model";
import { normalizeRows } from "./normalization";
import { applyTransformations } from "./transformations";
import { taipeiDateStamp, validateRows } from "./validation";

export interface AdapterRows {
  rows: string[][];
  issues?: DataIssue[];
  decoderLabel?: string;
  sheetName?: string;
  sourceRowNumbers?: number[];
  sourceRowCount?: number;
  excludedBlankRows?: number;
}

export function createInternalFile(
  id: string,
  virtualPath: string,
  adapter: AdapterRows,
  today = taipeiDateStamp(),
): InternalFile {
  const normalized = normalizeRows(adapter.rows, {
    ...(adapter.sourceRowNumbers ? { sourceRowNumbers: adapter.sourceRowNumbers } : {}),
    ...(adapter.sourceRowCount === undefined ? {} : { sourceRowCount: adapter.sourceRowCount }),
    ...(adapter.excludedBlankRows === undefined ? {} : { excludedBlankRows: adapter.excludedBlankRows }),
  });
  const sourceValidation = validateRows(normalized.rows, "source", today);
  const transformedRows = applyTransformations(sourceValidation.rows);
  const finalValidation = validateRows(transformedRows, "final", today);
  const file: InternalFile = {
    id,
    virtualPath,
    rows: finalValidation.rows.map((row) => ({
      ...row,
      included: collectRowIssues(row).length === 0,
    })),
    issues: [...(adapter.issues ?? []), ...finalValidation.issues],
    summary: {
      sourceRows: normalized.sourceRows,
      includedRows: 0,
      excludedBlankRows: normalized.excludedBlankRows,
      errorCount: 0,
      warningCount: 0,
      modifiedCount: 0,
    },
    metadata: {
      ...(adapter.decoderLabel ? { decoderLabel: adapter.decoderLabel } : {}),
      ...(adapter.sheetName ? { sheetName: adapter.sheetName } : {}),
    },
  };
  file.summary = summarizeInternalFile(
    file,
    normalized.sourceRows,
    normalized.excludedBlankRows,
  );
  return file;
}

export function adapterError(message: string): DataIssue {
  return {
    severity: "error",
    stage: "adapter",
    code: "ADAPTER_ERROR",
    message,
  };
}
