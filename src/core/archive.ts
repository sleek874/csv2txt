export const ARCHIVE_LIMITS = {
  maxArchiveDepth: 5,
  maxEntries: 500,
  maxExpandedFileBytes: 25 * 1024 * 1024,
  maxExpandedTotalBytes: 100 * 1024 * 1024,
  maxVirtualFolderDepth: 5,
} as const;

export interface ZipEntryMetadata {
  compressedSize: number;
  compression: number;
  encrypted: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  name: string;
  uncompressedSize: number;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const MAX_END_RECORD_SEARCH = 65_557;

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function decodeEntryName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
  return new TextDecoder("windows-1252").decode(bytes);
}

function endOfCentralDirectoryOffset(view: DataView): number {
  const minimumOffset = Math.max(0, view.byteLength - MAX_END_RECORD_SEARCH);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (readUint32(view, offset) === END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }
  throw new Error("ZIP 缺少完整的中央目錄。");
}

export function inspectZip(bytes: Uint8Array): ZipEntryMetadata[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 22) {
    throw new Error("ZIP 檔案不完整。");
  }

  const endOffset = endOfCentralDirectoryOffset(view);
  const diskNumber = readUint16(view, endOffset + 4);
  const centralDirectoryDisk = readUint16(view, endOffset + 6);
  const entriesOnDisk = readUint16(view, endOffset + 8);
  const entryCount = readUint16(view, endOffset + 10);
  const centralDirectorySize = readUint32(view, endOffset + 12);
  const centralDirectoryOffset = readUint32(view, endOffset + 16);
  const commentLength = readUint16(view, endOffset + 20);

  if (endOffset + 22 + commentLength !== bytes.byteLength) {
    throw new Error("ZIP 結尾資料不完整或含有未識別內容。");
  }
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error("不支援分割式 ZIP。");
  }
  if (
    entryCount === 0xffff
    || centralDirectorySize === 0xffffffff
    || centralDirectoryOffset === 0xffffffff
  ) {
    throw new Error("目前不支援 ZIP64。");
  }
  if (entryCount > ARCHIVE_LIMITS.maxEntries) {
    throw new Error(`ZIP 項目超過 ${ARCHIVE_LIMITS.maxEntries} 個上限。`);
  }
  if (centralDirectoryOffset + centralDirectorySize > endOffset) {
    throw new Error("ZIP 中央目錄位置無效。");
  }

  const entries: ZipEntryMetadata[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > endOffset || readUint32(view, offset) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error("ZIP 中央目錄項目不完整。");
    }
    const versionMadeBy = readUint16(view, offset + 4);
    const flags = readUint16(view, offset + 8);
    const compression = readUint16(view, offset + 10);
    const compressedSize = readUint32(view, offset + 20);
    const uncompressedSize = readUint32(view, offset + 24);
    const nameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const entryCommentLength = readUint16(view, offset + 32);
    const externalAttributes = readUint32(view, offset + 38);
    const nextOffset = offset + 46 + nameLength + extraLength + entryCommentLength;
    if (nextOffset > endOffset) {
      throw new Error("ZIP 項目名稱或附加資料不完整。");
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error("目前不支援 ZIP64 項目。");
    }

    let name: string;
    try {
      name = decodeEntryName(
        bytes.subarray(offset + 46, offset + 46 + nameLength),
        (flags & 0x0800) !== 0,
      );
    } catch {
      throw new Error("ZIP 項目名稱不是有效文字。");
    }
    const creatorSystem = versionMadeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    const isSymlink = creatorSystem === 3 && (unixMode & 0xf000) === 0xa000;
    entries.push({
      compressedSize,
      compression,
      encrypted: (flags & 0x0001) !== 0,
      isDirectory: name.endsWith("/") || name.endsWith("\\"),
      isSymlink,
      name,
      uncompressedSize,
    });
    offset = nextOffset;
  }

  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    throw new Error("ZIP 中央目錄大小不一致。");
  }
  return entries;
}

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
    throw new Error(
      `ZIP 路徑超過 ${ARCHIVE_LIMITS.maxVirtualFolderDepth} 層資料夾上限：${path}`,
    );
  }
  return meaningfulSegments.join("/");
}

export function archiveRootName(fileName: string): string {
  return safeArchivePath(fileName).replace(/\.zip$/iu, "") || "ZIP";
}
