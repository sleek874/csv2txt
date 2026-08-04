import { type AdapterRows, adapterIssue } from "../../core/conversion-pipeline";
import { FIXED_WIDTHS } from "../../core/fixed-profile";
import type { SourceFileType } from "../../core/file-formats";
import type { CodecManager } from "../resources/codec-manager";

export interface InputAdapter {
  parse(type: SourceFileType, bytes: Uint8Array): Promise<AdapterRows>;
}

function parseIssues(issues: readonly { message: string; severity: "error" | "warning"; sourceRow?: number }[]) {
  return issues.map(adapterIssue);
}

export function createInputAdapter(codecs: CodecManager): InputAdapter {
  return {
    async parse(type, bytes) {
      if (type === "csv") {
        const parsed = (await codecs.csv()).parseCsv(bytes);
        return {
          rows: parsed.rows,
          issues: parseIssues(parsed.issues),
          decoderLabel: parsed.decoderLabel,
        };
      }

      if (type === "txt") {
        const parsed = (await codecs.big5Txt()).parseBig5Txt(bytes);
        return {
          rows: parsed.rows,
          issues: parseIssues(parsed.issues),
          decoderLabel: "臺灣政府 BIG-5E 固定 208 bytes",
          sourceRowNumbers: parsed.sourceRowNumbers,
          sourceRowCount: parsed.sourceRowCount,
        };
      }

      const parsed = (await codecs.spreadsheet()).parseSpreadsheet(bytes, FIXED_WIDTHS.length);
      return {
        rows: parsed.rows,
        issues: parseIssues(parsed.issues),
        sheetName: parsed.sheetName,
      };
    },
  };
}
