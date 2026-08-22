import { big5eCodePoint, big5eEncodedCode } from "./big5e-mapping";

type DetectedEncoding = "utf-8" | "utf-16le" | "utf-16be" | "big5e";

export interface DecodedSource {
  text: string;
  encoding: DetectedEncoding;
  label: string;
  ambiguous: boolean;
}

export interface UnrecognizedBig5EBytes {
  bytes: readonly number[];
  characterIndex: number;
  offset: number;
}

export interface PartialBig5EDecode {
  text: string;
  unrecognized: readonly UnrecognizedBig5EBytes[];
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

export const UNKNOWN_CHARACTER = "？";
export const UNRECOGNIZED_CHARACTER = "■";

function isBig5Trail(byte: number): boolean {
  return (byte >= 0x40 && byte <= 0x7e) || (byte >= 0xa1 && byte <= 0xfe);
}

function isBig5Lead(byte: number): boolean {
  return byte >= 0x81 && byte <= 0xfe;
}

export function decodeBig5EPartially(bytes: Uint8Array): PartialBig5EDecode {
  let decoded = "";
  let characterCount = 0;
  const unrecognized: { bytes: number[]; characterIndex: number; offset: number }[] = [];

  function appendUnrecognized(offset: number, values: readonly number[]): void {
    const previous = unrecognized.at(-1);
    if (previous && previous.offset + previous.bytes.length === offset) {
      previous.bytes.push(...values);
      return;
    }
    decoded += UNKNOWN_CHARACTER;
    unrecognized.push({ bytes: [...values], characterIndex: characterCount, offset });
    characterCount += 1;
  }

  for (let index = 0; index < bytes.length; index += 1) {
    const first = bytes[index];
    if (first === undefined) break;
    if (first < 0x80) {
      decoded += String.fromCodePoint(first);
      characterCount += 1;
      continue;
    }

    const second = bytes[index + 1];
    const pairLength = isBig5Lead(first) && second !== undefined && isBig5Trail(second) ? 2 : 1;
    const codePoint = pairLength === 2 ? big5eCodePoint((first << 8) | (second ?? 0)) : undefined;
    if (codePoint === undefined) {
      appendUnrecognized(index, [...bytes.subarray(index, index + pairLength)]);
      index += pairLength - 1;
      continue;
    }
    decoded += String.fromCodePoint(codePoint);
    characterCount += 1;
    index += 1;
  }
  return { text: decoded, unrecognized };
}

export function decodeBig5E(bytes: Uint8Array): string {
  const decoded = decodeBig5EPartially(bytes);
  if (decoded.unrecognized.length > 0) {
    throw new Error("檔案含有無法依臺灣政府 BIG-5E 對照表解讀的位元組。");
  }
  return decoded.text;
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

export interface Big5EEncodeResult {
  bytes: Uint8Array;
  substitutions: readonly (UnencodableBig5ECharacter & { characterIndex: number })[];
}

export function encodeBig5EWithReplacement(value: string): Big5EEncodeResult {
  const replacement = big5eEncodedCode(UNKNOWN_CHARACTER.codePointAt(0) ?? 0);
  if (replacement === undefined) {
    throw new Error("BIG-5E 對照表缺少全形問號。");
  }
  const encoded: number[] = [];
  const substitutions: (UnencodableBig5ECharacter & { characterIndex: number })[] = [];
  [...value].forEach((character, characterIndex) => {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return;
    if (codePoint < 0x80) {
      encoded.push(codePoint);
      return;
    }
    const encodedCode = big5eEncodedCode(codePoint);
    if (encodedCode === undefined) {
      encoded.push(replacement >> 8, replacement & 0xff);
      substitutions.push({ character, characterIndex, codePoint });
      return;
    }
    encoded.push(encodedCode >> 8, encodedCode & 0xff);
  });
  return { bytes: new Uint8Array(encoded), substitutions };
}

export interface UnencodableBig5ECharacter {
  character: string;
  codePoint: number;
}

export function isPrivateUseCodePoint(codePoint: number): boolean {
  return (codePoint >= 0xe000 && codePoint <= 0xf8ff)
    || (codePoint >= 0xf0000 && codePoint <= 0xffffd)
    || (codePoint >= 0x100000 && codePoint <= 0x10fffd);
}

export function containsPrivateUseCodePoint(value: string): boolean {
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) return false;
    if (isPrivateUseCodePoint(codePoint)) return true;
    index += codePoint > 0xffff ? 2 : 1;
  }
  return false;
}

export function privateUseCodePoints(value: string): number[] {
  const result: number[] = [];
  const seen = new Set<number>();
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && isPrivateUseCodePoint(codePoint) && !seen.has(codePoint)) {
      seen.add(codePoint);
      result.push(codePoint);
    }
  }
  return result;
}
