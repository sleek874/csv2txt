export interface ZipEntryMetadata {
  compressedSize: number;
  compression: number;
  encrypted: boolean;
  flags: number;
  isDirectory: boolean;
  isSymlink: boolean;
  localHeaderOffset: number;
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

export interface SkippedArchiveEntry {
  relativePath: string;
  reason: ArchiveDiscardReason;
  virtualPath: string;
}

export type ArchiveDiscardReason =
  | "archive-depth"
  | "duplicate-path"
  | "encrypted"
  | "invalid-archive"
  | "invalid-file"
  | "symlink"
  | "too-large"
  | "unsafe-path"
  | "unsupported-compression"
  | "unsupported-type";

export type ArchiveVisit =
  | ({ candidateCount: number; kind: "file" } & ExtractedSourceFile)
  | ({ candidateCount: number; kind: "discarded" } & SkippedArchiveEntry)
  | { candidateCount: number; kind: "candidates"; virtualPath: string };

export interface ArchiveExtraction {
  files: ExtractedSourceFile[];
  skippedEntries: SkippedArchiveEntry[];
}

export interface ArchiveOutputEntry {
  createBytes: () => Promise<Uint8Array> | Uint8Array;
  path: string;
}

export type ArchiveOutputCompression = "deflate" | "store";

export interface ArchiveOutputOptions {
  compression?: ArchiveOutputCompression;
  isCancelled?: () => boolean;
  yieldAfterEntry?: () => Promise<void>;
}
