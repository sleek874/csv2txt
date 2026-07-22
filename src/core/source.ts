export const SOURCE_FILE_TYPES = ["csv", "xls", "xlsx"] as const;

export type SourceFileType = (typeof SOURCE_FILE_TYPES)[number];

export function detectSourceFileType(fileName: string): SourceFileType | null {
  const extension = fileName.match(/\.([^.]+)$/u)?.[1]?.toLowerCase();
  return SOURCE_FILE_TYPES.find((fileType) => fileType === extension) ?? null;
}
