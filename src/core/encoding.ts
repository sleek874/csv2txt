import * as iconv from "iconv-lite";

import type {
  DetectedEncoding,
  SourceEncodingPreference,
} from "./types";

export interface DecodedSource {
  text: string;
  encoding: DetectedEncoding;
  label: string;
  ambiguous: boolean;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function strictUnicodeDecode(
  bytes: Uint8Array,
  encoding: "utf-8" | "utf-16le" | "utf-16be",
): string {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`檔案不是有效的 ${encoding.toUpperCase()} 編碼。`);
  }
}

function strictBig5Decode(bytes: Uint8Array): string {
  const decoded = iconv.decode(bytes, "big5");
  const encoded = new Uint8Array(iconv.encode(decoded, "big5"));

  if (decoded.includes("\uFFFD") || !equalBytes(encoded, bytes)) {
    throw new Error("檔案含有無法安全解讀的 Big5 位元組。");
  }

  return decoded;
}

function utf16Hint(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  const sampleLength = Math.min(bytes.length - (bytes.length % 2), 4096);
  if (sampleLength < 4) {
    return null;
  }

  let evenZeros = 0;
  let oddZeros = 0;
  const pairs = sampleLength / 2;

  for (let index = 0; index < sampleLength; index += 2) {
    if (bytes[index] === 0) {
      evenZeros += 1;
    }
    if (bytes[index + 1] === 0) {
      oddZeros += 1;
    }
  }

  if (oddZeros / pairs > 0.2 && evenZeros / pairs < 0.05) {
    return "utf-16le";
  }
  if (evenZeros / pairs > 0.2 && oddZeros / pairs < 0.05) {
    return "utf-16be";
  }
  return null;
}

function decodeDetected(bytes: Uint8Array, encoding: DetectedEncoding): string {
  switch (encoding) {
    case "utf-8":
      return strictUnicodeDecode(startsWith(bytes, [0xef, 0xbb, 0xbf]) ? bytes.subarray(3) : bytes, "utf-8");
    case "utf-16le":
      return strictUnicodeDecode(startsWith(bytes, [0xff, 0xfe]) ? bytes.subarray(2) : bytes, "utf-16le");
    case "utf-16be":
      return strictUnicodeDecode(startsWith(bytes, [0xfe, 0xff]) ? bytes.subarray(2) : bytes, "utf-16be");
    case "big5":
      return strictBig5Decode(bytes);
  }
}

export function decodeSource(
  bytes: Uint8Array,
  preference: SourceEncodingPreference,
): DecodedSource {
  if (bytes.length === 0) {
    throw new Error("檔案是空的，請選擇含有資料的 CSV 檔案。");
  }

  if (preference === "utf-8") {
    return {
      text: decodeDetected(bytes, "utf-8"),
      encoding: "utf-8",
      label: "UTF-8（手動指定）",
      ambiguous: false,
    };
  }

  if (preference === "big5") {
    return {
      text: decodeDetected(bytes, "big5"),
      encoding: "big5",
      label: "Big5（手動指定）",
      ambiguous: false,
    };
  }

  if (preference === "utf-16") {
    const encoding = startsWith(bytes, [0xfe, 0xff])
      ? "utf-16be"
      : startsWith(bytes, [0xff, 0xfe])
        ? "utf-16le"
        : utf16Hint(bytes);

    if (!encoding) {
      throw new Error("UTF-16 檔案缺少 BOM，且無法安全判斷位元組順序。");
    }

    return {
      text: decodeDetected(bytes, encoding),
      encoding,
      label: `${encoding === "utf-16le" ? "UTF-16LE" : "UTF-16BE"}（手動指定）`,
      ambiguous: !startsWith(bytes, [0xff, 0xfe]) && !startsWith(bytes, [0xfe, 0xff]),
    };
  }

  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) {
    return {
      text: decodeDetected(bytes, "utf-8"),
      encoding: "utf-8",
      label: "UTF-8（偵測到 BOM）",
      ambiguous: false,
    };
  }

  if (startsWith(bytes, [0xff, 0xfe])) {
    return {
      text: decodeDetected(bytes, "utf-16le"),
      encoding: "utf-16le",
      label: "UTF-16LE（偵測到 BOM）",
      ambiguous: false,
    };
  }

  if (startsWith(bytes, [0xfe, 0xff])) {
    return {
      text: decodeDetected(bytes, "utf-16be"),
      encoding: "utf-16be",
      label: "UTF-16BE（偵測到 BOM）",
      ambiguous: false,
    };
  }

  try {
    const text = decodeDetected(bytes, "utf-8");
    const asciiOnly = bytes.every((byte) => byte < 0x80);
    return {
      text,
      encoding: "utf-8",
      label: asciiOnly ? "純 ASCII（按 UTF-8 解讀）" : "UTF-8（自動判斷）",
      ambiguous: asciiOnly,
    };
  } catch {
    // Continue with the conservative UTF-16 and Big5 fallbacks.
  }

  const hintedUtf16 = utf16Hint(bytes);
  if (hintedUtf16) {
    return {
      text: decodeDetected(bytes, hintedUtf16),
      encoding: hintedUtf16,
      label: `${hintedUtf16 === "utf-16le" ? "UTF-16LE" : "UTF-16BE"}（推測，請確認預覽）`,
      ambiguous: true,
    };
  }

  return {
    text: decodeDetected(bytes, "big5"),
    encoding: "big5",
    label: "Big5（自動判斷）",
    ambiguous: false,
  };
}

export function encodeBig5(value: string): Uint8Array | null {
  const encoded = new Uint8Array(iconv.encode(value, "big5"));
  return iconv.decode(encoded, "big5") === value ? encoded : null;
}
