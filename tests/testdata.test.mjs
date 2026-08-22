import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, extname } from "node:path";
import test from "node:test";

import { extractZip, inspectZip } from "../src/core/archive/zip.ts";
import { ARCHIVE_LIMITS } from "../src/core/archive/policy.ts";
import { createInternalFile } from "../src/core/conversion-pipeline.ts";
import { FILE_SIZE_LIMIT_BYTES } from "../src/core/file-size-policy.ts";
import { FIXED_RECORD_WIDTH_BYTES } from "../src/core/fixed-profile.ts";
import { parseBig5Txt } from "../src/core/formats/big5-txt.ts";
import { parseCsvText } from "../src/core/formats/csv.ts";
import { parseSpreadsheet } from "../src/core/formats/spreadsheet.ts";

const testdataDirectory = new URL("../testdata/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", testdataDirectory), "utf8"));

function assertCrLf(bytes, label) {
  assert.equal(bytes.at(-2), 0x0d, `${label} should end with CRLF`);
  assert.equal(bytes.at(-1), 0x0a, `${label} should end with CRLF`);
  bytes.forEach((byte, index) => {
    if (byte === 0x0a) assert.equal(bytes[index - 1], 0x0d, `${label} contains a bare LF`);
    if (byte === 0x0d) assert.equal(bytes[index + 1], 0x0a, `${label} contains a bare CR`);
  });
}

function rowsFor(format, name, bytes) {
  if (format === "csv") {
    return parseCsvText(Buffer.from(bytes).toString("utf8")).rows;
  }
  if (format === "txt") {
    const parsed = parseBig5Txt(bytes);
    assert.deepEqual(parsed.issues, []);
    assert.equal(parsed.recordWidthBytes, FIXED_RECORD_WIDTH_BYTES);
    return parsed.rows;
  }
  const parsed = parseSpreadsheet(bytes, 15);
  assert.equal(parsed.sheetName, "資料");
  assert.deepEqual(parsed.issues, []);
  return parsed.rows;
}

test("mock data stays within the requested file and row limits", () => {
  assert.ok(manifest.generatedDataFileCount <= manifest.maximumDistinctDataFiles);
  assert.equal(
    manifest.generatedDataFileCount,
    manifest.datasets.length * manifest.formats.length
      + manifest.archives.length
      + manifest.exclusionArchives.length
      + manifest.extremeArchives.length
      + manifest.manualExtremeArchives.length
      + manifest.archiveLimitViolations.length,
  );
  assert.equal(Math.max(...manifest.datasets.map((dataset) => dataset.rowCount)), 6_000);
  assert.ok(manifest.datasets.every((dataset) => dataset.rowCount <= 6_000));
  assert.deepEqual(manifest.formats, ["csv", "xls", "xlsx", "txt"]);
  const generatedFileCount = [...manifest.formats, "zip"].reduce((total, format) => (
    total + readdirSync(new URL(`${format}/`, testdataDirectory)).length
  ), 0);
  assert.equal(generatedFileCount, manifest.generatedDataFileCount);
});

for (const archive of manifest.extremeArchives) {
  test(`${archive.name} preserves its documented archive stress boundary`, async () => {
    const bytes = readFileSync(new URL(`zip/${archive.name}`, testdataDirectory));
    const extraction = await extractZip(archive.name, bytes);
    assert.equal(extraction.skippedEntries.length, 0);
    assert.equal(extraction.files.length, archive.entryCount);
    assert.equal(
      extraction.files.reduce((total, file) => total + file.bytes.byteLength, 0),
      archive.expandedBytes,
    );
    assert.deepEqual(
      extraction.files.map((file) => file.relativePath),
      Array.from({ length: archive.entryCount }, (_, index) => (
        `batch/synthetic-${String(index + 1).padStart(3, "0")}.txt`
      )),
    );

    const first = extraction.files[0];
    const last = extraction.files.at(-1);
    assert.ok(first && last);
    assert.deepEqual(last.bytes, first.bytes);
    assertCrLf(first.bytes, first.relativePath);
    assert.equal(rowsFor("txt", basename(first.relativePath), first.bytes).length, archive.rowsPerEntry);
    assert.ok(archive.rowsPerEntry > manifest.maximumRowsPerFile);
  });
}

for (const archive of manifest.manualExtremeArchives) {
  test(`${archive.name} preserves its manual stress metadata without full extraction`, () => {
    const bytes = readFileSync(new URL(`zip/${archive.name}`, testdataDirectory));
    const metadata = inspectZip(bytes);
    assert.ok(bytes.byteLength <= FILE_SIZE_LIMIT_BYTES, "the selected ZIP stays within the upload limit");
    assert.equal(metadata.length, archive.entryCount);
    assert.equal(
      metadata.reduce((total, entry) => total + entry.uncompressedSize, 0),
      archive.expandedBytes,
    );
    assert.deepEqual(
      metadata.map((entry) => entry.name),
      Array.from({ length: archive.entryCount }, (_, index) => (
        `batch/synthetic-${String(index + 1).padStart(3, "0")}.txt`
      )),
    );
    assert.ok(metadata.every((entry) => entry.uncompressedSize <= FILE_SIZE_LIMIT_BYTES));
    assert.ok(archive.rowsPerEntry > manifest.maximumRowsPerFile);
  });
}

for (const archive of manifest.archiveLimitViolations) {
  test(`${archive.name} exceeds the documented ${archive.kind} limit`, async () => {
    const bytes = readFileSync(new URL(`zip/${archive.name}`, testdataDirectory));
    assert.ok(bytes.byteLength <= FILE_SIZE_LIMIT_BYTES, "the selected ZIP stays within the upload size limit");
    if (archive.kind === "entry-count") {
      assert.equal(archive.entryCount, ARCHIVE_LIMITS.maxEntries + 1);
      await assert.rejects(
        extractZip(archive.name, bytes),
        (error) => error instanceof Error && error.message === archive.expectedError,
      );
    } else {
      assert.equal(archive.archiveDepth, ARCHIVE_LIMITS.maxArchiveDepth + 1);
      assert.equal(inspectZip(bytes).length, 1);
      const extraction = await extractZip(archive.name, bytes);
      assert.deepEqual(extraction.files, []);
      assert.deepEqual(extraction.skippedEntries.map((entry) => entry.reason), [archive.expectedReason]);
    }
  });
}

for (const dataset of manifest.datasets) {
  test(`CSV, XLS, XLSX, and TXT contain identical ${dataset.name} rows`, () => {
    const csvBytes = readFileSync(new URL(`csv/${dataset.name}.csv`, testdataDirectory));
    assertCrLf(csvBytes, `${dataset.name}.csv`);
    const expected = rowsFor(
      "csv",
      dataset.name,
      csvBytes,
    );
    assert.equal(expected.length, dataset.rowCount);
    assert.deepEqual(
      createInternalFile(
        dataset.name,
        `${dataset.name}.csv`,
        { rows: expected },
        manifest.deterministicToday,
      ).summary,
      dataset.expectedSummary,
    );
    for (const format of ["xls", "xlsx", "txt"]) {
      const bytes = readFileSync(new URL(`${format}/${dataset.name}.${format}`, testdataDirectory));
      if (format === "txt") assertCrLf(bytes, `${dataset.name}.txt`);
      const actual = rowsFor(
        format,
        dataset.name,
        bytes,
      );
      assert.deepEqual(actual, expected);
    }
  });
}

for (const archive of manifest.archives) {
  test(`${archive.name} contains valid mixed source extensions`, async () => {
    const extraction = await extractZip(
      archive.name,
      readFileSync(new URL(`zip/${archive.name}`, testdataDirectory)),
    );
    assert.deepEqual(extraction.skippedEntries, []);
    assert.equal(extraction.files.length, archive.entries.length);
    const extensions = new Set(extraction.files.map((file) => extname(file.relativePath).slice(1)));
    assert.ok(extensions.size > 1);

    for (const file of extraction.files) {
      const format = extname(file.relativePath).slice(1);
      const expectedEntry = archive.entries.find((entry) => entry.path === file.relativePath);
      assert.ok(expectedEntry, `manifest entry should exist for ${file.relativePath}`);
      const expected = rowsFor(
        format,
        expectedEntry.dataset,
        readFileSync(new URL(`${format}/${expectedEntry.dataset}.${format}`, testdataDirectory)),
      );
      assert.deepEqual(rowsFor(format, basename(file.relativePath), file.bytes), expected);
    }
  });
}

for (const archive of manifest.exclusionArchives) {
  test(`${archive.name} keeps supported data and reports each excluded entry`, async () => {
    const bytes = readFileSync(new URL(`zip/${archive.name}`, testdataDirectory));
    const extraction = await extractZip(archive.name, bytes);
    assert.deepEqual(
      extraction.files.map((file) => file.relativePath),
      [archive.acceptedEntry.path],
    );
    assert.deepEqual(
      extraction.skippedEntries.map((entry) => ({
        path: entry.virtualPath.slice(archive.name.replace(/\.zip$/u, "").length + 1),
        reason: entry.reason,
      })),
      archive.excludedEntries,
    );
  });
}
