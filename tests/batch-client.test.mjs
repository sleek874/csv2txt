import assert from "node:assert/strict";
import test from "node:test";

import { createBatchClient } from "../src/app/batch/batch-client.ts";

test("worker transport failures reject requests and replace an unreadable worker", async () => {
  const originalWorker = globalThis.Worker;
  const instances = [];

  class MockWorker extends EventTarget {
    messages = [];
    terminated = false;
    postError = null;

    constructor() {
      super();
      instances.push(this);
    }

    postMessage(message) {
      if (this.postError) throw this.postError;
      this.messages.push(message);
    }

    terminate() {
      this.terminated = true;
    }
  }

  globalThis.Worker = MockWorker;
  try {
    const client = createBatchClient();
    const failed = client.clearReference();
    instances[0].dispatchEvent(new Event("messageerror"));
    await assert.rejects(failed, /無法讀取背景處理結果/u);
    assert.equal(instances[0].terminated, true);

    const recovered = client.clearReference();
    assert.equal(instances.length, 2);
    const requestId = instances[1].messages[0].requestId;
    instances[1].dispatchEvent(new MessageEvent("message", {
      data: { type: "response", requestId, value: null },
    }));
    await recovered;

    instances[1].postError = new Error("synthetic post failure");
    await assert.rejects(client.clearReference(), /synthetic post failure/u);
  } finally {
    globalThis.Worker = originalWorker;
  }
});
