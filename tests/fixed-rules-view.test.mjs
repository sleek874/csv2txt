import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getFixedRulePresentations } from "../src/app/sections/rules/rules-view.ts";
import {
  FIXED_FIELD_COUNT,
  FIXED_RECORD_WIDTH_BYTES,
} from "../src/core/fixed-profile.ts";

test("derives the fixed rules table from the shared TypeScript profile", () => {
  const fields = getFixedRulePresentations();

  assert.equal(FIXED_FIELD_COUNT, 15);
  assert.equal(fields.length, FIXED_FIELD_COUNT);
  assert.deepEqual(fields[0], {
    fieldLabel: "欄位1",
    widthBytes: 1,
    pattern: "^[AB]$",
    description: "必填",
  });
  assert.deepEqual(fields.slice(0, 4).map((field) => field.description), [
    "必填",
    "必填",
    "必填",
    "必填",
  ]);
  assert.equal(fields[4]?.description, "轉大寫；證號無效時警告；有效證號可修正欄位8");
  assert.equal(fields[4]?.pattern, "^[A-Z0-9]{5,10}$");
  assert.equal(fields[6]?.description, "必填；TXT 轉換後最多 12 bytes");
  assert.equal(fields[7]?.description, "與有效證號不符時依欄位5修正並警告");
  assert.equal(fields[8]?.description, "必填；TXT 轉換後最多 120 bytes");
  assert.equal(fields[10]?.description, "轉大寫；必須通過臺灣身分證檢查碼");
  assert.deepEqual(fields.at(-1), {
    fieldLabel: "欄位15",
    widthBytes: 1,
    pattern: "^[1-4]?$",
    description: "與欄位14同時有值或同時空白",
  });
});

test("keeps the initial folded summary aligned with the shared constants", () => {
  const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const summary = indexHtml.match(/<span class="schema-summary"[\s\S]*?<\/span>\s*<\/span>/u)?.[0] ?? "";

  assert.match(summary, new RegExp(`<strong>${FIXED_FIELD_COUNT}</strong> 欄`, "u"));
  assert.match(summary, new RegExp(`<strong>${FIXED_RECORD_WIDTH_BYTES}</strong> bytes／筆`, "u"));
});
