import Papa from "papaparse";

export interface ParsedCsv {
  rows: string[][];
  errors: string[];
}

export function parseCsv(text: string): ParsedCsv {
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
    errors: result.errors.map((error) => {
      const translatedMessages: Record<string, string> = {
        MissingQuotes: "引號未正確結束。",
        InvalidQuotes: "引號格式不正確。",
        UndetectableDelimiter: "無法判斷 CSV 欄位分隔符號。",
        TooFewFields: "這筆資料的欄位數不足。",
        TooManyFields: "這筆資料的欄位數過多。",
      };
      const rowLabel = typeof error.row === "number" ? `（資料列 ${error.row + 1}）` : "";
      return `CSV 格式錯誤${rowLabel}：${translatedMessages[error.code] ?? "CSV 內容格式不正確。"}`;
    }),
  };
}
