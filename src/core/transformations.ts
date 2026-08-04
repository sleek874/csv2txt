import type { InternalRow, TransformationChange } from "./internal-model";
import { recoverPrivateUse, type PrivateUseRecoveryLookup } from "./private-use-recovery";

const EMPTY_TELEPHONE_DEFAULT = "0000000000";

export function applyTransformations(
  rows: readonly InternalRow[],
  privateUseLookup?: PrivateUseRecoveryLookup,
): InternalRow[] {
  return rows.map((row) => {
    const cells = row.cells.map((cell) => ({ ...cell, issues: [...cell.issues] }));
    const changes: TransformationChange[] = [...row.changes];
    const telephone = cells[9];

    for (const cell of cells) {
      if (!cell.issues.some((currentIssue) => currentIssue.code === "PRIVATE_USE_CHARACTER")) {
        continue;
      }
      if (!privateUseLookup) continue;
      const recovered = recoverPrivateUse(cell.normalizedValue, privateUseLookup);
      if (recovered.recoveredCount === 0) {
        continue;
      }
      cell.finalValue = recovered.value;
      changes.push({
        kind: "private-use-recovery",
        sourceRow: row.sourceRow,
        fieldIndex: cell.fieldIndex,
        before: cell.normalizedValue,
        after: recovered.value,
        reason: "已還原舊系統字元",
      });
    }

    if (telephone && telephone.normalizedValue === "") {
      telephone.finalValue = EMPTY_TELEPHONE_DEFAULT;
      changes.push({
        kind: "telephone-default",
        sourceRow: row.sourceRow,
        fieldIndex: 10,
        before: "",
        after: EMPTY_TELEPHONE_DEFAULT,
        reason: "欄位10空值使用固定輸出值",
      });
    }

    return { ...row, cells, changes };
  });
}
