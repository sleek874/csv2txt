import { type AdapterRows, adapterError } from "../../core/conversion-pipeline";
import { FIXED_WIDTHS } from "../../core/fixed-profile";
import type { SourceFileType } from "../../core/file-formats";
import type { CodecManager } from "../resources/codec-manager";

export interface InputAdapter {
  parse(type: SourceFileType, bytes: Uint8Array): Promise<AdapterRows>;
}

function parseErrors(errors: readonly string[]) {
  return errors.map(adapterError);
}

export function createInputAdapter(codecs: CodecManager): InputAdapter {
  return {
    async parse(type, bytes) {
      if (type === "csv") {
        const parsed = (await codecs.csv()).parseCsv(bytes);
        return {
          rows: parsed.rows,
          issues: parseErrors(parsed.errors),
          decoderLabel: parsed.decoderLabel,
        };
      }

      if (type === "txt") {
        const parsed = (await codecs.big5Txt()).parseBig5Txt(bytes);
        return {
          rows: parsed.rows,
          issues: parseErrors(parsed.errors),
          decoderLabel: "Big5 固定 208 bytes",
          sourceRowNumbers: parsed.sourceRowNumbers,
          sourceRowCount: parsed.sourceRowCount,
          excludedBlankRows: parsed.excludedBlankRows,
        };
      }

      const parsed = (await codecs.spreadsheet()).parseSpreadsheet(bytes, FIXED_WIDTHS.length);
      return {
        rows: parsed.rows,
        issues: parseErrors(parsed.errors),
        sheetName: parsed.sheetName,
      };
    },
  };
}
