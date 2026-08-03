import { parseCsv } from "../core/csv";
import { type AdapterRows, adapterError } from "../core/conversion-pipeline";
import { decodeSource } from "../core/encoding";
import { FIXED_WIDTHS } from "../core/fixed-profile";
import { parseFixedWidthBig5 } from "../core/fixed-width-inverse";
import type { SourceFileType } from "../core/source";
import type { SpreadsheetParser } from "./spreadsheet-loader";

export interface SourceAdapter {
  parse(type: SourceFileType, bytes: Uint8Array): Promise<AdapterRows>;
}

function parseErrors(errors: readonly string[]) {
  return errors.map(adapterError);
}

export function createSourceAdapter(
  spreadsheet: SpreadsheetParser,
): SourceAdapter {
  return {
    async parse(type, bytes) {
      if (type === "csv") {
        const decoded = decodeSource(bytes);
        const parsed = parseCsv(decoded.text);
        return {
          rows: parsed.rows,
          issues: parseErrors(parsed.errors),
          decoderLabel: decoded.label,
        };
      }

      if (type === "txt") {
        const parsed = parseFixedWidthBig5(bytes, FIXED_WIDTHS);
        return {
          rows: parsed.rows,
          issues: parseErrors(parsed.errors),
          decoderLabel: "Big5 固定 208 bytes",
          sourceRowNumbers: parsed.sourceRowNumbers,
          sourceRowCount: parsed.sourceRowCount,
          excludedBlankRows: parsed.excludedBlankRows,
        };
      }

      const parsed = await spreadsheet.parse(bytes, FIXED_WIDTHS.length);
      return {
        rows: parsed.rows,
        issues: parseErrors(parsed.errors),
        sheetName: parsed.sheetName,
      };
    },
  };
}
