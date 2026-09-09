import assert from "node:assert/strict";
import test from "node:test";

import { concatenateBytes } from "../src/core/bytes.ts";

test("concatenates bytes with inferred or exact declared lengths", () => {
  const chunks = [Uint8Array.from([1, 2]), Uint8Array.from([3]), new Uint8Array()];
  assert.deepEqual(concatenateBytes(chunks), Uint8Array.from([1, 2, 3]));
  assert.deepEqual(concatenateBytes(chunks, 3), Uint8Array.from([1, 2, 3]));
  assert.deepEqual(concatenateBytes([], 0), new Uint8Array());
});

test("rejects both byte overruns and underruns", () => {
  assert.throws(
    () => concatenateBytes([Uint8Array.from([1, 2]), Uint8Array.from([3])], 2),
    /位元組內容超過預期大小/u,
  );
  assert.throws(
    () => concatenateBytes([Uint8Array.from([1, 2])], 3),
    /位元組內容與預期大小不一致/u,
  );
});
