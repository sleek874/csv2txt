import type { ParsedSpreadsheet } from "../core/spreadsheet";

type SpreadsheetModule = typeof import("../core/spreadsheet");
type SpreadsheetImporter = () => Promise<SpreadsheetModule>;

export interface SpreadsheetParser {
  parse(
    bytes: Uint8Array,
    minimumColumnCount: number,
  ): Promise<ParsedSpreadsheet>;
  prepare(): Promise<void>;
}

export function createSpreadsheetParser(
  importer: SpreadsheetImporter = () => import("../core/spreadsheet"),
): SpreadsheetParser {
  let modulePromise: Promise<SpreadsheetModule> | null = null;

  function load(): Promise<SpreadsheetModule> {
    modulePromise ??= importer().catch((error: unknown) => {
      modulePromise = null;
      throw error;
    });
    return modulePromise;
  }

  return {
    async prepare(): Promise<void> {
      await load();
    },
    async parse(bytes, minimumColumnCount) {
      const spreadsheet = await load();
      return spreadsheet.parseSpreadsheet(bytes, minimumColumnCount);
    },
  };
}
