import { Unzip, UnzipInflate, Zip, ZipDeflate } from "fflate";
import * as iconv from "iconv-lite";

import { concatenateBytes } from "../bytes";
import { detectSourceFileType } from "../file-formats";
import { ARCHIVE_LIMITS, archiveRootName, safeArchivePath } from "./policy";
import type {
  ArchiveExtraction,
  ArchiveOutputEntry,
  ExtractedSourceFile,
  ZipEntryMetadata,
} from "./types";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const MAX_END_RECORD_SEARCH = 65_557;

interface ArchiveQuota {
  declaredExpandedBytes: number;
  entryCount: number;
  expandedBytes: number;
  paths: Set<string>;
}

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function strictUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function byteString(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return value;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function unicodePath(extra: Uint8Array, rawName: Uint8Array): string | null {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const tag = extra[offset]! | (extra[offset + 1]! << 8);
    const size = extra[offset + 2]! | (extra[offset + 3]! << 8);
    const dataOffset = offset + 4;
    const nextOffset = dataOffset + size;
    if (nextOffset > extra.length) return null;
    if (tag === 0x7075 && size >= 5 && extra[dataOffset] === 1) {
      const storedCrc = extra[dataOffset + 1]!
        | (extra[dataOffset + 2]! << 8)
        | (extra[dataOffset + 3]! << 16)
        | (extra[dataOffset + 4]! << 24);
      if ((storedCrc >>> 0) === crc32(rawName)) {
        return strictUtf8(extra.subarray(dataOffset + 5, nextOffset));
      }
    }
    offset = nextOffset;
  }
  return null;
}

function decodeEntryName(
  rawName: Uint8Array,
  extra: Uint8Array,
  utf8: boolean,
): Pick<ZipEntryMetadata, "libraryName" | "name" | "nameEncoding" | "nameWasHeuristic"> {
  if (utf8) {
    const name = strictUtf8(rawName);
    return { libraryName: name, name, nameEncoding: "utf-8", nameWasHeuristic: false };
  }

  const storedUnicodePath = unicodePath(extra, rawName);
  if (storedUnicodePath !== null) {
    return {
      libraryName: byteString(rawName),
      name: storedUnicodePath,
      nameEncoding: "unicode-path",
      nameWasHeuristic: false,
    };
  }

  if (rawName.every((byte) => byte < 0x80)) {
    const name = byteString(rawName);
    return { libraryName: name, name, nameEncoding: "ascii", nameWasHeuristic: false };
  }

  const cp950 = iconv.decode(rawName, "cp950");
  const cp950RoundTrip = new Uint8Array(iconv.encode(cp950, "cp950"));
  if (
    !cp950.includes("\uFFFD")
    && equalBytes(cp950RoundTrip, rawName)
    && /[\u3400-\u9fff\uf900-\ufaff]/u.test(cp950)
  ) {
    return {
      libraryName: byteString(rawName),
      name: cp950,
      nameEncoding: "cp950",
      nameWasHeuristic: true,
    };
  }

  return {
    libraryName: byteString(rawName),
    name: iconv.decode(rawName, "cp437"),
    nameEncoding: "cp437",
    nameWasHeuristic: true,
  };
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
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
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

    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const utf8Flag = (flags & 0x0800) !== 0;
    let decodedName: ReturnType<typeof decodeEntryName>;
    try {
      const extra = bytes.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength);
      decodedName = decodeEntryName(rawName, extra, utf8Flag);
    } catch {
      throw new Error("ZIP 項目名稱不是有效文字。");
    }
    const creatorSystem = versionMadeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    entries.push({
      compressedSize,
      compression,
      encrypted: (flags & 0x0001) !== 0,
      isDirectory: decodedName.name.endsWith("/") || decodedName.name.endsWith("\\"),
      isSymlink: creatorSystem === 3 && (unixMode & 0xf000) === 0xa000,
      ...decodedName,
      rawName: rawName.slice(),
      uncompressedSize,
      utf8Flag,
    });
    offset = nextOffset;
  }

  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    throw new Error("ZIP 中央目錄大小不一致。");
  }
  return entries;
}

function joinVirtualPath(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

function validateMetadata(entries: readonly ZipEntryMetadata[], quota: ArchiveQuota): void {
  const entryPaths = new Set<string>();
  quota.entryCount += entries.length;
  if (quota.entryCount > ARCHIVE_LIMITS.maxEntries) {
    throw new Error(`ZIP 項目累計超過 ${ARCHIVE_LIMITS.maxEntries} 個上限。`);
  }
  for (const entry of entries) {
    const path = safeArchivePath(entry.name);
    if (!entry.isDirectory && entryPaths.has(path)) {
      throw new Error(`ZIP 內出現重複路徑：${path}`);
    }
    entryPaths.add(path);
    if (entry.encrypted) {
      throw new Error(`不支援加密的 ZIP 項目：${entry.name}`);
    }
    if (entry.isSymlink) {
      throw new Error(`不支援 symbolic link：${entry.name}`);
    }
    if (!entry.isDirectory && entry.compression !== 0 && entry.compression !== 8) {
      throw new Error(`ZIP 項目使用不支援的壓縮方式：${entry.name}`);
    }
    if (entry.uncompressedSize > ARCHIVE_LIMITS.maxExpandedFileBytes) {
      throw new Error(`ZIP 內單檔超過 25 MiB：${entry.name}`);
    }
    quota.declaredExpandedBytes += entry.uncompressedSize;
    if (quota.declaredExpandedBytes > ARCHIVE_LIMITS.maxExpandedTotalBytes) {
      throw new Error("ZIP 宣告的展開內容累計超過 100 MiB。");
    }
  }
}

function extractEntries(
  bytes: Uint8Array,
  metadata: readonly ZipEntryMetadata[],
  quota: ArchiveQuota,
): Map<string, Uint8Array> {
  const expected = new Map(metadata.map((entry) => [entry.libraryName, entry]));
  const extracted = new Map<string, Uint8Array>();
  let failure: Error | null = null;
  const unzip = new Unzip((file) => {
    if (failure) {
      return;
    }
    try {
      const entry = expected.get(file.name);
      if (!entry || entry.compression !== file.compression) {
        throw new Error(`ZIP 項目與中央目錄不一致：${file.name}`);
      }
      const safePath = safeArchivePath(entry.name);
      if (entry.isDirectory) {
        return;
      }
      const supported = detectSourceFileType(safePath) !== null || safePath.toLowerCase().endsWith(".zip");
      if (!supported) {
        return;
      }
      const chunks: Uint8Array[] = [];
      let fileBytes = 0;
      file.ondata = (error, chunk, final) => {
        if (failure) {
          return;
        }
        if (error) {
          failure = error;
          return;
        }
        fileBytes += chunk.byteLength;
        quota.expandedBytes += chunk.byteLength;
        if (fileBytes > ARCHIVE_LIMITS.maxExpandedFileBytes || quota.expandedBytes > ARCHIVE_LIMITS.maxExpandedTotalBytes) {
          failure = new Error(fileBytes > ARCHIVE_LIMITS.maxExpandedFileBytes
            ? `ZIP 內單檔實際展開超過 25 MiB：${safePath}`
            : "ZIP 實際展開內容累計超過 100 MiB。");
          file.terminate();
          return;
        }
        if (chunk.byteLength > 0) {
          chunks.push(chunk.slice());
        }
        if (final) {
          extracted.set(safePath, concatenateBytes(chunks, fileBytes));
        }
      };
      file.start();
    } catch (error) {
      failure = error instanceof Error ? error : new Error("無法安全解壓 ZIP。");
    }
  });
  unzip.register(UnzipInflate);
  try {
    unzip.push(bytes, true);
  } catch (error) {
    failure ??= error instanceof Error ? error : new Error("ZIP 解壓失敗。");
  }
  if (failure) {
    throw failure;
  }
  return extracted;
}

async function extractArchive(
  fileName: string,
  bytes: Uint8Array,
  parentPath: string,
  archiveDepth: number,
  quota: ArchiveQuota,
): Promise<ArchiveExtraction> {
  if (archiveDepth > ARCHIVE_LIMITS.maxArchiveDepth) {
    throw new Error(`ZIP 巢狀超過 ${ARCHIVE_LIMITS.maxArchiveDepth} 層上限。`);
  }
  const rootPath = joinVirtualPath(parentPath, archiveRootName(fileName));
  safeArchivePath(`${rootPath}/placeholder`);
  const metadata = inspectZip(bytes);
  validateMetadata(metadata, quota);
  const extracted = extractEntries(bytes, metadata, quota);
  const files: ExtractedSourceFile[] = [];
  let skippedEntries = metadata.filter((entry) => (
    !entry.isDirectory
    && detectSourceFileType(entry.name) === null
    && !entry.name.toLowerCase().endsWith(".zip")
  )).length;
  for (const [entryPath, entryBytes] of extracted) {
    const virtualPath = joinVirtualPath(rootPath, entryPath);
    if (entryPath.toLowerCase().endsWith(".zip")) {
      const segments = entryPath.split("/");
      const nestedFileName = segments.pop() ?? "archive.zip";
      const nested = await extractArchive(
        nestedFileName,
        entryBytes,
        joinVirtualPath(rootPath, ...segments),
        archiveDepth + 1,
        quota,
      );
      files.push(...nested.files);
      skippedEntries += nested.skippedEntries;
      continue;
    }
    const path = safeArchivePath(virtualPath);
    if (quota.paths.has(path)) {
      throw new Error(`ZIP 內出現重複路徑：${path}`);
    }
    quota.paths.add(path);
    files.push({ bytes: entryBytes, relativePath: "", size: entryBytes.byteLength, virtualPath: path });
  }
  return { files, skippedEntries };
}

export async function extractZip(fileName: string, bytes: Uint8Array): Promise<ArchiveExtraction> {
  const rootName = archiveRootName(fileName);
  const extraction = await extractArchive(fileName, bytes, "", 1, {
    declaredExpandedBytes: 0,
    entryCount: 0,
    expandedBytes: 0,
    paths: new Set<string>(),
  });
  return {
    ...extraction,
    files: extraction.files.map((file) => ({
      ...file,
      relativePath: file.virtualPath.slice(rootName.length + 1),
    })),
  };
}

export function serializeZip(entries: readonly ArchiveOutputEntry[]): Promise<Uint8Array> {
  if (entries.length === 0) {
    throw new Error("ZIP 沒有可輸出的檔案。");
  }
  if (entries.length > ARCHIVE_LIMITS.maxEntries) {
    throw new Error(`ZIP 輸出項目超過 ${ARCHIVE_LIMITS.maxEntries} 個上限。`);
  }
  const paths = new Set<string>();
  let sourceBytes = 0;
  const normalized = entries.map((entry) => {
    const path = safeArchivePath(entry.path);
    if (paths.has(path)) {
      throw new Error(`ZIP 輸出路徑碰撞：${path}`);
    }
    paths.add(path);
    if (entry.bytes.byteLength > ARCHIVE_LIMITS.maxExpandedFileBytes) {
      throw new Error(`ZIP 輸出單檔超過 25 MiB：${path}`);
    }
    sourceBytes += entry.bytes.byteLength;
    if (sourceBytes > ARCHIVE_LIMITS.maxExpandedTotalBytes) {
      throw new Error("ZIP 輸出內容累計超過 100 MiB。");
    }
    return { ...entry, path };
  });

  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let outputBytes = 0;
    const zip = new Zip((error, chunk, final) => {
      if (error) {
        reject(error);
        return;
      }
      outputBytes += chunk.byteLength;
      if (outputBytes > ARCHIVE_LIMITS.maxOutputBytes) {
        zip.terminate();
        reject(new Error("ZIP 輸出檔案超過 100 MiB。"));
        return;
      }
      if (chunk.byteLength > 0) {
        chunks.push(chunk.slice());
      }
      if (final) {
        resolve(concatenateBytes(chunks, outputBytes));
      }
    });
    try {
      for (const entry of normalized) {
        const stream = new ZipDeflate(entry.path, { level: 6 });
        stream.mtime = new Date("1980-01-01T00:00:00.000Z");
        zip.add(stream);
        stream.push(entry.bytes, true);
      }
      zip.end();
    } catch (error) {
      zip.terminate();
      reject(error instanceof Error ? error : new Error("無法建立 ZIP。"));
    }
  });
}
