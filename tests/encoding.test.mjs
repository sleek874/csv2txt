import assert from "node:assert/strict";
import test from "node:test";

import { BIG5E_MAPPING_PROVENANCE } from "../src/core/big5e-mapping.ts";
import {
  PRIVATE_USE_RECOVERY_PROVENANCE,
  recoveredUnicodeCodePoint,
} from "../src/core/private-use-recovery-mapping.ts";
import {
  containsPrivateUseCodePoint,
  decodeBig5E,
  decodeBig5EPartially,
  decodeSource,
  encodeBig5E,
  encodeBig5EWithReplacement,
  privateUseCodePoints,
} from "../src/core/encoding.ts";
import { recoverPrivateUse } from "../src/core/private-use-recovery.ts";

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

test("uses the pinned Taiwan-government BIG-5E mapping instead of HKSCS", () => {
  const bytes = encodeBig5E("繁體中文堃綉");
  assert.ok(bytes);
  assert.deepEqual(bytes.slice(-4), new Uint8Array([0x96, 0x4f, 0x9b, 0xbc]));
  assert.equal(decodeBig5E(new Uint8Array([0x96, 0x4f, 0x9b, 0xbc])), "堃綉");

  const decoded = decodeSource(bytes);
  assert.equal(decoded.text, "繁體中文堃綉");
  assert.equal(decoded.encoding, "big5e");
  assert.equal(decoded.ambiguous, false);

  assert.equal(encodeBig5E("𤈛"), null, "the former HKSCS interpretation must not leak into BIG-5E");
  assert.equal(encodeBig5E("😀"), null);
  assert.throws(() => decodeSource(new Uint8Array([0xff])), /BIG-5E/u);
  assert.deepEqual(BIG5E_MAPPING_PROVENANCE, {
    entryCount: 17_454,
    sourceUrl: "https://www.cns11643.gov.tw/opendata/MapingTables.zip",
    sourceVersion: "20260505",
    sourceSha256: "f59dacc4dbdef334d7a887c3da671af02778e2c80adb2a7fd1053f64dbf9e659",
  });
});

test("partially decodes BIG-5E without swallowing valid neighboring bytes", () => {
  assert.deepEqual(
    decodeBig5EPartially(new Uint8Array([0xa6, 0xf3, 0xfb, 0xa9, 0xaa, 0xe5, 0xff, 0x41])),
    {
      text: "何？芸？A",
      unrecognized: [
        { bytes: [0xfb, 0xa9], characterIndex: 1, offset: 2 },
        { bytes: [0xff], characterIndex: 3, offset: 6 },
      ],
    },
  );
});

test("replaces only unmappable BIG-5E output characters with full-width questions", () => {
  const encoded = encodeBig5EWithReplacement("甲廍乙");
  assert.equal(decodeBig5E(encoded.bytes), "甲？乙");
  assert.deepEqual(encoded.substitutions, [{
    character: "廍",
    characterIndex: 1,
    codePoint: 0x5ecd,
  }]);
});

test("round-trips every pinned non-ASCII BIG-5E mapping", () => {
  let mappedCount = 0;
  for (let encodedCode = 0x8000; encodedCode <= 0xffff; encodedCode += 1) {
    const bytes = new Uint8Array([encodedCode >> 8, encodedCode & 0xff]);
    let decoded;
    try {
      decoded = decodeBig5E(bytes);
    } catch {
      continue;
    }
    mappedCount += 1;
    assert.deepEqual(
      encodeBig5E(decoded),
      bytes,
      `BIG-5E ${encodedCode.toString(16).toUpperCase()} must round-trip`,
    );
  }
  assert.equal(mappedCount, BIG5E_MAPPING_PROVENANCE.entryCount);
});

test("keeps every generated PUA recovery inside the pinned formal-Unicode contract", () => {
  const recovered = [];
  for (let privateUse = 0xe000; privateUse <= 0xf8ff; privateUse += 1) {
    const formalUnicode = recoveredUnicodeCodePoint(privateUse);
    if (formalUnicode !== undefined) recovered.push(formalUnicode);
  }
  assert.equal(recovered.length, PRIVATE_USE_RECOVERY_PROVENANCE.entryCount);
  assert.equal(
    recovered.some((codePoint) => privateUseCodePoints(String.fromCodePoint(codePoint)).length > 0),
    false,
  );
});

test("recognizes all three Unicode Private Use Areas", () => {
  assert.equal(containsPrivateUseCodePoint("正式 Unicode 堃"), false);
  for (const codePoint of [0xe000, 0xf8ff, 0xf0000, 0xffffd, 0x100000, 0x10fffd]) {
    assert.equal(containsPrivateUseCodePoint(`A${String.fromCodePoint(codePoint)}B`), true);
  }
  for (const codePoint of [0xdfff, 0xf900, 0xeffff, 0xffffe, 0x10fffe]) {
    assert.equal(containsPrivateUseCodePoint(String.fromCodePoint(codePoint)), false);
  }
  assert.deepEqual(
    privateUseCodePoints(`A${String.fromCodePoint(0xe000)}${String.fromCodePoint(0xf0000)}${String.fromCodePoint(0x100000)}${String.fromCodePoint(0xe000)}`),
    [0xe000, 0xf0000, 0x100000],
  );
  assert.deepEqual(privateUseCodePoints("正式 Unicode 堃"), []);
});

test("recovers legacy Excel private-use slots only through the official mapping", () => {
  const result = recoverPrivateUse(
    `王${String.fromCodePoint(0xe808)}${String.fromCodePoint(0xeb64)}`,
    recoveredUnicodeCodePoint,
  );
  assert.deepEqual(result, {
    value: "王堃綉",
    recoveredCount: 2,
    unresolvedCount: 0,
  });

  const unresolved = String.fromCodePoint(0xf0000);
  assert.deepEqual(recoverPrivateUse(`王${unresolved}`, recoveredUnicodeCodePoint), {
    value: `王${unresolved}`,
    recoveredCount: 0,
    unresolvedCount: 1,
  });
  assert.deepEqual(recoverPrivateUse("正式 Unicode 堃", recoveredUnicodeCodePoint), {
    value: "正式 Unicode 堃",
    recoveredCount: 0,
    unresolvedCount: 0,
  });
  assert.deepEqual(recoverPrivateUse(String.fromCodePoint(0xe001), recoveredUnicodeCodePoint), {
    value: String.fromCodePoint(0xe001),
    recoveredCount: 0,
    unresolvedCount: 1,
  });
  assert.deepEqual(recoverPrivateUse(String.fromCodePoint(0xe088), recoveredUnicodeCodePoint), {
    value: String.fromCodePoint(0xe088),
    recoveredCount: 0,
    unresolvedCount: 1,
  });
  assert.deepEqual(PRIVATE_USE_RECOVERY_PROVENANCE, {
    entryCount: 4_107,
    sourceUrl: "https://www.cns11643.gov.tw/opendata/MapingTables.zip",
    sourceVersion: "20260505",
    sourceSha256: "f59dacc4dbdef334d7a887c3da671af02778e2c80adb2a7fd1053f64dbf9e659",
  });
});
