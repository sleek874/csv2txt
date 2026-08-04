import Papa from "papaparse";

import { concatenateBytes } from "../bytes";
import { decodeSource } from "../encoding";
import type { ParsedRows, SerializableRow } from "./types";

export interface ParsedCsv extends ParsedRows {
  decoderLabel: string;
}

function translatedError(code: string): string {
  const messages: Record<string, string> = {
    MissingQuotes: "引號未正確結束。",
    InvalidQuotes: "引號格式不正確。",
    UndetectableDelimiter: "無法判斷 CSV 欄位分隔符號。",
    TooFewFields: "這筆資料的欄位數不足。",
    TooManyFields: "這筆資料的欄位數過多。",
  };
  return messages[code] ?? "CSV 內容格式不正確。";
}

export function parseCsvText(text: string): ParsedRows {
  const result = Papa.parse<string[]>(text, {
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false,
  });
  const rows = result.data.map((row) => row.map((value) => String(value)));

  if (/\r\n$|[\r\n]$/u.test(text)) {
    const finalRow = rows.at(-1);
    if (finalRow?.length === 1 && finalRow[0] === "") {
      rows.pop();
    }
  }

  return {
    rows,
    issues: result.errors.map((error) => ({
      message: translatedError(error.code),
      severity: "error",
      ...(typeof error.row === "number" ? { sourceRow: error.row + 1 } : {}),
    })),
  };
}

export function parseCsv(bytes: Uint8Array): ParsedCsv {
  const decoded = decodeSource(bytes);
  return {
    ...parseCsvText(decoded.text),
    decoderLabel: decoded.label,
  };
}

export function serializeCsv(rows: readonly SerializableRow[]): Uint8Array {
  const body = Papa.unparse(rows.map((row) => [...row.values]), {
    header: false,
    newline: "\r\n",
    quotes: false,
    skipEmptyLines: false,
    escapeFormulae: false,
  });
  const content = new TextEncoder().encode(body === "" ? "" : `${body}\r\n`);
  return concatenateBytes([new Uint8Array([0xef, 0xbb, 0xbf]), content]);
}
