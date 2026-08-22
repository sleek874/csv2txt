import type { DataIssue, InternalFile } from "./internal-model";
import { summarizeInternalFile } from "./internal-model";
import { containsPrivateUseCodePoint } from "./encoding";
import { normalizedCharacterIndex, normalizeRows } from "./normalization";
import type { PrivateUseRecoveryLookup } from "./private-use-recovery";
import { applyTransformations } from "./transformations";
import { taipeiDateStamp, validateRows } from "./validation";

export interface AdapterRows {
  blankSourceRows?: number[];
  rows: string[][];
  issues?: DataIssue[];
  decoderLabel?: string;
  sheetName?: string;
  sourceRowNumbers?: number[];
  sourceRowCount?: number;
  rejectedRecords?: InternalFile["rejectedRecords"];
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
  const sourceRowIndices = new Map(
    adapter.rows.map((_, index) => [adapter.sourceRowNumbers?.[index] ?? index + 1, index]),
  );
  const adapterIssues = (adapter.issues ?? []).map((issue) => {
    if (
      issue.sourceRow === undefined
      || issue.fieldIndex === undefined
      || issue.replacementCharacterIndices === undefined
    ) return issue;
    const rowIndex = sourceRowIndices.get(issue.sourceRow);
    const value = rowIndex === undefined ? undefined : adapter.rows[rowIndex]?.[issue.fieldIndex - 1];
    return value === undefined
      ? issue
      : {
          ...issue,
          replacementCharacterIndices: issue.replacementCharacterIndices.map((characterIndex) => (
            normalizedCharacterIndex(value, characterIndex, issue.fieldIndex ?? 0)
          )),
        };
  });
  const replacementCells = new Set(adapterIssues.flatMap((issue) => (
    issue.sourceRow === undefined
    || issue.fieldIndex === undefined
    || issue.replacementCharacterIndices === undefined
      ? []
      : [`${issue.sourceRow}:${issue.fieldIndex}`]
  )));
  const finalIssues = finalValidation.issues.filter((issue) => !(
    issue.code === "QUESTION_MARK_PRESENT"
    && issue.sourceRow !== undefined
    && issue.fieldIndex !== undefined
    && replacementCells.has(`${issue.sourceRow}:${issue.fieldIndex}`)
  ));
  const fileIssues = [...adapterIssues, ...normalized.issues, ...finalIssues];
  const blankSourceRows = [...new Set([
    ...(adapter.blankSourceRows ?? []),
    ...normalized.blankSourceRows,
  ])].sort((left, right) => left - right);
  const file: InternalFile = {
    blankSourceRows,
    id,
    virtualPath,
    rows: finalValidation.rows.map((row) => ({
      ...row,
      included: true,
    })),
    issues: fileIssues,
    summary: {
      blankRows: 0,
      correctRows: 0,
      dataRows: 0,
      errorRows: 0,
      includedRows: 0,
      rejectedRows: 0,
      sourceRecords: normalized.sourceRows,
      warningRows: 0,
    },
    metadata: {
      ...(adapter.decoderLabel ? { decoderLabel: adapter.decoderLabel } : {}),
      ...(adapter.sheetName ? { sheetName: adapter.sheetName } : {}),
    },
    rejectedRecords: [
      ...(adapter.rejectedRecords ?? []),
      ...normalized.rejectedRecords,
    ],
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
    (row) => row.some(containsPrivateUseCodePoint),
  );
  const privateUseLookup = needsRecovery
    ? (await import("./private-use-recovery-mapping")).recoveredUnicodeCodePoint
    : undefined;
  return createInternalFile(id, virtualPath, adapter, today, privateUseLookup);
}

export function adapterIssue(issue: {
  code?: string;
  fieldIndex?: number;
  message: string;
  replacementCharacterIndices?: readonly number[];
  severity: DataIssue["severity"];
  sourceRow?: number;
  technicalDetail?: string;
}): DataIssue {
  return {
    severity: issue.severity,
    stage: "adapter",
    code: issue.code ?? (issue.severity === "error" ? "ADAPTER_ERROR" : "ADAPTER_WARNING"),
    message: issue.message,
    ...(issue.replacementCharacterIndices === undefined
      ? {}
      : { replacementCharacterIndices: issue.replacementCharacterIndices }),
    ...(issue.fieldIndex === undefined ? {} : { fieldIndex: issue.fieldIndex }),
    ...(issue.sourceRow === undefined ? {} : { sourceRow: issue.sourceRow }),
    ...(issue.technicalDetail === undefined ? {} : { technicalDetail: issue.technicalDetail }),
  };
}
