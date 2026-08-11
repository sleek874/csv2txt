import type { OutputFormat } from "./file-formats";
import {
  encodeBig5EWithReplacement,
  UNKNOWN_CHARACTER,
  UNRECOGNIZED_CHARACTER,
  type UnencodableBig5ECharacter,
} from "./encoding";
import { FIXED_FIELDS } from "./fixed-profile";
import { cellValue, type InternalFile } from "./internal-model";

export type OutputIssueCode =
  | "OUTPUT_UNENCODABLE"
  | "OUTPUT_WIDTH_OVERFLOW";

export interface OutputIssue {
  blocking: boolean;
  code: OutputIssueCode;
  fieldIndex: number;
  fileId: string;
  message: string;
  sourceRow: number;
  replacementCharacterIndices?: readonly number[];
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
      const encoded = encodeBig5EWithReplacement(cellValue(cell));
      const issues: OutputIssue[] = [];
      if (encoded.substitutions.length > 0) {
        const unsupportedCharacters = [...new Map(encoded.substitutions.map((item) => (
          [item.codePoint, { character: item.character, codePoint: item.codePoint }]
        ))).values()];
        const characterDetails = unsupportedCharacters
          .map(({ codePoint }) => `「${UNRECOGNIZED_CHARACTER}」（${unicodeLabel(codePoint)}）`)
          .join("、");
        issues.push({
          blocking: false,
          code: "OUTPUT_UNENCODABLE",
          fieldIndex: cell.fieldIndex,
          fileId: file.id,
          message: `${characterDetails ? `字元${characterDetails}` : "這個字元"}沒有 BIG-5E 對照；TXT 將以${UNKNOWN_CHARACTER}代替。`,
          replacementCharacterIndices: encoded.substitutions.map((item) => item.characterIndex),
          sourceRow: row.sourceRow,
          unsupportedCharacters,
          virtualPath: file.virtualPath,
        });
      }
      if (encoded.bytes.length > field.widthBytes) {
        issues.push({
          blocking: true,
          code: "OUTPUT_WIDTH_OVERFLOW",
          fieldIndex: cell.fieldIndex,
          fileId: file.id,
          message: `替代後內容長度為 ${encoded.bytes.length} bytes，超過 ${field.widthBytes} bytes。`,
          sourceRow: row.sourceRow,
          virtualPath: file.virtualPath,
        });
      }
      return issues;
    });
  }));
}

export function describeOutputIssue(issue: OutputIssue): string {
  return `${issue.virtualPath}，儲存格 ${cellReference(issue.fieldIndex, issue.sourceRow)}：${issue.message}`;
}
