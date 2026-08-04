import { big5eCodePoint, big5eEncodedCode } from "./big5e-mapping";

type DetectedEncoding = "utf-8" | "utf-16le" | "utf-16be" | "big5e";

export interface DecodedSource {
  text: string;
  encoding: DetectedEncoding;
  label: string;
  ambiguous: boolean;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
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

export function decodeBig5E(bytes: Uint8Array): string {
  let decoded = "";
  for (let index = 0; index < bytes.length; index += 1) {
    const first = bytes[index];
    if (first === undefined) break;
    if (first < 0x80) {
      decoded += String.fromCodePoint(first);
      continue;
    }

    const second = bytes[index + 1];
    const codePoint = second === undefined
      ? undefined
      : big5eCodePoint((first << 8) | second);
    if (codePoint === undefined) {
      throw new Error("檔案含有無法依臺灣政府 BIG-5E 對照表解讀的位元組。");
    }
    decoded += String.fromCodePoint(codePoint);
    index += 1;
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
    case "big5e":
      return decodeBig5E(bytes);
  }
}

export function decodeSource(bytes: Uint8Array): DecodedSource {
  if (bytes.length === 0) {
    throw new Error("檔案是空的，請選擇含有資料的 CSV 檔案。");
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
    // Continue with the conservative UTF-16 and BIG-5E fallbacks.
  }

  const hintedUtf16 = utf16Hint(bytes);
  if (hintedUtf16) {
    return {
      text: decodeDetected(bytes, hintedUtf16),
      encoding: hintedUtf16,
      label: `${hintedUtf16 === "utf-16le" ? "UTF-16LE" : "UTF-16BE"}（推測）`,
      ambiguous: true,
    };
  }

  return {
    text: decodeDetected(bytes, "big5e"),
    encoding: "big5e",
    label: "臺灣政府 BIG-5E（自動判斷）",
    ambiguous: false,
  };
}

export function encodeBig5E(value: string): Uint8Array | null {
  const encoded = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return null;
    if (codePoint < 0x80) {
      encoded.push(codePoint);
      continue;
    }

    const encodedCode = big5eEncodedCode(codePoint);
    if (encodedCode === undefined) return null;
    encoded.push(encodedCode >> 8, encodedCode & 0xff);
  }
  return new Uint8Array(encoded);
}

export interface UnencodableBig5ECharacter {
  character: string;
  codePoint: number;
}

export const UNRECOGNIZED_CHARACTER = "■";

export function unencodableBig5ECharacters(value: string): UnencodableBig5ECharacter[] {
  const characters = new Map<number, string>();
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 0x80 || big5eEncodedCode(codePoint) !== undefined) {
      continue;
    }
    characters.set(codePoint, character);
  }
  return [...characters].map(([codePoint, character]) => ({ character, codePoint }));
}

export function isPrivateUseCodePoint(codePoint: number): boolean {
  return (codePoint >= 0xe000 && codePoint <= 0xf8ff)
    || (codePoint >= 0xf0000 && codePoint <= 0xffffd)
    || (codePoint >= 0x100000 && codePoint <= 0x10fffd);
}

export function privateUseCodePoints(value: string): number[] {
  return [...new Set(
    [...value]
      .map((character) => character.codePointAt(0))
      .filter((codePoint): codePoint is number => codePoint !== undefined && isPrivateUseCodePoint(codePoint)),
  )];
}
