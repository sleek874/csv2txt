import type { OutputFormat } from "./file-formats";
import {
  encodeBig5E,
  UNRECOGNIZED_CHARACTER,
  unencodableBig5ECharacters,
  type UnencodableBig5ECharacter,
} from "./encoding";
import { FIXED_FIELDS } from "./fixed-profile";
import { cellValue, type InternalFile } from "./internal-model";

export type OutputIssueCode = "OUTPUT_UNENCODABLE" | "OUTPUT_WIDTH_OVERFLOW";

export interface OutputIssue {
  code: OutputIssueCode;
  fieldIndex: number;
  fileId: string;
  message: string;
  sourceRow: number;
  unsupportedCharacters?: readonly UnencodableBig5ECharacter[];
  virtualPath: string;
}

function unicodeLabel(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

function cellReference(fieldIndex: number, sourceRow: number): string {
  return `${String.fromCharCode(64 + fieldIndex)}${sourceRow}`;
}

export function validateOutput(
  files: readonly InternalFile[],
  format: OutputFormat,
): OutputIssue[] {
  if (format !== "big5-txt") return [];

  return files.flatMap((file) => file.rows.flatMap((row): OutputIssue[] => {
    if (!row.included) return [];
    return row.cells.flatMap((cell): OutputIssue[] => {
      const field = FIXED_FIELDS[cell.fieldIndex - 1];
      if (!field) return [];
      const encoded = encodeBig5E(cellValue(cell));
      if (!encoded) {
        const unsupportedCharacters = unencodableBig5ECharacters(cellValue(cell));
        const characterDetails = unsupportedCharacters
          .map(({ codePoint }) => `「${UNRECOGNIZED_CHARACTER}」（${unicodeLabel(codePoint)}）`)
          .join("、");
        return [{
          code: "OUTPUT_UNENCODABLE",
          fieldIndex: cell.fieldIndex,
          fileId: file.id,
          message: `${characterDetails ? `字元${characterDetails}` : "這個字元"}沒有 BIG-5E 對照。`,
          sourceRow: row.sourceRow,
          unsupportedCharacters,
          virtualPath: file.virtualPath,
        }];
      }
      if (encoded.length > field.widthBytes) {
        return [{
          code: "OUTPUT_WIDTH_OVERFLOW",
          fieldIndex: cell.fieldIndex,
          fileId: file.id,
          message: `內容長度為 ${encoded.length} bytes，超過 ${field.widthBytes} bytes。`,
          sourceRow: row.sourceRow,
          virtualPath: file.virtualPath,
        }];
      }
      return [];
    });
  }));
}

export function describeOutputIssue(issue: OutputIssue): string {
  return `${issue.virtualPath}，儲存格 ${cellReference(issue.fieldIndex, issue.sourceRow)}：${issue.message}`;
}
