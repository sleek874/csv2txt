import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import { createAdvancedColumnPreferences } from "../src/browser/advanced-preferences.ts";

function memoryStorage() {
  const values = new Map();
  return {
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    get length() { return values.size; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, String(value)); },
    value() { return [...values.values()][0] ?? ""; },
  };
}

test("stores salted header hashes and restores selections after columns move", async () => {
  const storage = memoryStorage();
  const preferences = createAdvancedColumnPreferences(storage, webcrypto);
  await preferences.save(["ID", "姓名", "狀態"], 0, [2]);

  const stored = storage.value();
  assert.doesNotMatch(stored, /ID|姓名|狀態/u);
  assert.match(stored, /"salt":"[0-9a-f]{32}"/u);

  const restored = await createAdvancedColumnPreferences(storage, webcrypto)
    .restore(["狀態", "ID", "姓名"]);
  assert.equal(restored.keyColumnIndex, 1);
  assert.deepEqual(restored.selectedColumnIndices, [0]);

  const unmatched = await createAdvancedColumnPreferences(storage, webcrypto).restore(["其他"]);
  assert.equal(unmatched.keyColumnIndex, null);
  assert.deepEqual(unmatched.selectedColumnIndices, []);
});

test("preserves an intentionally empty output-column selection", async () => {
  const storage = memoryStorage();
  const preferences = createAdvancedColumnPreferences(storage, webcrypto);
  await preferences.save(["ID", "姓名"], 0, []);
  const restored = await createAdvancedColumnPreferences(storage, webcrypto).restore(["姓名", "ID"]);
  assert.equal(restored.keyColumnIndex, 1);
  assert.deepEqual(restored.selectedColumnIndices, []);
});
