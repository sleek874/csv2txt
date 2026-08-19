import { FILE_SIZE_LIMIT_BYTES } from "../file-size-policy";

export const ARCHIVE_LIMITS = {
  maxArchiveDepth: 5,
  maxEntries: 500,
  maxOutputEntryBytes: FILE_SIZE_LIMIT_BYTES,
  maxOutputSourceBytes: FILE_SIZE_LIMIT_BYTES,
  maxOutputBytes: FILE_SIZE_LIMIT_BYTES,
  maxVirtualFolderDepth: 5,
} as const;

export function safeArchivePath(path: string): string {
  if (
    path.length === 0
    || path.startsWith("/")
    || path.startsWith("\\")
    || /^[a-z]:/iu.test(path)
    || /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    throw new Error(`ZIP 路徑不安全：${path || "（空白名稱）"}`);
  }

  const segments = path.replaceAll("\\", "/").split("/");
  const directoryEntry = segments.at(-1) === "";
  const meaningfulSegments = segments.filter((segment) => segment !== "");
  if (
    meaningfulSegments.length === 0
    || meaningfulSegments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`ZIP 路徑不安全：${path}`);
  }
  const folderDepth = meaningfulSegments.length - (directoryEntry ? 0 : 1);
  if (folderDepth > ARCHIVE_LIMITS.maxVirtualFolderDepth) {
    throw new Error(`ZIP 路徑超過 ${ARCHIVE_LIMITS.maxVirtualFolderDepth} 層資料夾上限：${path}`);
  }
  return meaningfulSegments.join("/");
}

export function compareCanonicalVirtualPaths(left: string, right: string): number {
  const normalizedLeft = left.normalize("NFC");
  const normalizedRight = right.normalize("NFC");
  if (normalizedLeft !== normalizedRight) return normalizedLeft < normalizedRight ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function archiveRootName(fileName: string): string {
  return safeArchivePath(fileName).replace(/\.zip$/iu, "") || "ZIP";
}
