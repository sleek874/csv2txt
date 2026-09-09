import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  previewChangeDetail,
  previewCellIssues,
  previewCellValue,
  visibleRowsSelectionState,
} from "../src/app/sections/input/data-preview-view.ts";
import {
  buildTree,
  findingPresentation,
  inventoryMetrics,
  removalTarget,
} from "../src/app/sections/input/file-tree-view.ts";
import { otherFilePresentation } from "../src/app/sections/input/other-files-view.ts";
import { getFixedRulePresentations } from "../src/app/sections/rules/rules-view.ts";
import { fileProgressDetail } from "../src/app/shell/file-progress.ts";
import {
  FIXED_FIELD_COUNT,
  FIXED_RECORD_WIDTH_BYTES,
} from "../src/core/fixed-profile.ts";

function previewRow(sourceRow, cellIssues = []) {
  return {
    sourceRow,
    included: true,
    cells: Array.from({ length: 15 }, (_, index) => ({
      fieldIndex: index + 1,
      normalizedValue: index === 6 ? "王明德" : "",
      issues: index === 6 ? cellIssues : [],
    })),
    issues: [],
    changes: [],
  };
}

test("projects concise file progress without testing rendered layout", () => {
  assert.equal(fileProgressDetail({
    current: 2, phase: "processing", total: 5, virtualPath: "folder/example.csv",
  }, {
    processingVerb: "檢查", finalizing: "正在整理本次新增結果",
  }), "正在檢查 example.csv，已完成 2 / 5 個檔案。");
  assert.equal(fileProgressDetail({
    current: 5, phase: "finalizing", total: 5, virtualPath: "folder/example.csv",
  }, {
    processingVerb: "處理", finalizing: "正在整理下載",
  }), "正在整理下載，已完成 5 / 5 個檔案。");
});

test("projects file-tree findings, totals, and removal ownership", () => {
  assert.deepEqual(findingPresentation(2, 3), { label: "2 錯誤 · 3 警告", tone: "error" });
  assert.deepEqual(findingPresentation(0, 3), { label: "3 警告", tone: "warning" });
  assert.equal(findingPresentation(0, 0), null);

  const ready = {
    id: "ready", sourceId: "source", unread: true,
    file: { summary: {
      blankRows: 1, rejectedRows: 1, dataRows: 10, correctRows: 6,
      errorRows: 2, warningRows: 2, includedRows: 9,
    } },
  };
  assert.deepEqual(inventoryMetrics([ready], new Map([["ready", new Set([2, 4])]])), {
    blankRows: 1, rejectedRows: 1, dataRows: 10, correctRows: 6,
    errorRows: 2, warningRows: 2, selectedRows: 9, outputProblems: 2, unreadCount: 1,
  });

  const directSource = { id: "direct", kind: "file", name: "direct.csv" };
  const archiveSource = { id: "archive", kind: "archive", name: "batch.zip" };
  const [directNode] = buildTree([directSource], [{
    id: "direct-item", relativePath: "", size: 1,
    sourceId: directSource.id, virtualPath: "direct.csv",
  }]);
  const [archiveNode] = buildTree([archiveSource], [{
    id: "archive-item", relativePath: "folder/file.csv", size: 1,
    sourceId: archiveSource.id, virtualPath: "batch.zip/folder/file.csv",
  }]);
  assert.deepEqual(removalTarget(directNode), { id: "direct-item", kind: "file" });
  assert.deepEqual(removalTarget(archiveNode), { id: "archive", kind: "source" });
  assert.deepEqual(removalTarget(archiveNode.children[0].children[0]), {
    id: "archive-item", kind: "file",
  });
});

test("projects retained other-format labels", () => {
  assert.deepEqual(otherFilePresentation({ sourceFormat: "xlsx", virtualPath: "book.xlsx" }), {
    format: "XLSX", status: "已保留",
  });
  assert.deepEqual(otherFilePresentation({ sourceFormat: "txt" }), {
    format: "TXT", status: "已保留",
  });
});

test("derives the visible fixed-rule presentation from the shared profile", () => {
  const fields = getFixedRulePresentations();
  assert.equal(FIXED_FIELD_COUNT, 15);
  assert.equal(fields.length, FIXED_FIELD_COUNT);
  assert.deepEqual(fields[0], {
    fieldLabel: "欄位1", widthBytes: 1, pattern: "^[AB]$", description: "必填",
  });
  assert.deepEqual(fields.slice(0, 4).map((field) => field.description), Array(4).fill("必填"));
  assert.equal(fields[4]?.description, "轉大寫；證號無效時警告；有效證號可修正欄位8");
  assert.equal(fields[4]?.pattern, "^[A-Z0-9]{5,10}$");
  assert.equal(fields[6]?.description, "必填；TXT 轉換後最多 12 bytes");
  assert.equal(fields[7]?.description, "與有效證號不符時依欄位5修正並警告");
  assert.equal(fields[8]?.description, "必填；TXT 轉換後最多 120 bytes");
  assert.equal(fields[10]?.description, "轉大寫；必須通過臺灣身分證檢查碼");
  assert.deepEqual(fields.at(-1), {
    fieldLabel: "欄位15", widthBytes: 1, pattern: "^[1-4]?$",
    description: "與欄位14同時有值或同時空白",
  });

  const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const summary = indexHtml.match(/<span class="schema-summary"[\s\S]*?<\/span>\s*<\/span>/u)?.[0] ?? "";
  assert.match(summary, new RegExp(`<strong>${FIXED_FIELD_COUNT}</strong> 欄`, "u"));
  assert.match(summary, new RegExp(`<strong>${FIXED_RECORD_WIDTH_BYTES}</strong> bytes／筆`, "u"));
});

test("projects preview masking, cell issues, and page-selection state", () => {
  assert.equal(previewCellValue([
    "甲", String.fromCodePoint(0xe088), "乙", String.fromCodePoint(0xf0000),
    "丙", String.fromCodePoint(0x100000),
  ].join("")), "甲■乙■丙■");
  assert.equal(previewCellValue("正式 Unicode 堃■"), "正式 Unicode 堃■");
  assert.equal(previewCellValue("原有？替代？", [5]), "原有？替代■");
  assert.equal(previewChangeDetail({
    after: "吳綠華", before: `吳${String.fromCodePoint(0xe088)}華`, fieldIndex: 7,
  }), "欄位7：吳■華 已改為 吳綠華。");

  const issueForRowOne = {
    severity: "error", stage: "adapter", code: "UNDECODABLE_BIG5E_BYTES",
    message: "字元無法讀取。", sourceRow: 1, fieldIndex: 7,
    replacementCharacterIndices: [1, 2],
  };
  const row = previewRow(2);
  assert.deepEqual(previewCellIssues(row, [issueForRowOne], 7), []);
  assert.equal(previewCellValue(
    row.cells[6].normalizedValue,
    previewCellIssues(row, [issueForRowOne], 7)
      .flatMap((issue) => issue.replacementCharacterIndices ?? []),
  ), "王明德");

  assert.deepEqual(visibleRowsSelectionState([]), { checked: false, indeterminate: false });
  assert.deepEqual(visibleRowsSelectionState([{ included: false }, { included: false }]), {
    checked: false, indeterminate: false,
  });
  assert.deepEqual(visibleRowsSelectionState([{ included: true }, { included: false }]), {
    checked: false, indeterminate: true,
  });
  assert.deepEqual(visibleRowsSelectionState([{ included: true }, { included: true }]), {
    checked: true, indeterminate: false,
  });
});
