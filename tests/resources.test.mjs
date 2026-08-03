import assert from "node:assert/strict";
import test from "node:test";

import { prioritizeSourceResources } from "../src/app/resource-priority.ts";
import { createSpreadsheetParser } from "../src/app/spreadsheet-loader.ts";

test("CSV promotes the font without waiting to parse", async () => {
  const events = [];
  let releaseFont;
  const fontReady = new Promise((resolve) => {
    releaseFont = resolve;
  });
  const priority = prioritizeSourceResources("csv", {
    async prepareExcel() {
      events.push("excel");
    },
    async prepareFont() {
      events.push("font");
      await fontReady;
    },
  });

  await priority.readyForParsing;
  assert.deepEqual(events, ["font"]);
  releaseFont();
  await priority.fullyPrepared;
});

test("Big5 TXT shares the lightweight font-first path", async () => {
  const events = [];
  const priority = prioritizeSourceResources("txt", {
    async prepareExcel() {
      events.push("excel");
    },
    async prepareFont() {
      events.push("font");
    },
  });
  await priority.readyForParsing;
  await priority.fullyPrepared;
  assert.deepEqual(events, ["font"]);
});

test("Excel completes before the font starts", async () => {
  const events = [];
  let releaseExcel;
  const excelReady = new Promise((resolve) => {
    releaseExcel = resolve;
  });
  const priority = prioritizeSourceResources("xlsx", {
    async prepareExcel() {
      events.push("excel:start");
      await excelReady;
      events.push("excel:ready");
    },
    async prepareFont() {
      events.push("font");
    },
  });

  await Promise.resolve();
  assert.deepEqual(events, ["excel:start"]);
  releaseExcel();
  await priority.readyForParsing;
  await priority.fullyPrepared;
  assert.deepEqual(events, ["excel:start", "excel:ready", "font"]);
});

test("spreadsheet import retries after a transient failure", async () => {
  let imports = 0;
  const parser = createSpreadsheetParser(async () => {
    imports += 1;
    if (imports === 1) {
      throw new Error("temporary failure");
    }
    return {
      parseSpreadsheet() {
        return { rows: [["ok"]], errors: [], sheetName: "Sheet1" };
      },
    };
  });

  await assert.rejects(parser.prepare(), /temporary failure/u);
  await parser.prepare();
  assert.equal(imports, 2);
  assert.deepEqual(await parser.parse(new Uint8Array(), 1), {
    rows: [["ok"]],
    errors: [],
    sheetName: "Sheet1",
  });
});
