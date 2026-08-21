import assert from "node:assert/strict";
import test from "node:test";

import { strToU8, zipSync } from "fflate";
import * as iconv from "iconv-lite";

import { safeArchivePath } from "../src/core/archive/policy.ts";
import { extractZip, inspectZip, serializeZip } from "../src/core/archive/zip.ts";
import { exceedsFileSizeLimit, FILE_SIZE_LIMIT_BYTES } from "../src/core/file-size-policy.ts";

function replaceNameBytes(bytes, before, after) {
  assert.equal(before.length, after.length);
  const result = bytes.slice();
  for (let offset = 0; offset <= result.length - before.length; offset += 1) {
    if (before.every((byte, index) => result[offset + index] === byte)) {
      result.set(after, offset);
      offset += before.length - 1;
    }
  }
  return result;
}

function replaceDeclaredSizes(bytes, sizes) {
  const result = bytes.slice();
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  let sizeIndex = 0;
  for (let offset = 0; offset <= result.byteLength - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const size = sizes[sizeIndex];
    assert.notEqual(size, undefined);
    view.setUint32(offset + 24, size, true);
    sizeIndex += 1;
  }
  assert.equal(sizeIndex, sizes.length);
  return result;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function unicodePathExtra(rawName, unicodeName) {
  const encodedName = strToU8(unicodeName);
  const extra = new Uint8Array(5 + encodedName.length);
  extra[0] = 1;
  new DataView(extra.buffer).setUint32(1, crc32(rawName), true);
  extra.set(encodedName, 5);
  return extra;
}

test("validates safe ZIP paths without hiding traversal", () => {
  assert.equal(safeArchivePath("folder/data.csv"), "folder/data.csv");
  assert.equal(safeArchivePath("folder\\data.csv"), "folder/data.csv");
  assert.throws(() => safeArchivePath("../data.csv"), /路徑不安全/u);
  assert.throws(() => safeArchivePath("C:\\data.csv"), /路徑不安全/u);
  assert.throws(() => safeArchivePath("/data.csv"), /路徑不安全/u);
  assert.throws(() => safeArchivePath("a/b/c/d/e/f/g/h/i/j/k/data.csv"), /10 層/u);
});

test("inspects and extracts supported entries while preserving virtual paths", async () => {
  const bytes = zipSync({
    "folder/data.csv": strToU8("A,01"),
    "folder/notes.md": strToU8("skip"),
  });
  const metadata = inspectZip(bytes);
  assert.equal(metadata.length, 2);
  assert.equal(metadata[0]?.encrypted, false);
  assert.equal(metadata[0]?.isSymlink, false);
  assert.equal(metadata[0]?.utf8Flag, false);

  const extraction = await extractZip("batch.zip", bytes);
  assert.deepEqual(extraction.skippedEntries, [{
    relativePath: "folder/notes.md",
    reason: "unsupported-type",
    virtualPath: "batch/folder/notes.md",
  }]);
  assert.deepEqual(extraction.files.map((file) => file.virtualPath), ["batch/folder/data.csv"]);
  assert.deepEqual(extraction.files.map((file) => file.relativePath), ["folder/data.csv"]);
  assert.equal(new TextDecoder().decode(extraction.files[0]?.bytes), "A,01");
});

test("uses a valid Unicode Path field before legacy filename heuristics", async () => {
  const rawName = strToU8("legacy.csv");
  const bytes = zipSync({
    "legacy.csv": [strToU8("A,01"), { extra: { 0x7075: unicodePathExtra(rawName, "資料.csv") } }],
  });
  const metadata = inspectZip(bytes);
  assert.equal(metadata[0]?.name, "資料.csv");
  assert.equal(metadata[0]?.nameEncoding, "unicode-path");
  const extraction = await extractZip("batch.zip", bytes);
  assert.deepEqual(extraction.files.map((file) => file.virtualPath), ["batch/資料.csv"]);
});

test("recovers unmarked Traditional Chinese Windows filenames as CP950", async () => {
  const placeholder = strToU8("abcd.csv");
  const cp950Name = new Uint8Array(iconv.encode("資料.csv", "cp950"));
  const bytes = replaceNameBytes(zipSync({ "abcd.csv": strToU8("A,01") }), placeholder, cp950Name);
  const metadata = inspectZip(bytes);
  assert.equal(metadata[0]?.name, "資料.csv");
  assert.equal(metadata[0]?.nameEncoding, "cp950");
  assert.equal(metadata[0]?.nameWasHeuristic, true);
  assert.deepEqual(metadata[0]?.rawName, cp950Name);
  const extraction = await extractZip("batch.zip", bytes);
  assert.deepEqual(extraction.files.map((file) => file.virtualPath), ["batch/資料.csv"]);
});

test("falls back to CP437 for unmarked legacy names that are not valid CP950", async () => {
  const placeholder = strToU8("cafe.csv");
  const cp437Name = new Uint8Array(iconv.encode("café.csv", "cp437"));
  const bytes = replaceNameBytes(zipSync({ "cafe.csv": strToU8("A,01") }), placeholder, cp437Name);
  const metadata = inspectZip(bytes);
  assert.equal(metadata[0]?.name, "café.csv");
  assert.equal(metadata[0]?.nameEncoding, "cp437");
  assert.equal(metadata[0]?.nameWasHeuristic, true);
});

test("recursively extracts nested ZIP files into named virtual folders", async () => {
  const nested = zipSync({ "data.txt": strToU8("record") });
  const extraction = await extractZip("outer.zip", zipSync({ "incoming/nested.zip": nested }));
  assert.deepEqual(extraction.files.map((file) => file.virtualPath), ["outer/incoming/nested/data.txt"]);
});

test("applies the 100 MiB limit independently to each ZIP member", async () => {
  assert.equal(exceedsFileSizeLimit(FILE_SIZE_LIMIT_BYTES), false);
  assert.equal(exceedsFileSizeLimit(FILE_SIZE_LIMIT_BYTES + 1), true);

  const perEntrySize = 75 * 1024 * 1024;
  const bytes = replaceDeclaredSizes(zipSync({
    "first.csv": strToU8("A,01"),
    "second.csv": strToU8("B,02"),
  }), [perEntrySize, perEntrySize]);
  assert.deepEqual(inspectZip(bytes).map((entry) => entry.uncompressedSize), [perEntrySize, perEntrySize]);
  assert.equal((await extractZip("batch.zip", bytes)).files.length, 2, "member sizes are not accumulated");

  const oversized = replaceDeclaredSizes(
    zipSync({ "oversized.csv": strToU8("A,01") }),
    [FILE_SIZE_LIMIT_BYTES + 1],
  );
  await assert.rejects(extractZip("batch.zip", oversized), /單檔超過 100 MiB/u);
});

test("serializes and reopens safe output entries", async () => {
  const bytes = await serializeZip([
    { path: "folder/data.csv", bytes: strToU8("001,中文") },
    { path: "records.txt", bytes: strToU8("record") },
  ]);
  const extraction = await extractZip("result.zip", bytes);
  assert.deepEqual(extraction.files.map((file) => file.virtualPath), [
    "result/folder/data.csv",
    "result/records.txt",
  ]);
  assert.equal(new TextDecoder().decode(extraction.files[0]?.bytes), "001,中文");
});

test("rejects unsafe or colliding output paths", async () => {
  assert.throws(() => serializeZip([{ path: "../outside.csv", bytes: strToU8("unsafe") }]), /路徑不安全/u);
  assert.throws(() => serializeZip([
    { path: "data.csv", bytes: strToU8("one") },
    { path: "data.csv", bytes: strToU8("two") },
  ]), /路徑碰撞/u);
});

test("rejects an archive with a tampered encrypted flag", () => {
  const bytes = zipSync({ "data.csv": strToU8("A,01") }).slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      view.setUint16(offset + 8, view.getUint16(offset + 8, true) | 1, true);
      break;
    }
  }
  assert.equal(inspectZip(bytes)[0]?.encrypted, true);
});

test("safely skips symbolic links and unsupported extensions while keeping supported files", async () => {
  const bytes = zipSync({
    "accepted/data.csv": strToU8("A,01"),
    "excluded/notes.md": strToU8("not a source file"),
    "excluded/link.csv": [
      strToU8("../accepted/data.csv"),
      { attrs: 0o120777 << 16, os: 3 },
    ],
  });
  const metadata = inspectZip(bytes);
  assert.equal(metadata.find((entry) => entry.name === "excluded/link.csv")?.isSymlink, true);

  const extraction = await extractZip("excluded-entries.zip", bytes);
  assert.deepEqual(extraction.files.map((file) => file.virtualPath), [
    "excluded-entries/accepted/data.csv",
  ]);
  assert.deepEqual(extraction.skippedEntries, [
    {
      relativePath: "excluded/notes.md",
      reason: "unsupported-type",
      virtualPath: "excluded-entries/excluded/notes.md",
    },
    {
      relativePath: "excluded/link.csv",
      reason: "symlink",
      virtualPath: "excluded-entries/excluded/link.csv",
    },
  ]);
});
