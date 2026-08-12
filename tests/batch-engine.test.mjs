import assert from "node:assert/strict";
import test from "node:test";

import { createInputAdapter } from "../src/app/adapters/input-adapter.ts";
import { createOutputAdapter } from "../src/app/adapters/output-adapter.ts";
import { createBatchEngine } from "../src/app/batch/batch-engine.ts";
import { createCodecManager } from "../src/app/resources/codec-manager.ts";
import { createInternalFileWithRecovery } from "../src/core/conversion-pipeline.ts";
import { serializeHeaderedSpreadsheet } from "../src/core/formats/spreadsheet.ts";

function syntheticCsv(rowCount) {
  const row = [
    "A", "01", "1", "1234567890", "A123456789", "20000101", "測試",
    "1", "測試地址", "0212345678", "A123456789", "A", "20200101", "", "",
  ].join(",");
  return new TextEncoder().encode(Array.from({ length: rowCount }, () => row).join("\r\n"));
}

test("worker engine retains rows and returns only summaries plus 100-row pages", async () => {
  const progress = [];
  const engine = createBatchEngine((value) => progress.push(value));
  const processed = await engine.handle({
    type: "process-source",
    sourceId: "input-1",
    sourceName: "synthetic.csv",
    inputType: "csv",
    bytes: syntheticCsv(205),
    today: "20260812",
    existingPaths: [],
    outputFormat: "csv",
  });

  assert.equal(processed.entries.length, 1);
  const descriptor = processed.entries[0].file;
  assert.equal(descriptor.summary.dataRows, 205);
  assert.equal(descriptor.summary.includedRows, 205);
  assert.equal("rows" in descriptor, false, "full rows must remain in the worker-owned engine");
  assert.deepEqual(progress.map((item) => item.phase), ["processing", "finalizing"]);

  const first = await engine.handle({
    type: "preview-page",
    fileId: descriptor.id,
    filter: "all",
    page: 0,
    outputFormat: "csv",
  });
  const last = await engine.handle({
    type: "preview-page",
    fileId: descriptor.id,
    filter: "all",
    page: 2,
    outputFormat: "csv",
  });
  assert.equal(first.records.length, 100);
  assert.equal(first.pageCount, 3);
  assert.equal(last.records.length, 5);

  const changed = await engine.handle({
    type: "set-rows-included",
    fileId: descriptor.id,
    sourceRows: first.records.slice(0, 3).map((record) => record.row.sourceRow),
    included: false,
    outputFormat: "csv",
  });
  assert.equal(changed.summary.includedRows, 202);

  const output = await engine.handle({
    type: "create-output",
    fileIds: [descriptor.id],
    outputFormat: "csv",
    createdAt: "2026-08-12T00:00:00.000Z",
  });
  assert.equal(output.filename, "synthetic.csv");
  assert.ok(output.bytes.byteLength > 0);
});

test("worker engine cancels a source without clearing previously stored files", async () => {
  const engine = createBatchEngine(() => undefined);
  const kept = await engine.handle({
    type: "process-source",
    sourceId: "kept",
    sourceName: "kept.csv",
    inputType: "csv",
    bytes: syntheticCsv(1),
    today: "20260812",
    existingPaths: [],
    outputFormat: "csv",
  });
  const discarded = await engine.handle({
    type: "process-source",
    sourceId: "discarded",
    sourceName: "discarded.csv",
    inputType: "csv",
    bytes: syntheticCsv(1),
    today: "20260812",
    existingPaths: ["kept.csv"],
    outputFormat: "csv",
  });
  await engine.handle({ type: "discard-files", fileIds: [discarded.entries[0].id] });
  await engine.handle({ type: "restore-files", fileIds: [discarded.entries[0].id] });
  await assert.rejects(engine.handle({
    type: "preview-page",
    fileId: discarded.entries[0].id,
    filter: "all",
    page: 0,
    outputFormat: "csv",
  }), /找不到要處理的檔案/u);
  await engine.handle({ type: "cancel-source", sourceId: "cancelled" });
  await assert.rejects(engine.handle({
    type: "process-source",
    sourceId: "cancelled",
    sourceName: "cancelled.csv",
    inputType: "csv",
    bytes: syntheticCsv(1),
    today: "20260812",
    existingPaths: [],
    outputFormat: "csv",
  }), /本次新增已取消/u);
  const preview = await engine.handle({
    type: "preview-page",
    fileId: kept.entries[0].id,
    filter: "all",
    page: 0,
    outputFormat: "csv",
  });
  assert.equal(preview.totalRecords, 1);
});

test("clearing primary files preserves the independent advanced reference", async () => {
  const engine = createBatchEngine(() => undefined);
  const processed = await engine.handle({
    type: "process-source",
    sourceId: "primary",
    sourceName: "primary.csv",
    inputType: "csv",
    bytes: syntheticCsv(1),
    today: "20260812",
    existingPaths: [],
    outputFormat: "csv",
  });
  await engine.handle({
    type: "inspect-reference",
    bytes: serializeHeaderedSpreadsheet(["ID", "Value"], [["A123456789", "synthetic"]]),
  });

  await engine.handle({ type: "clear-files" });
  await assert.rejects(engine.handle({
    type: "preview-page",
    fileId: processed.entries[0].id,
    filter: "all",
    page: 0,
    outputFormat: "csv",
  }), /找不到要處理的檔案/u);
  const result = await engine.handle({
    type: "advanced-result",
    fileIds: [],
    keyColumnIndex: 0,
    selectedColumnIndices: [1],
  });
  assert.equal(result.selectedRowCount, 0);
});

test("compact worker output preserves the existing serializer bytes", async () => {
  const bytes = syntheticCsv(2);
  const createdAt = new Date("2026-08-12T00:00:00.000Z");
  const codecs = createCodecManager();
  const parsed = await createInputAdapter(codecs).parse("csv", bytes);
  const legacyFile = await createInternalFileWithRecovery(
    "source:file",
    "synthetic.csv",
    parsed,
    "20260812",
  );
  const legacyOutput = createOutputAdapter(codecs);
  const engine = createBatchEngine(() => undefined);
  const processed = await engine.handle({
    type: "process-source",
    sourceId: "source",
    sourceName: "synthetic.csv",
    inputType: "csv",
    bytes,
    today: "20260812",
    existingPaths: [],
    outputFormat: "big5-txt",
  });
  const fileId = processed.entries[0].id;

  for (const outputFormat of ["big5-txt", "csv", "xlsx"]) {
    const expected = await legacyOutput.create([legacyFile], outputFormat, createdAt);
    const actual = await engine.handle({
      type: "create-output",
      fileIds: [fileId],
      outputFormat,
      createdAt: createdAt.toISOString(),
    });
    assert.equal(actual.filename, expected.filename);
    assert.equal(actual.mimeType, expected.mimeType);
    assert.deepEqual(actual.bytes, expected.bytes);
  }
});
