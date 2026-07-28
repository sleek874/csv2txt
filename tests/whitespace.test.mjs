import assert from "node:assert/strict";
import test from "node:test";

import { applyWhitespacePolicy } from "../src/core/whitespace.ts";

test("removes every whitespace character when enabled", () => {
  assert.equal(applyWhitespacePolicy(" A\tB　\n\u00a0", true), "AB");
});

test("preserves the original cell when disabled", () => {
  assert.equal(applyWhitespacePolicy(" A\tB　\n\u00a0", false), " A\tB　\n\u00a0");
});
