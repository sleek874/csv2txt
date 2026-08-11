import assert from "node:assert/strict";
import test from "node:test";

import {
  previewChangeDetail,
  previewCellIssues,
  previewCellValue,
  visibleRowsSelectionState,
} from "../src/app/sections/input/data-preview-view.ts";

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

test("masks unresolved private-use characters only in preview text", () => {
  assert.equal(previewCellValue([
    "甲",
    String.fromCodePoint(0xe088),
    "乙",
    String.fromCodePoint(0xf0000),
    "丙",
    String.fromCodePoint(0x100000),
  ].join("")), "甲■乙■丙■");
  assert.equal(previewCellValue("正式 Unicode 堃■"), "正式 Unicode 堃■");
  assert.equal(previewCellValue("原有？替代？", [5]), "原有？替代■");
});

test("masks unresolved private-use characters in correction details", () => {
  assert.equal(previewChangeDetail({
    after: "吳綠華",
    before: `吳${String.fromCodePoint(0xe088)}華`,
    fieldIndex: 7,
  }), "欄位7：吳■華 已改為 吳綠華。");
});

test("keeps another row's field issue out of a correct preview cell", () => {
  const issueForRowOne = {
    severity: "error",
    stage: "adapter",
    code: "UNDECODABLE_BIG5E_BYTES",
    message: "字元無法讀取。",
    sourceRow: 1,
    fieldIndex: 7,
    replacementCharacterIndices: [1, 2],
  };
  const row = previewRow(2);

  assert.deepEqual(previewCellIssues(row, [issueForRowOne], 7), []);
  assert.equal(
    previewCellValue(row.cells[6].normalizedValue, previewCellIssues(row, [issueForRowOne], 7)
      .flatMap((issue) => issue.replacementCharacterIndices ?? [])),
    "王明德",
  );
});

test("derives the visible-page header checkbox state", () => {
  assert.deepEqual(visibleRowsSelectionState([]), { checked: false, indeterminate: false });
  assert.deepEqual(visibleRowsSelectionState([{ included: false }, { included: false }]), {
    checked: false,
    indeterminate: false,
  });
  assert.deepEqual(visibleRowsSelectionState([{ included: true }, { included: false }]), {
    checked: false,
    indeterminate: true,
  });
  assert.deepEqual(visibleRowsSelectionState([{ included: true }, { included: true }]), {
    checked: true,
    indeterminate: false,
  });
});
