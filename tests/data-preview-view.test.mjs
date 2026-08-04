import assert from "node:assert/strict";
import test from "node:test";

import {
  previewChangeDetail,
  previewCellValue,
  visibleRowsSelectionState,
} from "../src/app/sections/input/data-preview-view.ts";

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
});

test("masks unresolved private-use characters in hover correction details", () => {
  assert.equal(previewChangeDetail({
    after: "吳綠華",
    before: `吳${String.fromCodePoint(0xe088)}華`,
    fieldIndex: 7,
  }), "欄位7：吳■華 已改為 吳綠華。");
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
