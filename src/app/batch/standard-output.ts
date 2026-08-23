import { outputPath, type OutputFormat } from "../../core/file-formats";
import { ARCHIVE_LIMITS } from "../../core/archive/policy";
import { FILE_SIZE_LIMIT_TECHNICAL_LABEL } from "../../core/file-size-policy";
import type { SerializableRow } from "../../core/formats/types";
import { describeOutputIssue } from "../../core/output-validation";
import type { CodecManager } from "../resources/codec-manager";
import { compactValue, type CompactFile } from "./compact-workspace";
import { outputBlob, taipeiMinuteStamp, type CreatedOutput } from "./output-artifact";
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
  options: {
    isCancelled?: () => boolean;
    yieldAfterFile?: () => Promise<void>;
  } = {},
): Promise<CreatedOutput> {
  const outputFiles = files.filter((file) => file.summary.includedRows > 0);
  if (outputFiles.length === 0) throw new Error("工作區沒有已勾選的輸出列。");
  const blockingIssue = outputFiles.flatMap((file) => compactOutputIssues(file, format))
    .find((issue) => issue.blocking);
  if (blockingIssue) throw new Error(describeOutputIssue(blockingIssue));

  const planned = outputFiles.map((file) => {
    if (file.hasBlockingIssues) throw new Error(`${file.virtualPath} 仍有無法逐列處理的錯誤。`);
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
  const assertActive = () => {
    if (options.isCancelled?.()) throw new Error("已取消建立下載。");
  };
  const createBytes = (file: CompactFile, path: string) => {
    assertActive();
    const bytes = serialize(serializableRows(file));
    if (bytes.byteLength > ARCHIVE_LIMITS.maxOutputEntryBytes) {
      throw new Error(`輸出單檔超過 ${FILE_SIZE_LIMIT_TECHNICAL_LABEL}：${path}`);
    }
    return bytes;
  };

  if (planned.length > 1) {
    const zip = await codecs.zip();
    return {
      blob: await zip.serializeZip(
        planned.map(({ file, path }) => ({
          path,
          createBytes: () => createBytes(file, path),
        })),
        {
          compression: format === "xlsx" ? "store" : "deflate",
          isCancelled: options.isCancelled,
          yieldAfterEntry: options.yieldAfterFile,
        },
      ),
      filename: `${format}-${taipeiMinuteStamp(createdAt)}.zip`,
    };
  }
  const output = planned[0];
  if (!output) throw new Error("工作區沒有可輸出的檔案。");
  const bytes = createBytes(output.file, output.path);
  await options.yieldAfterFile?.();
  assertActive();
  return {
    blob: outputBlob(bytes, MIME_TYPES[format]),
    filename: basename(output.path),
  };
}
