import type { DataIssue, InternalFile } from "./internal-model";
import { summarizeInternalFile } from "./internal-model";
import { privateUseCodePoints } from "./encoding";
import { normalizeRows } from "./normalization";
import type { PrivateUseRecoveryLookup } from "./private-use-recovery";
import { applyTransformations } from "./transformations";
import { taipeiDateStamp, validateRows } from "./validation";

export interface AdapterRows {
  rows: string[][];
  issues?: DataIssue[];
  decoderLabel?: string;
  sheetName?: string;
  sourceRowNumbers?: number[];
  sourceRowCount?: number;
}

export function createInternalFile(
  id: string,
  virtualPath: string,
  adapter: AdapterRows,
  today = taipeiDateStamp(),
  privateUseLookup?: PrivateUseRecoveryLookup,
): InternalFile {
  const normalized = normalizeRows(adapter.rows, {
    ...(adapter.sourceRowNumbers ? { sourceRowNumbers: adapter.sourceRowNumbers } : {}),
    ...(adapter.sourceRowCount === undefined ? {} : { sourceRowCount: adapter.sourceRowCount }),
  });
  const sourceValidation = validateRows(normalized.rows, "source", today);
  const transformedRows = applyTransformations(sourceValidation.rows, privateUseLookup);
  const finalValidation = validateRows(transformedRows, "final", today);
  const fileIssues = [...(adapter.issues ?? []), ...normalized.issues, ...finalValidation.issues];
  const file: InternalFile = {
    id,
    virtualPath,
    rows: finalValidation.rows.map((row) => ({
      ...row,
      included: true,
    })),
    issues: fileIssues,
    summary: {
      sourceRows: normalized.sourceRows,
      includedRows: 0,
      outputRows: 0,
      errorCount: 0,
      warningCount: 0,
    },
    metadata: {
      ...(adapter.decoderLabel ? { decoderLabel: adapter.decoderLabel } : {}),
      ...(adapter.sheetName ? { sheetName: adapter.sheetName } : {}),
    },
  };
  file.summary = summarizeInternalFile(
    file,
    normalized.sourceRows,
  );
  return file;
}

export async function createInternalFileWithRecovery(
  id: string,
  virtualPath: string,
  adapter: AdapterRows,
  today = taipeiDateStamp(),
): Promise<InternalFile> {
  const needsRecovery = adapter.rows.some(
    (row) => row.some((value) => privateUseCodePoints(value).length > 0),
  );
  const privateUseLookup = needsRecovery
    ? (await import("./private-use-recovery-mapping")).recoveredUnicodeCodePoint
    : undefined;
  return createInternalFile(id, virtualPath, adapter, today, privateUseLookup);
}

export function adapterIssue(issue: {
  message: string;
  severity: DataIssue["severity"];
  sourceRow?: number;
}): DataIssue {
  return {
    severity: issue.severity,
    stage: "adapter",
    code: issue.severity === "error" ? "ADAPTER_ERROR" : "ADAPTER_WARNING",
    message: issue.message,
    ...(issue.sourceRow === undefined ? {} : { sourceRow: issue.sourceRow }),
  };
}
