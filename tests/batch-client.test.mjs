import assert from "node:assert/strict";
import test from "node:test";

import { ActionInterruptedError, createBatchClient } from "../src/app/batch/batch-client.ts";

function workspaceRecord() {
  return {
    blockingOutputIssues: [], fileIssueMessages: [], id: "entry", outputFormat: "big5-txt",
    outputReplacementRows: 0, selectionRevision: 0,
    summary: {
      blankRows: 0, correctRows: 1, dataRows: 1, errorRows: 0, includedRows: 1,
      rejectedRows: 0, sourceRecords: 1, warningRows: 0,
    },
    virtualPath: "source.csv",
  };
}

const processed = {
  entries: [{
    file: workspaceRecord(), id: "entry", relativePath: "source.csv", size: 3,
    sourceFormat: "csv", virtualPath: "source.csv",
  }],
  skippedEntries: [],
};

function installWorkerMock({ failStarts = 0 } = {}) {
  const originalWorker = globalThis.Worker;
  const instances = [];
  let remainingStartFailures = failStarts;
  class MockWorker extends EventTarget {
    messages = [];
    terminated = false;
    constructor() {
      super();
      if (remainingStartFailures > 0) {
        remainingStartFailures -= 1;
        throw new Error("Synthetic worker start failure");
      }
      instances.push(this);
    }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = MockWorker;
  return { instances, restore() { globalThis.Worker = originalWorker; } };
}

function nextRequest(worker, type) {
  const message = worker.messages.find((candidate) => !candidate.responded && candidate.request.type === type);
  assert.ok(message, `expected ${type} request`);
  message.responded = true;
  return message;
}

function respond(worker, type, value) {
  const message = nextRequest(worker, type);
  worker.dispatchEvent(new MessageEvent("message", {
    data: { type: "response", requestId: message.requestId, value },
  }));
}

async function waitForRequest(worker, type) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const message = worker.messages.find((candidate) => !candidate.responded && candidate.request.type === type);
    if (message) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`timed out waiting for ${type} request`);
}

async function waitForWorker(instances, index) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (instances[index]) return instances[index];
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`timed out waiting for worker ${index}`);
}

test("idle request faults rebuild the journal and broadcast recovery without replaying the request", async () => {
  const mock = installWorkerMock();
  try {
    const client = createBatchClient();
    const states = [];
    let recovered = 0;
    client.subscribeRuntime((state) => states.push(state));
    client.subscribeRecovered(() => { recovered += 1; });
    let reads = 0;
    const sourceFile = {
      name: "source.csv", size: 3,
      async arrayBuffer() { reads += 1; return Uint8Array.from([1, 2, 3]).buffer; },
    };

    const source = client.processSource({
      sourceId: "source", sourceName: "source.csv", sourceFile, inputType: "csv",
      bytes: Uint8Array.from([1, 2, 3]), today: "2026-08-24", existingPaths: [],
      outputFormat: "big5-txt",
    });
    const firstWorker = await waitForWorker(mock.instances, 0);
    await waitForRequest(firstWorker, "process-source");
    respond(firstWorker, "process-source", processed);
    await source;
    const exclude = client.setRowIncluded("entry", 4, false, "big5-txt");
    await waitForRequest(firstWorker, "set-row-included");
    respond(firstWorker, "set-row-included", workspaceRecord());
    await exclude;

    const preview = client.getPreviewPage("entry", "all", 0, "big5-txt");
    const interrupted = assert.rejects(preview, /背景處理已中斷/u);
    await waitForRequest(firstWorker, "preview-page");
    const recovery = client.simulateWorkerFault("msgerr");
    assert.equal(firstWorker.terminated, true);
    assert.deepEqual(states, [{
      state: "recovering", error: "無法讀取背景處理結果。", notice: "dialog",
    }]);

    const secondWorker = await waitForWorker(mock.instances, 1);
    await waitForRequest(secondWorker, "ping");
    respond(secondWorker, "ping", null);
    await waitForRequest(secondWorker, "process-source");
    respond(secondWorker, "process-source", processed);
    await waitForRequest(secondWorker, "set-rows-included");
    const replaySelection = nextRequest(secondWorker, "set-rows-included");
    assert.deepEqual(replaySelection.request.sourceRows, [4]);
    secondWorker.dispatchEvent(new MessageEvent("message", {
      data: { type: "response", requestId: replaySelection.requestId, value: workspaceRecord() },
    }));
    await interrupted;
    assert.equal(await recovery, "ready");
    assert.equal(recovered, 1);
    assert.equal(reads, 1, "recovery rereads the retained top-level file once");
    assert.deepEqual(states, [
      { state: "recovering", error: "無法讀取背景處理結果。", notice: "dialog" },
      { state: "ready", error: null },
    ]);
  } finally {
    mock.restore();
  }
});

test("a worker start failure enters recovery instead of escaping the runtime", async () => {
  const mock = installWorkerMock({ failStarts: 1 });
  try {
    const client = createBatchClient();
    const preview = client.getPreviewPage("entry", "all", 0, "big5-txt");
    await assert.rejects(preview, /Synthetic worker start failure/u);
    assert.deepEqual(client.runtime(), {
      state: "recovering", error: "Synthetic worker start failure", notice: "dialog",
    });
    const worker = await waitForWorker(mock.instances, 0);
    respond(worker, "ping", null);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(client.runtime(), { state: "ready", error: null });
  } finally {
    mock.restore();
  }
});

test("workspace mutation invalidates active output and asks the worker to stop", async () => {
  const mock = installWorkerMock();
  try {
    const client = createBatchClient();
    let invalidations = 0;
    client.subscribeOutputInvalidation(() => { invalidations += 1; });

    const output = client.createOutput(["entry"], "csv");
    const worker = await waitForWorker(mock.instances, 0);
    await waitForRequest(worker, "create-output");
    client.invalidateOutput();

    assert.equal(invalidations, 1);
    assert.equal(worker.messages[0].request.type, "create-output");
    assert.equal(worker.messages[1].request.type, "cancel-output");
    const create = nextRequest(worker, "create-output");
    worker.dispatchEvent(new MessageEvent("message", {
      data: { type: "error", requestId: create.requestId, message: "已取消建立下載。" },
    }));
    await assert.rejects(output, /已取消建立下載/u);
  } finally {
    mock.restore();
  }
});

test("output progress is delivered only to its request callback", async () => {
  const mock = installWorkerMock();
  try {
    const client = createBatchClient();
    const progress = [];
    const output = client.createOutput(["entry"], "csv", (value) => progress.push(value));
    const worker = await waitForWorker(mock.instances, 0);
    await waitForRequest(worker, "create-output");
    const create = nextRequest(worker, "create-output");
    worker.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "output-progress", requestId: create.requestId,
        current: 0, phase: "processing", total: 1, virtualPath: "source.csv",
      },
    }));
    worker.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "output-progress", requestId: create.requestId + 1,
        current: 1, phase: "finalizing", total: 1, virtualPath: "wrong.csv",
      },
    }));
    worker.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "response", requestId: create.requestId,
        value: { blob: new Blob(["result"]), filename: "result.csv" },
      },
    }));

    assert.equal((await output).filename, "result.csv");
    assert.deepEqual(progress, [
      { current: 0, phase: "processing", total: 1, virtualPath: "source.csv" },
    ]);
  } finally {
    mock.restore();
  }
});

test("an interrupted source silently recovers and retries from its retained File", async () => {
  const mock = installWorkerMock();
  try {
    const client = createBatchClient();
    const states = [];
    client.subscribeRuntime((state) => states.push(state));
    let reads = 0;
    const sourceFile = {
      name: "source.csv", size: 3,
      async arrayBuffer() { reads += 1; return Uint8Array.from([1, 2, 3]).buffer; },
    };
    const source = client.processSource({
      sourceId: "source", sourceName: "source.csv", sourceFile, inputType: "csv",
      bytes: Uint8Array.from([1, 2, 3]), today: "2026-08-24", existingPaths: [],
      outputFormat: "big5-txt",
    });
    const firstWorker = await waitForWorker(mock.instances, 0);
    await waitForRequest(firstWorker, "process-source");
    const recovery = client.simulateWorkerFault("msgerr");
    assert.deepEqual(states, [{
      state: "recovering", error: "無法讀取背景處理結果。", notice: "silent",
    }]);

    const secondWorker = await waitForWorker(mock.instances, 1);
    respond(secondWorker, "ping", null);
    await waitForRequest(secondWorker, "process-source");
    respond(secondWorker, "process-source", processed);

    assert.equal((await source).entries[0]?.id, "entry");
    assert.equal(await recovery, "ready");
    assert.equal(reads, 1);
  } finally {
    mock.restore();
  }
});

test("an interrupted optimistic removal is completed by journal replay", async () => {
  const mock = installWorkerMock();
  try {
    const client = createBatchClient();
    const source = client.processSource({
      sourceId: "source", sourceName: "source.csv",
      sourceFile: { async arrayBuffer() { return Uint8Array.from([1, 2, 3]).buffer; } },
      inputType: "csv", bytes: Uint8Array.from([1, 2, 3]), today: "2026-08-24",
      existingPaths: [], outputFormat: "big5-txt",
    });
    const firstWorker = await waitForWorker(mock.instances, 0);
    await waitForRequest(firstWorker, "process-source");
    respond(firstWorker, "process-source", processed);
    await source;

    const removal = client.removeFiles(["entry"]);
    await waitForRequest(firstWorker, "remove-files");
    const recovery = client.simulateWorkerFault("msgerr");
    const secondWorker = await waitForWorker(mock.instances, 1);
    respond(secondWorker, "ping", null);
    await waitForRequest(secondWorker, "process-source");
    respond(secondWorker, "process-source", processed);
    await waitForRequest(secondWorker, "remove-files");
    respond(secondWorker, "remove-files", null);

    await removal;
    assert.equal(await recovery, "ready");
  } finally {
    mock.restore();
  }
});

test("an interrupted download recovers silently and retries once", async () => {
  const mock = installWorkerMock();
  try {
    const client = createBatchClient();
    const progress = [];
    const output = client.createOutput(["entry"], "csv", (value) => progress.push(value));
    const firstWorker = await waitForWorker(mock.instances, 0);
    await waitForRequest(firstWorker, "create-output");
    const first = nextRequest(firstWorker, "create-output");
    firstWorker.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "output-progress", requestId: first.requestId,
        current: 1, phase: "processing", total: 2, virtualPath: "one.csv",
      },
    }));
    const recovery = client.simulateWorkerFault("msgerr");
    const secondWorker = await waitForWorker(mock.instances, 1);
    respond(secondWorker, "ping", null);
    await waitForRequest(secondWorker, "create-output");
    const retried = nextRequest(secondWorker, "create-output");
    secondWorker.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "output-progress", requestId: retried.requestId,
        current: 0, phase: "processing", total: 2, virtualPath: "one.csv",
      },
    }));
    secondWorker.dispatchEvent(new MessageEvent("message", {
      data: {
        type: "response", requestId: retried.requestId,
        value: { blob: new Blob(["result"]), filename: "result.csv" },
      },
    }));

    assert.equal((await output).filename, "result.csv");
    assert.equal(await recovery, "ready");
    assert.deepEqual(progress.map(({ current, total }) => [current, total]), [[1, 2], [0, 2]]);
  } finally {
    mock.restore();
  }
});

test("a second interrupted attempt fails only the action after recovery", async () => {
  const mock = installWorkerMock();
  try {
    const client = createBatchClient();
    const output = client.createOutput(["entry"], "csv");
    const firstWorker = await waitForWorker(mock.instances, 0);
    await waitForRequest(firstWorker, "create-output");
    const firstRecovery = client.simulateWorkerFault("msgerr");
    const secondWorker = await waitForWorker(mock.instances, 1);
    respond(secondWorker, "ping", null);
    await waitForRequest(secondWorker, "create-output");
    assert.equal(await firstRecovery, "ready");

    const secondRecovery = client.simulateWorkerFault("msgerr");
    const thirdWorker = await waitForWorker(mock.instances, 2);
    respond(thirdWorker, "ping", null);
    await assert.rejects(output, (error) => (
      error instanceof ActionInterruptedError
      && error.message === "這項操作在自動重試後再次中斷。"
    ));
    assert.equal(await secondRecovery, "ready");
    assert.deepEqual(client.runtime(), { state: "ready", error: null });
  } finally {
    mock.restore();
  }
});

for (const fault of ["error"]) {
  test(`development fault ${fault} reaches the shared recovery path`, async () => {
    const mock = installWorkerMock();
    try {
      const client = createBatchClient();
      const recovery = client.simulateWorkerFault(fault);
      const nextWorker = await waitForWorker(mock.instances, 1);
      respond(nextWorker, "ping", null);
      assert.equal(await recovery, "ready");
      assert.equal(mock.instances[0].terminated, true);
    } finally {
      mock.restore();
    }
  });
}

test("a second fault publishes the captured fatal detail", async () => {
  const mock = installWorkerMock();
  try {
    const client = createBatchClient();
    const recovering = client.simulateWorkerFault("msgerr");
    await waitForWorker(mock.instances, 1);
    const failed = client.simulateWorkerFault("fatal");

    assert.equal(await recovering, "failed");
    assert.equal(await failed, "failed");
    assert.deepEqual(client.runtime(), {
      state: "failed",
      error: "Synthetic worker failure",
    });
  } finally {
    mock.restore();
  }
});

test("development fatal forces the failed runtime", async () => {
  const mock = installWorkerMock();
  try {
    const client = createBatchClient();
    assert.equal(await client.simulateWorkerFault("fatal"), "failed");
    assert.deepEqual(client.runtime(), { state: "failed", error: "Synthetic worker failure" });
  } finally {
    mock.restore();
  }
});
