import assert from "node:assert/strict";
import test from "node:test";

import { TEST_SCOPES, verifyTestScopes } from "./test-scopes.mjs";

test("classifies every Node test exactly once by evidence scope", () => {
  const classified = verifyTestScopes(new URL("./", import.meta.url));
  assert.equal(classified.length, new Set(classified.map(({ file }) => file)).size);
  assert.deepEqual(Object.keys(TEST_SCOPES), ["unit", "application", "contract", "presentation"]);
});
