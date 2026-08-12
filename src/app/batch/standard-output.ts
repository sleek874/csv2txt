import { outputPath, type OutputFormat } from "../../core/file-formats";
import type { SerializableRow } from "../../core/formats/types";
import { describeOutputIssue } from "../../core/output-validation";
import type { CreatedOutput } from "../adapters/output-adapter";
import { taipeiMinuteStamp } from "../adapters/output-adapter";
import type { CodecManager } from "../resources/codec-manager";
import { compactValue, type CompactFile } from "./compact-workspace";
import { compactOutputIssues } from "./workspace-summary";

const MIME_TYPES: Record<OutputFormat, string> = {
  "big5-txt": "application/octet-stream",
  csv: "text/csv;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function serializableRows(file: CompactFile): SerializableRow[] {
  const rows: SerializableRow[] = [];
  for (let rowIndex = 0; rowIndex < file.sourceRows.length; rowIndex += 1) {
    if (file.included[rowIndex] !== 1) continue;
    rows.push({
      sourceRow: file.sourceRows[rowIndex]!,
      values: Array.from({ length: 15 }, (_, columnIndex) => compactValue(file, rowIndex, columnIndex)),
    });
  }
  return rows;
}

export async function createCompactOutput(
  files: readonly CompactFile[],
  format: OutputFormat,
  codecs: CodecManager,
  createdAt: Date,
): Promise<CreatedOutput> {
  if (files.length === 0) throw new Error("工作區沒有可輸出的檔案。");
  const blockingIssue = files.flatMap((file) => compactOutputIssues(file, format))
    .find((issue) => issue.blocking);
  if (blockingIssue) throw new Error(describeOutputIssue(blockingIssue));

  const planned = files.map((file) => {
    if (file.hasBlockingIssues) throw new Error(`${file.virtualPath} 仍有無法逐列處理的錯誤。`);
    if (file.summary.includedRows === 0) throw new Error(`${file.virtualPath} 尚未選擇任何輸出列。`);
    return { file, path: outputPath(file.virtualPath, format) };
  });
  const paths = new Set<string>();
  for (const { path } of planned) {
    if (paths.has(path)) throw new Error(`輸出路徑碰撞：${path}`);
    paths.add(path);
  }

  let serialize: (rows: SerializableRow[]) => Uint8Array;
  switch (format) {
    case "big5-txt": serialize = (await codecs.big5Txt()).serializeBig5Txt; break;
    case "csv": serialize = (await codecs.csv()).serializeCsv; break;
    case "xlsx": serialize = (await codecs.spreadsheet()).serializeSpreadsheet; break;
  }
  const outputs = planned.map(({ file, path }) => ({
    path,
    bytes: serialize(serializableRows(file)),
  }));
  if (outputs.length > 1) {
    return {
      bytes: await (await codecs.zip()).serializeZip(outputs),
      filename: `${format}-${taipeiMinuteStamp(createdAt)}.zip`,
      mimeType: "application/zip",
    };
  }
  const output = outputs[0];
  if (!output) throw new Error("工作區沒有可輸出的檔案。");
  return { bytes: output.bytes, filename: basename(output.path), mimeType: MIME_TYPES[format] };
}
