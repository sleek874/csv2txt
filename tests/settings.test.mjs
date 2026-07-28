import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultSettings } from "../src/settings/profile.ts";
import {
  determineSettingsKind,
  settingsEqual,
} from "../src/settings/state.ts";
import { validateConverterSettings } from "../src/settings/validation.ts";

test("classifies only an exact built-in settings match as default", () => {
  const defaults = createDefaultSettings();
  const copy = structuredClone(defaults);

  assert.equal(settingsEqual(copy, defaults), true);
  assert.equal(determineSettingsKind(copy, defaults), "default");

  copy.columns[0].defaultValue = " ";
  assert.equal(settingsEqual(copy, defaults), false);
  assert.equal(determineSettingsKind(copy, defaults), "custom");
});

test("classifies changed global or column settings as custom", () => {
  const defaults = createDefaultSettings();
  const changedWhitespace = structuredClone(defaults);
  changedWhitespace.removeWhitespace = false;
  const changedAlignment = structuredClone(defaults);
  changedAlignment.alignment = "right";
  const changedWidth = structuredClone(defaults);
  changedWidth.columns[14].widthBytes += 1;

  assert.equal(determineSettingsKind(changedWhitespace, defaults), "custom");
  assert.equal(determineSettingsKind(changedAlignment, defaults), "custom");
  assert.equal(determineSettingsKind(changedWidth, defaults), "custom");
});

test("classifies an uncollectable screen as invalid", () => {
  assert.equal(determineSettingsKind(null, createDefaultSettings()), "invalid");
});

test("reports the exact field when an uploaded width is invalid", () => {
  const uploaded = createDefaultSettings();
  uploaded.columns[1].widthBytes = -2;

  assert.deepEqual(validateConverterSettings(uploaded), {
    valid: false,
    reason: "欄位2的輸出寬度必須是大於 0 的整數。",
  });
});

test("accepts a structurally valid settings file", () => {
  const uploaded = createDefaultSettings();

  assert.deepEqual(validateConverterSettings(uploaded), {
    valid: true,
    settings: uploaded,
  });
});

test("rejects legacy settings without the whitespace policy", () => {
  const legacy = {
    ...createDefaultSettings(),
    version: 2,
    sourceEncoding: "auto",
  };
  delete legacy.removeWhitespace;

  assert.deepEqual(validateConverterSettings(legacy), {
    valid: false,
    reason: "版本不受支援；目前只支援版本 3。",
  });
});

test("rejects removed or unknown settings instead of preserving them", () => {
  const uploaded = {
    ...createDefaultSettings(),
    sourceEncoding: "auto",
  };

  assert.deepEqual(validateConverterSettings(uploaded), {
    valid: false,
    reason: "包含不支援的設定：sourceEncoding。",
  });
});
