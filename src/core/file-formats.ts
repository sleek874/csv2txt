export const SOURCE_FILE_TYPES = ["csv", "xls", "xlsx", "txt"] as const;
export const INPUT_FILE_TYPES = [...SOURCE_FILE_TYPES, "zip"] as const;
export const OUTPUT_FORMATS = ["big5-txt", "csv", "xlsx"] as const;

export type SourceFileType = (typeof SOURCE_FILE_TYPES)[number];
export type InputFileType = (typeof INPUT_FILE_TYPES)[number];
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

function extension(fileName: string): string | null {
  return fileName.match(/\.([^.]+)$/u)?.[1]?.toLowerCase() ?? null;
}

export function detectSourceFileType(fileName: string): SourceFileType | null {
  const candidate = extension(fileName);
  return SOURCE_FILE_TYPES.find((fileType) => fileType === candidate) ?? null;
}

export function detectInputFileType(fileName: string): InputFileType | null {
  const candidate = extension(fileName);
  return INPUT_FILE_TYPES.find((fileType) => fileType === candidate) ?? null;
}

export function outputStem(fileName: string): string {
  return fileName.replace(/\.(?:csv|xlsx?|txt)$/iu, "");
}

export function outputPath(fileName: string, format: OutputFormat): string {
  const extension = format === "big5-txt" ? "txt" : format;
  return `${outputStem(fileName)}.${extension}`;
}
