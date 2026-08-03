import assert from "node:assert/strict";
import test from "node:test";

import { createCodecManager } from "../src/app/resources/codec-manager.ts";
import { prepareSourceResources } from "../src/app/resources/resource-policy.ts";

test("source parsing waits for its codec and then prepares the font", async () => {
  const events = [];
  let releaseCodec;
  const codecReady = new Promise((resolve) => { releaseCodec = resolve; });
  const preparation = prepareSourceResources("xlsx", {
    codecs: {
      async prepareSource() {
        events.push("codec:start");
        await codecReady;
        events.push("codec:ready");
      },
    },
    async prepareFont() {
      events.push("font");
    },
  });

  await Promise.resolve();
  assert.deepEqual(events, ["codec:start"]);
  releaseCodec();
  await preparation.readyForParsing;
  await preparation.fullyPrepared;
  assert.deepEqual(events, ["codec:start", "codec:ready", "font"]);
});

test("codec manager retries a transient spreadsheet import failure", async () => {
  let imports = 0;
  const manager = createCodecManager({
    async spreadsheet() {
      imports += 1;
      if (imports === 1) throw new Error("temporary failure");
      return {
        parseSpreadsheet() {
          return { rows: [["ok"]], errors: [], sheetName: "Sheet1" };
        },
      };
    },
  });

  await assert.rejects(manager.prepareSource("xlsx"), /temporary failure/u);
  await manager.prepareSource("xlsx");
  assert.equal(imports, 2);
  assert.deepEqual((await manager.spreadsheet()).parseSpreadsheet(new Uint8Array(), 1), {
    rows: [["ok"]],
    errors: [],
    sheetName: "Sheet1",
  });
});

test("CSV and Big5 codecs share the same managed prepare/get contract", async () => {
  const manager = createCodecManager();
  await Promise.all([manager.prepareOutput("csv"), manager.prepareOutput("big5-txt")]);
  assert.equal(typeof (await manager.csv()).serializeCsv, "function");
  assert.equal(typeof (await manager.big5Txt()).serializeBig5Txt, "function");
});
