import {
  ARCHIVE_LIMITS,
  archiveRootName,
  inspectZip,
  safeArchivePath,
  type ZipEntryMetadata,
} from "../core/archive";
import { detectSourceFileType } from "../core/source";

type FflateModule = typeof import("fflate");
type ArchiveImporter = () => Promise<FflateModule>;

export interface ExtractedSourceFile {
  bytes: Uint8Array;
  size: number;
  virtualPath: string;
}

export interface ArchiveExtraction {
  files: ExtractedSourceFile[];
  skippedEntries: number;
}

export interface ArchiveParser {
  extract(fileName: string, bytes: Uint8Array): Promise<ArchiveExtraction>;
}

interface ArchiveQuota {
  declaredExpandedBytes: number;
  entryCount: number;
  expandedBytes: number;
  paths: Set<string>;
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
  fflate: FflateModule,
  bytes: Uint8Array,
  metadata: readonly ZipEntryMetadata[],
  quota: ArchiveQuota,
): Map<string, Uint8Array> {
  const expected = new Map(metadata.map((entry) => [safeArchivePath(entry.name), entry]));
  const extracted = new Map<string, Uint8Array>();
  let failure: Error | null = null;
  const unzip = new fflate.Unzip((file) => {
    if (failure) {
      return;
    }
    let safePath: string;
    try {
      safePath = safeArchivePath(file.name);
      const entry = expected.get(safePath);
      if (!entry) {
        throw new Error(`ZIP 項目與中央目錄不一致：${file.name}`);
      }
      if (entry.compression !== file.compression) {
        throw new Error(`ZIP 項目的壓縮資訊不一致：${file.name}`);
      }
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
        if (fileBytes > ARCHIVE_LIMITS.maxExpandedFileBytes) {
          failure = new Error(`ZIP 內單檔實際展開超過 25 MiB：${safePath}`);
          file.terminate();
          return;
        }
        if (quota.expandedBytes > ARCHIVE_LIMITS.maxExpandedTotalBytes) {
          failure = new Error("ZIP 實際展開內容累計超過 100 MiB。");
          file.terminate();
          return;
        }
        if (chunk.byteLength > 0) {
          chunks.push(chunk.slice());
        }
        if (final) {
          const value = new Uint8Array(fileBytes);
          let offset = 0;
          chunks.forEach((currentChunk) => {
            value.set(currentChunk, offset);
            offset += currentChunk.byteLength;
          });
          extracted.set(safePath, value);
        }
      };
      file.start();
    } catch (error) {
      failure = error instanceof Error ? error : new Error("無法安全解壓 ZIP。");
    }
  });
  unzip.register(fflate.UnzipInflate);
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
  fflate: FflateModule,
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
  const extracted = extractEntries(fflate, bytes, metadata, quota);
  const files: ExtractedSourceFile[] = [];
  let skippedEntries = metadata.filter((entry) => (
    !entry.isDirectory
    && detectSourceFileType(entry.name) === null
    && !entry.name.toLowerCase().endsWith(".zip")
  )).length;

  for (const [entryPath, entryBytes] of extracted) {
    const virtualPath = joinVirtualPath(rootPath, entryPath);
    if (entryPath.toLowerCase().endsWith(".zip")) {
      const entrySegments = entryPath.split("/");
      const nestedFileName = entrySegments.pop() ?? "archive.zip";
      const nested = await extractArchive(
        fflate,
        nestedFileName,
        entryBytes,
        joinVirtualPath(rootPath, ...entrySegments),
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
    files.push({ bytes: entryBytes, size: entryBytes.byteLength, virtualPath: path });
  }
  return { files, skippedEntries };
}

export function createArchiveParser(
  importer: ArchiveImporter = () => import("fflate"),
): ArchiveParser {
  let modulePromise: Promise<FflateModule> | null = null;

  function load(): Promise<FflateModule> {
    modulePromise ??= importer().catch((error: unknown) => {
      modulePromise = null;
      throw error;
    });
    return modulePromise;
  }

  return {
    async extract(fileName, bytes) {
      const fflate = await load();
      return extractArchive(fflate, fileName, bytes, "", 1, {
        declaredExpandedBytes: 0,
        entryCount: 0,
        expandedBytes: 0,
        paths: new Set<string>(),
      });
    },
  };
}
