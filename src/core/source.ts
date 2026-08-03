export const SOURCE_FILE_TYPES = ["csv", "xls", "xlsx", "txt"] as const;
export const INPUT_FILE_TYPES = [...SOURCE_FILE_TYPES, "zip"] as const;

export type SourceFileType = (typeof SOURCE_FILE_TYPES)[number];
export type InputFileType = (typeof INPUT_FILE_TYPES)[number];

export function detectSourceFileType(fileName: string): SourceFileType | null {
  const extension = fileName.match(/\.([^.]+)$/u)?.[1]?.toLowerCase();
  return SOURCE_FILE_TYPES.find((fileType) => fileType === extension) ?? null;
}

export function detectInputFileType(fileName: string): InputFileType | null {
  const extension = fileName.match(/\.([^.]+)$/u)?.[1]?.toLowerCase();
  return INPUT_FILE_TYPES.find((fileType) => fileType === extension) ?? null;
}
