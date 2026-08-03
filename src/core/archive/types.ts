export interface ZipEntryMetadata {
  compressedSize: number;
  compression: number;
  encrypted: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  libraryName: string;
  name: string;
  nameEncoding: "utf-8" | "unicode-path" | "ascii" | "cp950" | "cp437";
  nameWasHeuristic: boolean;
  rawName: Uint8Array;
  uncompressedSize: number;
  utf8Flag: boolean;
}

export interface ExtractedSourceFile {
  bytes: Uint8Array;
  relativePath: string;
  size: number;
  virtualPath: string;
}

export interface ArchiveExtraction {
  files: ExtractedSourceFile[];
  skippedEntries: number;
}

export interface ArchiveOutputEntry {
  bytes: Uint8Array;
  path: string;
}
