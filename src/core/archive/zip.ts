import { Inflate, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import * as iconv from "iconv-lite";

import { concatenateBytes } from "../bytes";
import { exceedsFileSizeLimit, FILE_SIZE_LIMIT_TECHNICAL_LABEL } from "../file-size-policy";
import { detectSourceFileType } from "../file-formats";
import {
  ARCHIVE_LIMITS,
  archiveRootName,
  OUTPUT_ZIP_SIZE_LIMIT_LABEL,
  safeArchivePath,
} from "./policy";
import type {
  ArchiveDiscardReason,
  ArchiveExtraction,
  ArchiveOutputEntry,
  ArchiveOutputOptions,
  ArchiveVisit,
  ExtractedSourceFile,
  SkippedArchiveEntry,
  ZipEntryMetadata,
} from "./types";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_END_RECORD_SEARCH = 65_557;
const INFLATE_CHUNK_BYTES = 64 * 1024;

interface ArchiveQuota {
  candidateCount: number;
  scannedEntryCount: number;
  paths: Set<string>;
}

class ArchiveQuotaError extends Error {}
class ArchiveFatalError extends Error {}

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
): Pick<ZipEntryMetadata, "name" | "nameEncoding" | "nameWasHeuristic"> {
  if (utf8) {
    const name = strictUtf8(rawName);
    return { name, nameEncoding: "utf-8", nameWasHeuristic: false };
  }

  const storedUnicodePath = unicodePath(extra, rawName);
  if (storedUnicodePath !== null) {
    return {
      name: storedUnicodePath,
      nameEncoding: "unicode-path",
      nameWasHeuristic: false,
    };
  }

  if (rawName.every((byte) => byte < 0x80)) {
    const name = byteString(rawName);
    return { name, nameEncoding: "ascii", nameWasHeuristic: false };
  }

  const cp950 = iconv.decode(rawName, "cp950");
  const cp950RoundTrip = new Uint8Array(iconv.encode(cp950, "cp950"));
  if (
    !cp950.includes("\uFFFD")
    && equalBytes(cp950RoundTrip, rawName)
    && /[\u3400-\u9fff\uf900-\ufaff]/u.test(cp950)
  ) {
    return {
      name: cp950,
      nameEncoding: "cp950",
      nameWasHeuristic: true,
    };
  }

  return {
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
    throw new ArchiveFatalError("不支援分割式 ZIP。");
  }
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    throw new ArchiveFatalError("目前不支援 ZIP64。");
  }
  if (entryCount > ARCHIVE_LIMITS.maxEntries) {
    throw new ArchiveQuotaError(`ZIP 項目超過 ${ARCHIVE_LIMITS.maxEntries} 個上限。`);
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
    const localHeaderOffset = readUint32(view, offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + entryCommentLength;
    if (nextOffset > endOffset) {
      throw new Error("ZIP 項目名稱或附加資料不完整。");
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new ArchiveFatalError("目前不支援 ZIP64 項目。");
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
      flags,
      isDirectory: decodedName.name.endsWith("/") || decodedName.name.endsWith("\\"),
      isSymlink: creatorSystem === 3 && (unixMode & 0xf000) === 0xa000,
      ...decodedName,
      localHeaderOffset,
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

function countEntries(entries: readonly ZipEntryMetadata[], quota: ArchiveQuota): void {
  quota.scannedEntryCount += entries.length;
  if (quota.scannedEntryCount > ARCHIVE_LIMITS.maxEntries) {
    throw new ArchiveQuotaError(`ZIP 項目累計超過 ${ARCHIVE_LIMITS.maxEntries} 個上限。`);
  }
}

function centralDirectoryStart(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return readUint32(view, endOfCentralDirectoryOffset(view) + 16);
}

function compressedEntryBytes(
  bytes: Uint8Array,
  entry: ZipEntryMetadata,
  dataBoundary: number,
): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > dataBoundary || readUint32(view, offset) !== LOCAL_FILE_HEADER) {
    throw new Error(`ZIP 項目的本機標頭不完整：${entry.name}`);
  }
  const flags = readUint16(view, offset + 6);
  const compression = readUint16(view, offset + 8);
  const nameLength = readUint16(view, offset + 26);
  const extraLength = readUint16(view, offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  const localName = bytes.subarray(offset + 30, offset + 30 + nameLength);
  if (
    dataOffset > dataBoundary
    || dataEnd > dataBoundary
    || flags !== entry.flags
    || compression !== entry.compression
    || !equalBytes(localName, entry.rawName)
  ) {
    throw new Error(`ZIP 項目與中央目錄不一致：${entry.name}`);
  }
  return bytes.subarray(dataOffset, dataEnd);
}

function extractEntry(
  bytes: Uint8Array,
  entry: ZipEntryMetadata,
  safePath: string,
  dataBoundary: number,
): Uint8Array {
  const compressed = compressedEntryBytes(bytes, entry, dataBoundary);
  if (entry.compression === 0) {
    if (exceedsFileSizeLimit(compressed.byteLength)) {
      throw new Error(`ZIP 內單檔實際展開超過 ${FILE_SIZE_LIMIT_TECHNICAL_LABEL}：${safePath}`);
    }
    return compressed;
  }

  const chunks: Uint8Array[] = [];
  let outputBytes = 0;
  const inflate = new Inflate((chunk) => {
    outputBytes += chunk.byteLength;
    if (exceedsFileSizeLimit(outputBytes)) {
      throw new Error(`ZIP 內單檔實際展開超過 ${FILE_SIZE_LIMIT_TECHNICAL_LABEL}：${safePath}`);
    }
    if (chunk.byteLength > 0) chunks.push(chunk.slice());
  });
  for (let offset = 0; offset < compressed.byteLength; offset += INFLATE_CHUNK_BYTES) {
    const end = Math.min(offset + INFLATE_CHUNK_BYTES, compressed.byteLength);
    inflate.push(compressed.subarray(offset, end), end === compressed.byteLength);
  }
  if (compressed.byteLength === 0) inflate.push(compressed, true);
  return concatenateBytes(chunks, outputBytes);
}

function discarded(
  quota: ArchiveQuota,
  rootName: string,
  rootPath: string,
  entryName: string,
  reason: ArchiveDiscardReason,
  removeCandidate = false,
): ArchiveVisit {
  if (removeCandidate) quota.candidateCount -= 1;
  const virtualPath = joinVirtualPath(rootPath, entryName.replaceAll("\\", "/"));
  return {
    candidateCount: quota.candidateCount,
    kind: "discarded",
    reason,
    relativePath: virtualPath.slice(rootName.length + 1),
    virtualPath,
  };
}

function isSupportedLeafCandidate(
  entry: ZipEntryMetadata,
  rootPath: string,
): boolean {
  if (
    entry.isDirectory
    || entry.isSymlink
    || entry.encrypted
    || (entry.compression !== 0 && entry.compression !== 8)
    || exceedsFileSizeLimit(entry.uncompressedSize)
    || entry.name.toLowerCase().endsWith(".zip")
  ) {
    return false;
  }
  try {
    const entryPath = safeArchivePath(entry.name);
    safeArchivePath(joinVirtualPath(rootPath, entryPath));
    return detectSourceFileType(entryPath) !== null;
  } catch {
    return false;
  }
}

async function* walkArchive(
  rootName: string,
  fileName: string,
  bytes: Uint8Array,
  parentPath: string,
  archiveDepth: number,
  quota: ArchiveQuota,
): AsyncGenerator<ArchiveVisit> {
  const rootPath = joinVirtualPath(parentPath, archiveRootName(fileName));
  safeArchivePath(`${rootPath}/placeholder`);
  const metadata = inspectZip(bytes);
  const dataBoundary = centralDirectoryStart(bytes);
  countEntries(metadata, quota);
  const previousCandidateCount = quota.candidateCount;
  const supportedCandidates = new Set(metadata.filter((entry) => (
    isSupportedLeafCandidate(entry, rootPath)
  )));
  quota.candidateCount += supportedCandidates.size;
  if (quota.candidateCount !== previousCandidateCount) {
    yield {
      candidateCount: quota.candidateCount,
      kind: "candidates",
      virtualPath: rootPath,
    };
  }
  for (const entry of metadata) {
    if (entry.isDirectory) continue;
    let entryPath: string;
    try {
      entryPath = safeArchivePath(entry.name);
    } catch {
      yield discarded(quota, rootName, rootPath, entry.name, "unsafe-path");
      continue;
    }
    const isZip = entryPath.toLowerCase().endsWith(".zip");
    const type = detectSourceFileType(entryPath);
    if (entry.isSymlink) {
      yield discarded(quota, rootName, rootPath, entryPath, "symlink");
      continue;
    }
    if (entry.encrypted) {
      yield discarded(quota, rootName, rootPath, entryPath, "encrypted");
      continue;
    }
    if (entry.compression !== 0 && entry.compression !== 8) {
      yield discarded(quota, rootName, rootPath, entryPath, "unsupported-compression");
      continue;
    }
    if (exceedsFileSizeLimit(entry.uncompressedSize)) {
      yield discarded(quota, rootName, rootPath, entryPath, "too-large");
      continue;
    }
    if (!type && !isZip) {
      yield discarded(quota, rootName, rootPath, entryPath, "unsupported-type");
      continue;
    }
    let virtualPath: string;
    try {
      virtualPath = safeArchivePath(joinVirtualPath(rootPath, entryPath));
    } catch {
      yield discarded(quota, rootName, rootPath, entryPath, "unsafe-path");
      continue;
    }
    if (quota.paths.has(virtualPath)) {
      yield discarded(
        quota,
        rootName,
        rootPath,
        entryPath,
        "duplicate-path",
        supportedCandidates.has(entry),
      );
      continue;
    }
    if (isZip && archiveDepth >= ARCHIVE_LIMITS.maxArchiveDepth) {
      yield discarded(quota, rootName, rootPath, entryPath, "archive-depth");
      continue;
    }
    const nestedSegments = isZip ? entryPath.split("/") : [];
    const nestedFileName = isZip ? nestedSegments.pop() ?? "archive.zip" : "";
    if (isZip) {
      try {
        safeArchivePath(joinVirtualPath(
          rootPath,
          ...nestedSegments,
          archiveRootName(nestedFileName),
          "placeholder",
        ));
      } catch {
        yield discarded(quota, rootName, rootPath, entryPath, "unsafe-path");
        continue;
      }
    }
    quota.paths.add(virtualPath);

    let entryBytes: Uint8Array;
    try {
      entryBytes = extractEntry(bytes, entry, entryPath, dataBoundary);
    } catch {
      yield discarded(
        quota,
        rootName,
        rootPath,
        entryPath,
        "invalid-file",
        supportedCandidates.has(entry),
      );
      continue;
    }
    if (isZip) {
      try {
        yield* walkArchive(
          rootName,
          nestedFileName,
          entryBytes,
          joinVirtualPath(rootPath, ...nestedSegments),
          archiveDepth + 1,
          quota,
        );
      } catch (error) {
        if (error instanceof ArchiveFatalError || error instanceof ArchiveQuotaError) throw error;
        yield discarded(quota, rootName, rootPath, entryPath, "invalid-archive");
      }
      continue;
    }
    yield {
      bytes: entryBytes,
      candidateCount: quota.candidateCount,
      kind: "file",
      relativePath: virtualPath.slice(rootName.length + 1),
      size: entryBytes.byteLength,
      virtualPath,
    };
  }
}

export function walkZip(fileName: string, bytes: Uint8Array): AsyncGenerator<ArchiveVisit> {
  const rootName = archiveRootName(fileName);
  return walkArchive(rootName, fileName, bytes, "", 1, {
    candidateCount: 0,
    scannedEntryCount: 0,
    paths: new Set<string>(),
  });
}

export async function extractZip(fileName: string, bytes: Uint8Array): Promise<ArchiveExtraction> {
  const files: ExtractedSourceFile[] = [];
  const skippedEntries: SkippedArchiveEntry[] = [];
  for await (const visit of walkZip(fileName, bytes)) {
    if (visit.kind === "candidates") {
      continue;
    }
    if (visit.kind === "file") {
      const { candidateCount: _candidateCount, kind: _kind, ...file } = visit;
      files.push(file);
    } else {
      const { candidateCount: _candidateCount, kind: _kind, ...entry } = visit;
      skippedEntries.push(entry);
    }
  }
  return { files, skippedEntries };
}

export async function serializeZip(
  entries: readonly ArchiveOutputEntry[],
  options: ArchiveOutputOptions = {},
): Promise<Blob> {
  if (entries.length === 0) {
    throw new Error("ZIP 沒有可輸出的檔案。");
  }
  if (entries.length > ARCHIVE_LIMITS.maxOutputEntries) {
    throw new Error(`ZIP 輸出項目超過 ${ARCHIVE_LIMITS.maxOutputEntries} 個上限。`);
  }
  const paths = new Set<string>();
  const normalized = entries.map((entry) => {
    const path = safeArchivePath(entry.path);
    if (paths.has(path)) {
      throw new Error(`ZIP 輸出路徑碰撞：${path}`);
    }
    paths.add(path);
    return { ...entry, path };
  });

  const chunks: ArrayBuffer[] = [];
  let terminalError: Error | null = null;
  let outputBytes = 0;
  let resolveZip!: (blob: Blob) => void;
  let rejectZip!: (error: Error) => void;
  const completed = new Promise<Blob>((resolve, reject) => {
    resolveZip = resolve;
    rejectZip = reject;
  });
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      terminalError = error;
      rejectZip(error);
      return;
    }
    outputBytes += chunk.byteLength;
    if (outputBytes > ARCHIVE_LIMITS.maxOutputBytes) {
      terminalError = new Error(`ZIP 輸出檔案超過 ${OUTPUT_ZIP_SIZE_LIMIT_LABEL}。`);
      zip.terminate();
      rejectZip(terminalError);
      return;
    }
    if (chunk.byteLength > 0) {
      chunks.push(
        chunk.buffer instanceof ArrayBuffer
          && chunk.byteOffset === 0
          && chunk.byteLength === chunk.buffer.byteLength
          ? chunk.buffer
          : chunk.slice().buffer as ArrayBuffer,
      );
    }
    if (final) {
      resolveZip(new Blob(chunks, { type: "application/zip" }));
    }
  });

  const assertActive = () => {
    if (options.isCancelled?.()) throw new Error("已取消建立下載。");
    if (terminalError) throw terminalError;
  };
  const createStream = options.compression === "store"
    ? (path: string) => new ZipPassThrough(path)
    : (path: string) => new ZipDeflate(path, { level: 6 });

  try {
    for (const entry of normalized) {
      assertActive();
      let bytes: Uint8Array | null = await entry.createBytes();
      assertActive();
      if (bytes.byteLength > ARCHIVE_LIMITS.maxOutputEntryBytes) {
        throw new Error(`ZIP 輸出單檔超過 ${FILE_SIZE_LIMIT_TECHNICAL_LABEL}：${entry.path}`);
      }
      const stream = createStream(entry.path);
      stream.mtime = new Date("1980-01-01T00:00:00.000Z");
      zip.add(stream);
      stream.push(bytes, true);
      bytes = null;
      assertActive();
      await options.yieldAfterEntry?.();
      assertActive();
    }
    zip.end();
    return await completed;
  } catch (error) {
    zip.terminate();
    void completed.catch(() => undefined);
    throw error instanceof Error ? error : new Error("無法建立 ZIP。");
  }
}
