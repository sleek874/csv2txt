import assert from "node:assert/strict";
import test from "node:test";

import { otherFilePresentation } from "../src/app/sections/input/other-files-view.ts";

test("separates supported file formats from their status", () => {
  assert.deepEqual(otherFilePresentation({
    state: "ready",
    sourceFormat: "xlsx",
    virtualPath: "book.xlsx",
  }), {
    format: "XLSX",
    status: "已保留",
  });
  assert.deepEqual(otherFilePresentation({
    state: "processing",
    sourceFormat: "csv",
    virtualPath: "data.csv",
  }), {
    format: "CSV",
    status: "已保留",
  });
});

test("puts skipped reasons in file type and keeps status as not added", () => {
  assert.deepEqual(otherFilePresentation({
    state: "ignored",
    ignoredReason: "unsupported-type",
    virtualPath: "notes.pdf",
  }), {
    format: "不支援（PDF）",
    status: "未加入",
  });
  assert.deepEqual(otherFilePresentation({
    state: "ignored",
    ignoredReason: "symlink",
    virtualPath: "linked.csv",
  }), {
    format: "不支援（捷徑）",
    status: "未加入",
  });
  assert.deepEqual(otherFilePresentation({
    state: "error",
    virtualPath: "broken.zip",
  }), {
    format: "壓縮檔",
    status: "未加入",
  });
});
