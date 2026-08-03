import type { InternalRow, TransformationChange } from "./internal-model";

const EMPTY_TELEPHONE_DEFAULT = "0000000000";

export function applyTransformations(rows: readonly InternalRow[]): InternalRow[] {
  return rows.map((row) => {
    const cells = row.cells.map((cell) => ({ ...cell, issues: [...cell.issues] }));
    const changes: TransformationChange[] = [...row.changes];
    const telephone = cells[9];

    if (telephone && telephone.normalizedValue === "") {
      telephone.finalValue = EMPTY_TELEPHONE_DEFAULT;
      changes.push({
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
