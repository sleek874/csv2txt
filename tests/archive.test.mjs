import assert from "node:assert/strict";
import test from "node:test";

import { strToU8, zipSync } from "fflate";

import { createArchiveParser } from "../src/app/archive-loader.ts";
import { inspectZip, safeArchivePath } from "../src/core/archive.ts";

test("validates safe ZIP paths without hiding traversal", () => {
  assert.equal(safeArchivePath("folder/data.csv"), "folder/data.csv");
  assert.equal(safeArchivePath("folder\\data.csv"), "folder/data.csv");
  assert.throws(() => safeArchivePath("../data.csv"), /路徑不安全/u);
  assert.throws(() => safeArchivePath("C:\\data.csv"), /路徑不安全/u);
  assert.throws(() => safeArchivePath("/data.csv"), /路徑不安全/u);
  assert.throws(() => safeArchivePath("a/b/c/d/e/f/data.csv"), /5 層/u);
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

  const extraction = await createArchiveParser().extract("batch.zip", bytes);
  assert.equal(extraction.skippedEntries, 1);
  assert.deepEqual(
    extraction.files.map((file) => file.virtualPath),
    ["batch/folder/data.csv"],
  );
  assert.equal(new TextDecoder().decode(extraction.files[0]?.bytes), "A,01");
});

test("recursively extracts nested ZIP files into named virtual folders", async () => {
  const nested = zipSync({ "data.txt": strToU8("record") });
  const outer = zipSync({ "incoming/nested.zip": nested });

  const extraction = await createArchiveParser().extract("outer.zip", outer);
  assert.deepEqual(
    extraction.files.map((file) => file.virtualPath),
    ["outer/incoming/nested/data.txt"],
  );
});

test("rejects unsafe archive entry paths before extraction", async () => {
  const bytes = zipSync({ "../outside.csv": strToU8("unsafe") });
  await assert.rejects(
    createArchiveParser().extract("batch.zip", bytes),
    /路徑不安全/u,
  );
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
