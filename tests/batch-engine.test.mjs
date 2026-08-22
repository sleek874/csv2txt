import assert from "node:assert/strict";
import test from "node:test";

import { strToU8, zipSync } from "fflate";

import { createInputAdapter } from "../src/app/adapters/input-adapter.ts";
import { createAdvancedOutputAdapter } from "../src/app/adapters/advanced-output-adapter.ts";
import { createOutputAdapter } from "../src/app/adapters/output-adapter.ts";
import { createBatchEngine } from "../src/app/batch/batch-engine.ts";
import { createCodecManager } from "../src/app/resources/codec-manager.ts";
import {
  collectAdvancedPrimaryRows,
  joinAdvancedRows,
  taipeiCurrentYear,
} from "../src/core/advanced/lookup.ts";
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
    workspaceEpoch: 0,
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
    workspaceEpoch: 0,
    fileId: descriptor.id,
    filter: "all",
    page: 0,
    outputFormat: "csv",
  });
  const last = await engine.handle({
    type: "preview-page",
    workspaceEpoch: 0,
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
    workspaceEpoch: 0,
    fileId: descriptor.id,
    sourceRows: first.records.slice(0, 3).map((record) => record.row.sourceRow),
    included: false,
    outputFormat: "csv",
  });
  assert.equal(changed.summary.includedRows, 202);

  const output = await engine.handle({
    type: "create-output",
    workspaceEpoch: 0,
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
    workspaceEpoch: 0,
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
    workspaceEpoch: 0,
    sourceId: "discarded",
    sourceName: "discarded.csv",
    inputType: "csv",
    bytes: syntheticCsv(1),
    today: "20260812",
    existingPaths: ["kept.csv"],
    outputFormat: "csv",
  });
  await engine.handle({ type: "discard-files", fileIds: [discarded.entries[0].id], workspaceEpoch: 0 });
  await engine.handle({ type: "restore-files", fileIds: [discarded.entries[0].id], workspaceEpoch: 0 });
  await assert.rejects(engine.handle({
    type: "preview-page",
    workspaceEpoch: 0,
    fileId: discarded.entries[0].id,
    filter: "all",
    page: 0,
    outputFormat: "csv",
  }), /找不到要處理的檔案/u);
  await engine.handle({ type: "cancel-source", sourceId: "cancelled", workspaceEpoch: 0 });
  await assert.rejects(engine.handle({
    type: "process-source",
    workspaceEpoch: 0,
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
    workspaceEpoch: 0,
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
    workspaceEpoch: 0,
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

  await engine.handle({ type: "reset-workspace", workspaceEpoch: 1 });
  await assert.rejects(engine.handle({
    type: "preview-page",
    workspaceEpoch: 1,
    fileId: processed.entries[0].id,
    filter: "all",
    page: 0,
    outputFormat: "csv",
  }), /找不到要處理的檔案/u);
  const result = await engine.handle({
    type: "advanced-result",
    workspaceEpoch: 1,
    fileIds: [],
    keyColumnIndex: 0,
    selectedColumnIndices: [1],
  });
  assert.equal(result.selectedRowCount, 0);
});

test("reference inspection returns bounded plain-language issue summaries", async () => {
  const engine = createBatchEngine(() => undefined);
  const summary = await engine.handle({
    type: "inspect-reference",
    bytes: serializeHeaderedSpreadsheet(
      ["ID", "ID", ""],
      [["A123456789", "duplicate", "blank"]],
    ),
  });

  assert.deepEqual(summary.issues, [
    "有 1 個欄位沒有標題，已用欄位序號補上。",
    "有 1 個重複標題，已加上序號區分。",
  ]);
});

test("compact advanced summaries and downloads preserve duplicate joins and unmatched rows", async () => {
  const rows = [
    ["A", "01", "1", "1234567890", "A123456789", "20000101", "測試", "1", "測試地址", "0212345678", "A123456789", "A", "20200101", "", ""],
    ["A", "01", "1", "1234567890", "B123456789", "19900101", "測試", "2", "測試地址", "0212345678", "B123456789", "B", "20200101", "", ""],
  ];
  const bytes = new TextEncoder().encode(rows.map((row) => row.join(",")).join("\r\n"));
  const reference = {
    headers: ["ID", "欄位7", "狀態"],
    rows: [
      [" a123456789 ", "參照甲", "完成"],
      ["A123456789", "參照乙", "待辦"],
      ["C123456789", "參照丙", "完成"],
    ],
  };
  const referenceBytes = serializeHeaderedSpreadsheet(reference.headers, reference.rows);
  const createdAt = new Date("2026-08-12T00:00:00.000Z");
  const codecs = createCodecManager();
  const parsed = await createInputAdapter(codecs).parse("csv", bytes);
  const legacyFile = await createInternalFileWithRecovery("primary:file", "primary.csv", parsed, "20260812");
  const expected = await createAdvancedOutputAdapter(codecs).create(joinAdvancedRows(
    collectAdvancedPrimaryRows([legacyFile], taipeiCurrentYear()),
    reference,
    0,
    [1, 2],
  ), createdAt);
  const engine = createBatchEngine(() => undefined);
  const processed = await engine.handle({
    type: "process-source",
    workspaceEpoch: 0,
    sourceId: "primary",
    sourceName: "primary.csv",
    inputType: "csv",
    bytes,
    today: "20260812",
    existingPaths: [],
    outputFormat: "csv",
  });
  await engine.handle({ type: "inspect-reference", bytes: referenceBytes });
  const request = {
    workspaceEpoch: 0,
    fileIds: [processed.entries[0].id],
    keyColumnIndex: 0,
    selectedColumnIndices: [1, 2],
  };

  assert.deepEqual(await engine.handle({ type: "advanced-result", ...request }), {
    resultRowCount: 3,
    selectedRowCount: 2,
    unmatchedRowCount: 1,
  });
  const actual = await engine.handle({
    type: "create-advanced-output",
    ...request,
    createdAt: createdAt.toISOString(),
  });
  assert.equal(actual.filename, expected.filename);
  assert.equal(actual.mimeType, expected.mimeType);
  assert.deepEqual(actual.bytes, expected.bytes);
});

test("compact worker output preserves the existing serializer bytes", async () => {
  const rows = Array.from({ length: 12 }, (_, index) => [
    "A",
    String(index).padStart(2, "0"),
    String(index % 6 + 1),
    String(index).padStart(10, "0"),
    index === 1 ? "a123456789" : "A123456789",
    "20000101",
    `測試${index}`,
    index === 1 ? "2" : "1",
    `測試地址${index}`,
    index === 1 ? "" : "0212345678",
    index === 1 ? "a123456789" : "A123456789",
    ["A", "B", "C", "D"][index % 4],
    "20200101",
    "",
    "",
  ]);
  const bytes = new TextEncoder().encode(rows.map((row) => row.join(",")).join("\r\n"));
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
    workspaceEpoch: 0,
    sourceId: "source",
    sourceName: "synthetic.csv",
    inputType: "csv",
    bytes,
    today: "20260812",
    existingPaths: [],
    outputFormat: "big5-txt",
  });
  const fileId = processed.entries[0].id;
  legacyFile.rows[2].included = false;
  await engine.handle({
    type: "set-row-included",
    workspaceEpoch: 0,
    fileId,
    sourceRow: legacyFile.rows[2].sourceRow,
    included: false,
    outputFormat: "big5-txt",
  });

  for (const outputFormat of ["big5-txt", "csv", "xlsx"]) {
    const expected = await legacyOutput.create([legacyFile], outputFormat, createdAt);
    const actual = await engine.handle({
      type: "create-output",
      workspaceEpoch: 0,
      fileIds: [fileId],
      outputFormat,
      createdAt: createdAt.toISOString(),
    });
    assert.equal(actual.filename, expected.filename);
    assert.equal(actual.mimeType, expected.mimeType);
    assert.deepEqual(actual.bytes, expected.bytes);
  }
});

test("ZIP processing discards a parser-invalid member and accepts its valid sibling", async () => {
  const progress = [];
  const engine = createBatchEngine((value) => progress.push(value));
  const processed = await engine.handle({
    type: "process-source",
    workspaceEpoch: 0,
    sourceId: "mixed",
    sourceName: "mixed.zip",
    inputType: "zip",
    bytes: zipSync({
      "bad.xlsx": new Uint8Array(0),
      "good.csv": syntheticCsv(1),
    }),
    today: "20260812",
    existingPaths: [],
    outputFormat: "csv",
  });

  assert.equal(processed.entries.length, 1);
  assert.equal(processed.entries[0].virtualPath, "mixed/good.csv");
  assert.deepEqual(processed.skippedEntries, [{
    reason: "invalid-file",
    relativePath: "bad.xlsx",
    virtualPath: "mixed/bad.xlsx",
  }]);
  assert.deepEqual(progress.find((item) => item.phase === "processing"), {
    current: 0,
    phase: "processing",
    sourceId: "mixed",
    total: 2,
    virtualPath: "mixed",
  });
  assert.deepEqual(progress.at(-1), {
    current: 2,
    phase: "finalizing",
    sourceId: "mixed",
    total: 2,
    virtualPath: "mixed.zip",
  });
});

test("archive-policy exclusions do not enlarge supported-leaf progress", async () => {
  const progress = [];
  const engine = createBatchEngine((value) => progress.push(value));
  const processed = await engine.handle({
    type: "process-source",
    workspaceEpoch: 0,
    sourceId: "excluded",
    sourceName: "excluded.zip",
    inputType: "zip",
    bytes: zipSync({
      "good.csv": syntheticCsv(1),
      "notes.md": strToU8("not supported"),
    }),
    today: "20260812",
    existingPaths: [],
    outputFormat: "csv",
  });

  assert.equal(processed.entries.length, 1);
  assert.equal(processed.skippedEntries.length, 1);
  assert.deepEqual(progress.at(-1), {
    current: 1,
    phase: "finalizing",
    sourceId: "excluded",
    total: 1,
    virtualPath: "excluded.zip",
  });
});

test("a fatal cumulative ZIP quota rolls back an earlier staged member", async () => {
  const engine = createBatchEngine(() => undefined);
  const quotaArchive = zipSync(Object.fromEntries(
    Array.from({ length: 5_000 }, (_, index) => [
      `ignored-${String(index).padStart(4, "0")}.md`,
      new Uint8Array(0),
    ]),
  ));

  await assert.rejects(engine.handle({
    type: "process-source",
    workspaceEpoch: 0,
    sourceId: "quota",
    sourceName: "quota.zip",
    inputType: "zip",
    bytes: zipSync({
      "accepted.csv": syntheticCsv(1),
      "nested.zip": quotaArchive,
    }),
    today: "20260812",
    existingPaths: [],
    outputFormat: "csv",
  }), /項目累計超過 5000 個上限/u);

  await assert.rejects(engine.handle({
    type: "preview-page",
    workspaceEpoch: 0,
    fileId: "quota:entry:1",
    filter: "all",
    page: 0,
    outputFormat: "csv",
  }), /找不到要處理的檔案/u);
});

test("Excel parsing is identical for a direct file and the same ZIP member", async () => {
  const workbookBytes = serializeHeaderedSpreadsheet(
    ["資料類別", "區域／機構代碼"],
    [["A", "01"]],
  );
  const engine = createBatchEngine(() => undefined);
  const direct = await engine.handle({
    type: "process-source",
    workspaceEpoch: 0,
    sourceId: "direct-book",
    sourceName: "book.xlsx",
    inputType: "xlsx",
    bytes: workbookBytes,
    today: "20260812",
    existingPaths: [],
    outputFormat: "csv",
  });
  const archived = await engine.handle({
    type: "process-source",
    workspaceEpoch: 0,
    sourceId: "archived-book",
    sourceName: "pack.zip",
    inputType: "zip",
    bytes: zipSync({ "book.xlsx": workbookBytes }),
    today: "20260812",
    existingPaths: ["book.xlsx"],
    outputFormat: "csv",
  });

  assert.equal(archived.entries.length, 1);
  assert.deepEqual(archived.entries[0].file.summary, direct.entries[0].file.summary);
  assert.deepEqual(archived.entries[0].file.issueCounts, direct.entries[0].file.issueCounts);
});

test("multi-file output is canonical regardless of request order", async () => {
  const engine = createBatchEngine(() => undefined);
  const zeta = await engine.handle({
    type: "process-source",
    workspaceEpoch: 0,
    sourceId: "zeta",
    sourceName: "zeta.csv",
    inputType: "csv",
    bytes: syntheticCsv(1),
    today: "20260812",
    existingPaths: [],
    outputFormat: "csv",
  });
  const alpha = await engine.handle({
    type: "process-source",
    workspaceEpoch: 0,
    sourceId: "alpha",
    sourceName: "alpha.csv",
    inputType: "csv",
    bytes: syntheticCsv(1),
    today: "20260812",
    existingPaths: ["zeta.csv"],
    outputFormat: "csv",
  });
  const common = {
    type: "create-output",
    workspaceEpoch: 0,
    outputFormat: "csv",
    createdAt: "2026-08-12T00:00:00.000Z",
  };
  const uploadOrder = await engine.handle({
    ...common,
    fileIds: [zeta.entries[0].id, alpha.entries[0].id],
  });
  const reverseOrder = await engine.handle({
    ...common,
    fileIds: [alpha.entries[0].id, zeta.entries[0].id],
  });

  assert.equal(uploadOrder.filename, reverseOrder.filename);
  assert.deepEqual(uploadOrder.bytes, reverseOrder.bytes);
});
