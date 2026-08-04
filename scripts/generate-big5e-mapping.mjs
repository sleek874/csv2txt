import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { unzipSync } from "fflate";

const SOURCE_URL = "https://www.cns11643.gov.tw/opendata/MapingTables.zip";
const SOURCE_VERSION = "20260505";
const SOURCE_SHA256 = "f59dacc4dbdef334d7a887c3da671af02778e2c80adb2a7fd1053f64dbf9e659";
const OUTPUT_PATH = fileURLToPath(new URL("../src/core/big5e-mapping.ts", import.meta.url));
const RECOVERY_OUTPUT_PATH = fileURLToPath(new URL("../src/core/private-use-recovery-mapping.ts", import.meta.url));

const EXACT_TABLES = [
  ["Big5/CNS2BIG5.txt", 13_051],
  ["Big5/CNS2BIG5_Big5E.txt", 3_954],
];
const AUXILIARY_TABLE_COUNTS = [442, 7];
const UNICODE_TABLES = [
  "Unicode/CNS2UNICODE_Unicode BMP.txt",
  "Unicode/CNS2UNICODE_Unicode 2.txt",
  "Unicode/CNS2UNICODE_Unicode 3.txt",
  "Unicode/CNS2UNICODE_Unicode 15.txt",
];
const LEGACY_TABLES = ["CNS2DCI.txt", "CNS2FIN.txt", "CNS2INC.txt", "CNS2TAX.txt"];
const LAND_DIRECTORY_LATIN1 = String.fromCharCode(0xa6, 0x61, 0xac, 0x46, 0x2f);

function parseRows(bytes) {
  return new TextDecoder().decode(bytes)
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.split(/\s+/u));
}

async function sourceArchive() {
  const suppliedPath = process.argv[2];
  if (suppliedPath) return new Uint8Array(readFileSync(suppliedPath));

  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`下載官方對照表失敗：HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function wrapBase64(value) {
  return value.match(/.{1,100}/gu)?.map((line) => `  "${line}"`).join("\n  + ") ?? "  \"\"";
}

function standardTrailByte(index) {
  return index < 63 ? 0x40 + index : 0xa1 + index - 63;
}

function standardRangeCode(offset, firstLead) {
  return ((firstLead + Math.floor(offset / 157)) << 8) | standardTrailByte(offset % 157);
}

function cp950EudcCode(codePoint) {
  if (codePoint >= 0xe000 && codePoint <= 0xe310) {
    return standardRangeCode(codePoint - 0xe000, 0xfa);
  }
  if (codePoint >= 0xe311 && codePoint <= 0xeeb7) {
    return standardRangeCode(codePoint - 0xe311, 0x8e);
  }
  if (codePoint >= 0xeeb8 && codePoint <= 0xf6b0) {
    return standardRangeCode(codePoint - 0xeeb8, 0x81);
  }
  if (codePoint >= 0xf6b1 && codePoint <= 0xf848) {
    const offset = codePoint - 0xf6b1;
    if (offset < 94) return (0xc6 << 8) | (0xa1 + offset);
    return standardRangeCode(offset - 94, 0xc7);
  }
  return undefined;
}

function isPrivateUseCodePoint(codePoint) {
  return (codePoint >= 0xe000 && codePoint <= 0xf8ff)
    || (codePoint >= 0xf0000 && codePoint <= 0xffffd)
    || (codePoint >= 0x100000 && codePoint <= 0x10fffd);
}

function isLandTablePath(path) {
  // This pinned archive stores 地政/ filenames as Big5 bytes without the ZIP UTF-8 flag.
  // fflate preserves those bytes as Latin-1 code units, so accept both archive forms.
  return (path.startsWith("地政/") || path.startsWith(LAND_DIRECTORY_LATIN1))
    && path.endsWith(".txt");
}

const archive = await sourceArchive();
assert.equal(
  createHash("sha256").update(archive).digest("hex"),
  SOURCE_SHA256,
  "官方對照表壓縮檔與固定的 SHA-256 不符",
);

const extracted = unzipSync(archive);
const tables = [...EXACT_TABLES];
const exactPaths = new Set(EXACT_TABLES.map(([path]) => path));
const auxiliaryCandidates = Object.entries(extracted)
  .filter(([path]) => path.startsWith("Big5/CNS2BIG5_") && !exactPaths.has(path))
  .map(([path, bytes]) => [path, parseRows(bytes).length]);
for (const expectedCount of AUXILIARY_TABLE_COUNTS) {
  const matches = auxiliaryCandidates.filter(([, count]) => count === expectedCount);
  assert.equal(matches.length, 1, `找不到筆數為 ${expectedCount} 的 Big5 輔助對照表`);
  tables.push(matches[0]);
}

const unicodeByCns = new Map();
for (const path of UNICODE_TABLES) {
  const bytes = extracted[path];
  assert.ok(bytes, `官方壓縮檔缺少 ${path}`);
  for (const [cns, unicode] of parseRows(bytes)) {
    assert.ok(cns && unicode, `${path} 含有不完整資料列`);
    assert.equal(unicodeByCns.has(cns), false, `CNS ${cns} 有重複 Unicode 對照`);
    unicodeByCns.set(cns, Number.parseInt(unicode, 16));
  }
}

const entries = [];
const encodedCodes = new Set();
const unicodeCodePoints = new Set();
for (const [path, expectedCount] of tables) {
  const bytes = extracted[path];
  assert.ok(bytes, `官方壓縮檔缺少 ${path}`);
  const rows = parseRows(bytes);
  assert.equal(rows.length, expectedCount, `${path} 筆數與固定版本不符`);

  for (const [cns, encoded] of rows) {
    assert.ok(cns && encoded, `${path} 含有不完整資料列`);
    const encodedCode = Number.parseInt(encoded, 16);
    const unicodeCodePoint = unicodeByCns.get(cns);
    assert.ok(unicodeCodePoint !== undefined, `CNS ${cns} 沒有 Unicode 對照`);
    assert.equal(encodedCodes.has(encodedCode), false, `BIG-5E ${encoded} 有重複對照`);
    assert.equal(unicodeCodePoints.has(unicodeCodePoint), false, `U+${unicodeCodePoint.toString(16)} 有重複對照`);
    encodedCodes.add(encodedCode);
    unicodeCodePoints.add(unicodeCodePoint);
    entries.push([encodedCode, unicodeCodePoint]);
  }
}
entries.sort(([left], [right]) => left - right);

const preferredUnicodeByEncoded = new Map(entries);
const legacyCandidatesByEncoded = new Map();
const landPaths = Object.keys(extracted).filter(isLandTablePath);
assert.equal(landPaths.length, 25, "官方壓縮檔的地政對照表數量不符");
const legacyPaths = [
  ...LEGACY_TABLES,
  ...landPaths,
];
for (const path of legacyPaths) {
  const bytes = extracted[path];
  assert.ok(bytes, `官方壓縮檔缺少 ${path}`);
  for (const [cns, legacyCode] of parseRows(bytes)) {
    if (!cns || !legacyCode || !/^[0-9A-F]{4}$/u.test(legacyCode)) continue;
    const unicodeCodePoint = unicodeByCns.get(cns);
    if (unicodeCodePoint === undefined || isPrivateUseCodePoint(unicodeCodePoint)) continue;
    const encoded = Number.parseInt(legacyCode, 16);
    const candidates = legacyCandidatesByEncoded.get(encoded) ?? new Set();
    candidates.add(unicodeCodePoint);
    legacyCandidatesByEncoded.set(encoded, candidates);
  }
}

const recoveryEntries = [];
for (let privateUse = 0xe000; privateUse <= 0xf848; privateUse += 1) {
  const encoded = cp950EudcCode(privateUse);
  if (encoded === undefined) continue;
  const preferred = preferredUnicodeByEncoded.get(encoded);
  if (preferred !== undefined) {
    recoveryEntries.push([privateUse, preferred]);
    continue;
  }
  const candidates = legacyCandidatesByEncoded.get(encoded);
  if (candidates?.size === 1) {
    recoveryEntries.push([privateUse, [...candidates][0]]);
  }
}

const packed = new Uint8Array(entries.length * 5);
entries.forEach(([encoded, unicode], index) => {
  const offset = index * 5;
  packed[offset] = encoded >> 8;
  packed[offset + 1] = encoded & 0xff;
  packed[offset + 2] = unicode >> 16;
  packed[offset + 3] = (unicode >> 8) & 0xff;
  packed[offset + 4] = unicode & 0xff;
});
const base64 = Buffer.from(packed).toString("base64");

const output = `// Generated by scripts/generate-big5e-mapping.mjs. Do not edit by hand.
// Source: Ministry of Digital Affairs, CNS11643 full character set.
// Licensed under Taiwan Government Open Data License 1.0.

export const BIG5E_MAPPING_PROVENANCE = {
  entryCount: ${entries.length},
  sourceUrl: "${SOURCE_URL}",
  sourceVersion: "${SOURCE_VERSION}",
  sourceSha256: "${SOURCE_SHA256}",
} as const;

const PACKED_BIG5E_MAPPING_BASE64 =
${wrapBase64(base64)};

function unpackBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

const unicodeByEncoded = new Map<number, number>();
const encodedByUnicode = new Map<number, number>();
const packedMapping = unpackBase64(PACKED_BIG5E_MAPPING_BASE64);

if (packedMapping.length !== BIG5E_MAPPING_PROVENANCE.entryCount * 5) {
  throw new Error("BIG-5E 對照表資料不完整。");
}

for (let offset = 0; offset < packedMapping.length; offset += 5) {
  const encoded = ((packedMapping[offset] ?? 0) << 8) | (packedMapping[offset + 1] ?? 0);
  const unicode = ((packedMapping[offset + 2] ?? 0) << 16)
    | ((packedMapping[offset + 3] ?? 0) << 8)
    | (packedMapping[offset + 4] ?? 0);
  unicodeByEncoded.set(encoded, unicode);
  encodedByUnicode.set(unicode, encoded);
}

export function big5eCodePoint(encoded: number): number | undefined {
  return unicodeByEncoded.get(encoded);
}

export function big5eEncodedCode(unicode: number): number | undefined {
  return encodedByUnicode.get(unicode);
}
`;

writeFileSync(OUTPUT_PATH, output, "utf8");
const packedRecovery = new Uint8Array(recoveryEntries.length * 5);
recoveryEntries.forEach(([privateUse, unicode], index) => {
  const offset = index * 5;
  packedRecovery[offset] = privateUse >> 8;
  packedRecovery[offset + 1] = privateUse & 0xff;
  packedRecovery[offset + 2] = unicode >> 16;
  packedRecovery[offset + 3] = (unicode >> 8) & 0xff;
  packedRecovery[offset + 4] = unicode & 0xff;
});
const recoveryBase64 = Buffer.from(packedRecovery).toString("base64");
const recoveryOutput = `// Generated by scripts/generate-big5e-mapping.mjs. Do not edit by hand.
// Source: Ministry of Digital Affairs, CNS11643 full character set.
// Licensed under Taiwan Government Open Data License 1.0.

export const PRIVATE_USE_RECOVERY_PROVENANCE = {
  entryCount: ${recoveryEntries.length},
  sourceUrl: "${SOURCE_URL}",
  sourceVersion: "${SOURCE_VERSION}",
  sourceSha256: "${SOURCE_SHA256}",
} as const;

const PACKED_PRIVATE_USE_RECOVERY_BASE64 =
${wrapBase64(recoveryBase64)};

function unpackBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

const unicodeByPrivateUse = new Map<number, number>();
const packedMapping = unpackBase64(PACKED_PRIVATE_USE_RECOVERY_BASE64);
if (packedMapping.length !== PRIVATE_USE_RECOVERY_PROVENANCE.entryCount * 5) {
  throw new Error("舊系統字元還原表資料不完整。");
}
for (let offset = 0; offset < packedMapping.length; offset += 5) {
  const privateUse = ((packedMapping[offset] ?? 0) << 8) | (packedMapping[offset + 1] ?? 0);
  const unicode = ((packedMapping[offset + 2] ?? 0) << 16)
    | ((packedMapping[offset + 3] ?? 0) << 8)
    | (packedMapping[offset + 4] ?? 0);
  unicodeByPrivateUse.set(privateUse, unicode);
}

export function recoveredUnicodeCodePoint(privateUse: number): number | undefined {
  return unicodeByPrivateUse.get(privateUse);
}
`;
writeFileSync(RECOVERY_OUTPUT_PATH, recoveryOutput, "utf8");
console.log(`Generated ${entries.length} official BIG-5E mappings and ${recoveryEntries.length} PUA recoveries.`);
