import type { AdvancedLookupResult } from "../../core/advanced/lookup";
import type {
  HeaderedSpreadsheet,
  WorkbookSummary,
} from "../../core/formats/spreadsheet";
import type { CodecManager } from "../resources/codec-manager";
import { outputBlob, taipeiMinuteStamp, type CreatedOutput } from "../batch/output-artifact";

export interface AdvancedOutputAdapter {
  create(result: AdvancedLookupResult, createdAt?: Date): Promise<CreatedOutput>;
  inspect(bytes: Uint8Array): Promise<WorkbookSummary>;
  parse(bytes: Uint8Array, sheetName: string): Promise<HeaderedSpreadsheet>;
}

export function createAdvancedOutputAdapter(codecs: CodecManager): AdvancedOutputAdapter {
  return {
    async create(result, createdAt = new Date()) {
      const spreadsheet = await codecs.spreadsheet();
      return {
        blob: outputBlob(
          spreadsheet.serializeHeaderedSpreadsheet(result.headers, result.rows),
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
        filename: `進階輸出-${taipeiMinuteStamp(createdAt)}.xlsx`,
      };
    },
    async inspect(bytes) {
      return (await codecs.spreadsheet()).inspectSpreadsheet(bytes);
    },
    async parse(bytes, sheetName) {
      return (await codecs.spreadsheet()).parseHeaderedSpreadsheet(bytes, sheetName);
    },
  };
}
