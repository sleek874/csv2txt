import assert from "node:assert/strict";
import test from "node:test";

import { fileProgressDetail } from "../src/app/shell/file-progress.ts";

test("uses one concise fraction pattern for file processing", () => {
  assert.equal(fileProgressDetail({
    current: 2,
    phase: "processing",
    total: 5,
    virtualPath: "folder/example.csv",
  }, {
    processingVerb: "檢查",
    finalizing: "正在整理本次新增結果",
  }), "正在檢查 example.csv，已完成 2 / 5 個檔案。");

  assert.equal(fileProgressDetail({
    current: 5,
    phase: "finalizing",
    total: 5,
    virtualPath: "folder/example.csv",
  }, {
    processingVerb: "處理",
    finalizing: "正在整理下載",
  }), "正在整理下載，已完成 5 / 5 個檔案。");
});
