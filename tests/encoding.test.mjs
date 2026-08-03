import assert from "node:assert/strict";
import test from "node:test";

import { decodeSource, encodeBig5 } from "../src/core/encoding.ts";

test("detects Unicode BOMs and strips them from decoded CSV text", () => {
  const utf8 = decodeSource(
    new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("中文")]),
  );
  assert.equal(utf8.text, "中文");
  assert.equal(utf8.encoding, "utf-8");
  assert.equal(utf8.ambiguous, false);

  const utf16le = decodeSource(
    new Uint8Array([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]),
  );
  assert.equal(utf16le.text, "中文");
  assert.equal(utf16le.encoding, "utf-16le");

  const utf16be = decodeSource(
    new Uint8Array([0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87]),
  );
  assert.equal(utf16be.text, "中文");
  assert.equal(utf16be.encoding, "utf-16be");
});

test("marks ASCII auto-detection as ambiguous", () => {
  const bytes = new TextEncoder().encode("00123,ABC");

  const detected = decodeSource(bytes);
  assert.equal(detected.text, "00123,ABC");
  assert.equal(detected.encoding, "utf-8");
  assert.equal(detected.ambiguous, true);
});

test("round-trips Big5 and rejects lossy encoding", () => {
  const bytes = encodeBig5("繁體中文");
  assert.ok(bytes);

  const decoded = decodeSource(bytes);
  assert.equal(decoded.text, "繁體中文");
  assert.equal(decoded.encoding, "big5");
  assert.equal(decoded.ambiguous, false);

  assert.equal(encodeBig5("😀"), null);
  assert.throws(() => decodeSource(new Uint8Array([0xff])), /Big5 位元組/u);
});
