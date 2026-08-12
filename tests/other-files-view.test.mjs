import assert from "node:assert/strict";
import test from "node:test";

import { otherFilePresentation } from "../src/app/sections/input/other-files-view.ts";

test("separates supported file formats from their status", () => {
  assert.deepEqual(otherFilePresentation({
    sourceFormat: "xlsx",
    virtualPath: "book.xlsx",
  }), {
    format: "XLSX",
    status: "已保留",
  });
});

test("only accepted files from other supported families appear as retained", () => {
  assert.deepEqual(otherFilePresentation({ sourceFormat: "txt" }), {
    format: "TXT",
    status: "已保留",
  });
});
