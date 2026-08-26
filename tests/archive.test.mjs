import assert from "node:assert/strict";
import test from "node:test";

import { strToU8, zipSync } from "fflate";
import * as iconv from "iconv-lite";

import { safeArchivePath } from "../src/core/archive/policy.ts";
import { extractZip, inspectZip, serializeZip, walkZip } from "../src/core/archive/zip.ts";
import { ARCHIVE_LIMITS } from "../src/core/archive/policy.ts";
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

async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

function markAsZip64(bytes) {
  const result = bytes.slice();
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  for (let offset = result.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    view.setUint16(offset + 8, 0xffff, true);
    view.setUint16(offset + 10, 0xffff, true);
    return result;
  }
  throw new Error("test ZIP has no end record");
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
  const oversizedExtraction = await extractZip("batch.zip", oversized);
  assert.deepEqual(oversizedExtraction.files, []);
  assert.deepEqual(oversizedExtraction.skippedEntries.map((entry) => entry.reason), ["too-large"]);
});

test("walks entries lazily and enters nested ZIPs before later siblings", async () => {
  const bytes = zipSync({
    "folder/": new Uint8Array(0),
    "first.csv": strToU8("A,01"),
    "nested.zip": zipSync({ "inside.txt": strToU8("record") }),
    "last.csv": strToU8("B,02"),
  });
  const iterator = walkZip("batch.zip", bytes);

  const discovered = await iterator.next();
  assert.equal(discovered.value?.kind, "candidates");
  assert.equal(discovered.value?.candidateCount, 2);

  const first = await iterator.next();
  assert.equal(first.value?.kind, "file");
  assert.equal(first.value?.virtualPath, "batch/first.csv");
  assert.equal(first.value?.candidateCount, 2, "direct leaf candidates are known before processing");

  const nestedDiscovered = await iterator.next();
  assert.equal(nestedDiscovered.value?.kind, "candidates");
  assert.equal(nestedDiscovered.value?.candidateCount, 3);

  const second = await iterator.next();
  assert.equal(second.value?.kind, "file");
  assert.equal(second.value?.virtualPath, "batch/nested/inside.txt");
  assert.equal(second.value?.candidateCount, 3, "nested leaf candidates are added when discovered");

  const third = await iterator.next();
  assert.equal(third.value?.kind, "file");
  assert.equal(third.value?.virtualPath, "batch/last.csv");
  assert.equal(third.value?.candidateCount, 3);
});

test("does not inspect a later nested payload before it is requested", async () => {
  const iterator = walkZip("batch.zip", zipSync({
    "first.csv": strToU8("A,01"),
    "broken.zip": strToU8("not a zip"),
  }));

  const discovered = await iterator.next();
  assert.equal(discovered.value?.kind, "candidates");
  assert.equal(discovered.value?.candidateCount, 1);

  const first = await iterator.next();
  assert.equal(first.value?.kind, "file");
  assert.equal(first.value?.virtualPath, "batch/first.csv");
  assert.equal(first.value?.candidateCount, 1);

  const second = await iterator.next();
  assert.equal(second.value?.kind, "discarded");
  assert.equal(second.value?.reason, "invalid-archive");
  assert.equal(second.value?.virtualPath, "batch/broken.zip");
  assert.equal(second.value?.candidateCount, 1, "an invalid ZIP container is not a parser candidate");
});

test("keeps unsupported nested ZIP64 containers source-fatal", async () => {
  const nested = markAsZip64(zipSync({ "inside.csv": strToU8("A,01") }));
  await assert.rejects(
    extractZip("batch.zip", zipSync({ "good.csv": strToU8("B,02"), "nested.zip": nested })),
    /ZIP64/u,
  );
});

test("serializes and reopens safe output entries", async () => {
  const bytes = await blobBytes(await serializeZip([
    { path: "folder/data.csv", createBytes: () => strToU8("001,中文") },
    { path: "records.txt", createBytes: () => strToU8("record") },
  ]));
  const extraction = await extractZip("result.zip", bytes);
  assert.deepEqual(extraction.files.map((file) => file.virtualPath), [
    "result/folder/data.csv",
    "result/records.txt",
  ]);
  assert.equal(new TextDecoder().decode(extraction.files[0]?.bytes), "001,中文");
  assert.deepEqual(inspectZip(bytes).map((entry) => entry.compression), [8, 8]);

  const stored = await blobBytes(await serializeZip([
    { path: "book.xlsx", createBytes: () => strToU8("already-compressed") },
  ], { compression: "store" }));
  assert.equal(inspectZip(stored)[0]?.compression, 0);
});

test("rejects unsafe or colliding output paths", async () => {
  await assert.rejects(serializeZip([{ path: "../outside.csv", createBytes: () => strToU8("unsafe") }]), /路徑不安全/u);
  await assert.rejects(serializeZip([
    { path: "data.csv", createBytes: () => strToU8("one") },
    { path: "data.csv", createBytes: () => strToU8("two") },
  ]), /路徑碰撞/u);
});

test("uses the shared 5000-entry, 100 MiB entry, and 500 MiB output policy", () => {
  assert.equal(ARCHIVE_LIMITS.maxOutputEntries, 5_000);
  assert.equal(ARCHIVE_LIMITS.maxOutputEntryBytes, 100 * 1024 * 1024);
  assert.equal(ARCHIVE_LIMITS.maxOutputBytes, 500 * 1024 * 1024);
  assert.equal("maxOutputSourceBytes" in ARCHIVE_LIMITS, false);
});

test("creates and yields output entries sequentially", async () => {
  const events = [];
  const blob = await serializeZip([
    { path: "one.csv", createBytes: () => { events.push("one"); return strToU8("one"); } },
    { path: "two.csv", createBytes: () => { events.push("two"); return strToU8("two"); } },
  ], {
    yieldAfterEntry: async () => { events.push("yield"); },
  });
  assert.deepEqual(events, ["one", "yield", "two", "yield"]);
  assert.deepEqual(inspectZip(await blobBytes(blob)).map((entry) => entry.name), ["one.csv", "two.csv"]);
});

test("stops a ZIP between entries after the workspace changes", async () => {
  const entries = [];
  let cancelled = false;
  await assert.rejects(serializeZip([
    { path: "one.csv", createBytes: () => { entries.push("one"); return strToU8("one"); } },
    { path: "two.csv", createBytes: () => { entries.push("two"); return strToU8("two"); } },
  ], {
    isCancelled: () => cancelled,
    yieldAfterEntry: async () => { cancelled = true; },
  }), /已取消建立下載/u);
  assert.deepEqual(entries, ["one"]);
});

test("records an encrypted member without extracting it", async () => {
  const bytes = zipSync({ "data.csv": strToU8("A,01") }).slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      view.setUint16(offset + 8, view.getUint16(offset + 8, true) | 1, true);
      break;
    }
  }
  assert.equal(inspectZip(bytes)[0]?.encrypted, true);
  const extraction = await extractZip("batch.zip", bytes);
  assert.deepEqual(extraction.files, []);
  assert.deepEqual(extraction.skippedEntries.map((entry) => entry.reason), ["encrypted"]);
});

test("records unsafe and duplicate member paths while keeping safe siblings", async () => {
  const unsafe = replaceNameBytes(
    zipSync({ "safe.csv": strToU8("A,01"), "good.csv": strToU8("B,02") }),
    strToU8("safe.csv"),
    strToU8("../a.csv"),
  );
  const unsafeExtraction = await extractZip("batch.zip", unsafe);
  assert.deepEqual(unsafeExtraction.files.map((file) => file.virtualPath), ["batch/good.csv"]);
  assert.deepEqual(unsafeExtraction.skippedEntries.map((entry) => entry.reason), ["unsafe-path"]);

  const duplicate = replaceNameBytes(
    zipSync({ "a.csv": strToU8("A,01"), "b.csv": strToU8("B,02") }),
    strToU8("b.csv"),
    strToU8("a.csv"),
  );
  const duplicateExtraction = await extractZip("batch.zip", duplicate);
  assert.equal(duplicateExtraction.files.length, 1);
  assert.deepEqual(duplicateExtraction.skippedEntries.map((entry) => entry.reason), ["duplicate-path"]);
  const duplicateVisits = [];
  for await (const visit of walkZip("batch.zip", duplicate)) duplicateVisits.push(visit);
  assert.equal(duplicateVisits[0]?.candidateCount, 2);
  assert.equal(duplicateVisits.at(-1)?.candidateCount, 1, "a duplicate is removed from parser candidates");
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
  const visits = [];
  for await (const visit of walkZip("excluded-entries.zip", bytes)) visits.push(visit);
  assert.ok(visits.every((visit) => visit.candidateCount === 1));
});
