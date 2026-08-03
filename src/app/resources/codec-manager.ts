import type { InputFileType, OutputFormat, SourceFileType } from "../../core/file-formats";
import * as builtInBig5TxtCodec from "../../core/formats/big5-txt";
import * as builtInCsvCodec from "../../core/formats/csv";

type CsvCodec = typeof import("../../core/formats/csv");
type Big5TxtCodec = typeof import("../../core/formats/big5-txt");
type SpreadsheetCodec = typeof import("../../core/formats/spreadsheet");
type ZipCodec = typeof import("../../core/archive/zip");

export interface CodecManager {
  big5Txt(): Promise<Big5TxtCodec>;
  csv(): Promise<CsvCodec>;
  spreadsheet(): Promise<SpreadsheetCodec>;
  zip(): Promise<ZipCodec>;
  prepareInput(type: InputFileType): Promise<void>;
  prepareOutput(format: OutputFormat): Promise<void>;
  prepareSource(type: SourceFileType): Promise<void>;
}

interface CodecImporters {
  big5Txt: () => Promise<Big5TxtCodec>;
  csv: () => Promise<CsvCodec>;
  spreadsheet: () => Promise<SpreadsheetCodec>;
  zip: () => Promise<ZipCodec>;
}

function memoized<T>(importer: () => Promise<T>): () => Promise<T> {
  let modulePromise: Promise<T> | null = null;
  return () => {
    modulePromise ??= importer().catch((error: unknown) => {
      modulePromise = null;
      throw error;
    });
    return modulePromise;
  };
}

export function createCodecManager(importers: Partial<CodecImporters> = {}): CodecManager {
  const big5Txt = memoized(importers.big5Txt ?? (() => Promise.resolve(builtInBig5TxtCodec)));
  const csv = memoized(importers.csv ?? (() => Promise.resolve(builtInCsvCodec)));
  const spreadsheet = memoized(importers.spreadsheet ?? (() => import("../../core/formats/spreadsheet")));
  const zip = memoized(importers.zip ?? (() => import("../../core/archive/zip")));

  async function prepareSource(type: SourceFileType): Promise<void> {
    switch (type) {
      case "csv":
        await csv();
        return;
      case "txt":
        await big5Txt();
        return;
      case "xls":
      case "xlsx":
        await spreadsheet();
    }
  }

  return {
    big5Txt,
    csv,
    spreadsheet,
    zip,
    async prepareInput(type) {
      if (type === "zip") {
        await zip();
        return;
      }
      await prepareSource(type);
    },
    async prepareOutput(format) {
      switch (format) {
        case "big5-txt":
          await big5Txt();
          return;
        case "csv":
          await csv();
          return;
        case "xlsx":
          await spreadsheet();
      }
    },
    prepareSource,
  };
}
