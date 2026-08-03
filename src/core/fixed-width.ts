import { encodeBig5 } from "./encoding";
import { FIXED_FIELDS } from "./fixed-profile";
import { cellValue, hasBlockingFileIssues, type InternalFile } from "./internal-model";

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });
  return output;
}

export function serializeFixedWidthBig5(file: InternalFile): Uint8Array {
  if (hasBlockingFileIssues(file)) {
    throw new Error("檔案仍有無法逐列處理的錯誤，無法建立 Big5 TXT。");
  }
  if (!file.rows.some((row) => row.included)) {
    throw new Error("尚未選擇任何輸出列。");
  }

  const chunks: Uint8Array[] = [];
  file.rows.filter((row) => row.included).forEach((row) => {
    row.cells.forEach((cell, columnIndex) => {
      const field = FIXED_FIELDS[columnIndex];
      if (!field) {
        throw new Error("固定欄位設定不完整。");
      }
      const encoded = encodeBig5(cellValue(cell));
      if (!encoded || encoded.length > field.widthBytes) {
        throw new Error(`第 ${row.sourceRow} 筆、欄位${field.index}無法序列化。`);
      }
      chunks.push(encoded, new Uint8Array(field.widthBytes - encoded.length).fill(0x20));
    });
    chunks.push(new Uint8Array([0x0d, 0x0a]));
  });
  return concatenate(chunks);
}
