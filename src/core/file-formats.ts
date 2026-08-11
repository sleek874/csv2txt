export const SOURCE_FILE_TYPES = ["csv", "xls", "xlsx", "txt"] as const;
export const INPUT_FILE_TYPES = [...SOURCE_FILE_TYPES, "zip"] as const;
export const OUTPUT_FORMATS = ["big5-txt", "csv", "xlsx"] as const;
export const FILE_FORMATS = ["txt", "csv", "xlsx"] as const;

export type SourceFileType = (typeof SOURCE_FILE_TYPES)[number];
export type InputFileType = (typeof INPUT_FILE_TYPES)[number];
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];
export type FileFormat = (typeof FILE_FORMATS)[number];

export const FILE_FORMAT_LABELS: Record<FileFormat, string> = {
  txt: "TXT",
  csv: "CSV",
  xlsx: "XLSX",
};

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

export function fileFormatForSourceType(fileType: SourceFileType): FileFormat {
  if (fileType === "txt") return "txt";
  if (fileType === "csv") return "csv";
  return "xlsx";
}

export function outputFormatForFileFormat(format: FileFormat): OutputFormat {
  return format === "txt" ? "big5-txt" : format;
}

export function fileFormatForOutput(format: OutputFormat): FileFormat {
  return format === "big5-txt" ? "txt" : format;
}

export function outputStem(fileName: string): string {
  return fileName.replace(/\.(?:csv|xlsx?|txt)$/iu, "");
}

export function outputPath(fileName: string, format: OutputFormat): string {
  const extension = format === "big5-txt" ? "txt" : format;
  return `${outputStem(fileName)}.${extension}`;
}
