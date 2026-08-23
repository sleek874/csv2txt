/// <reference lib="webworker" />

import { createBatchEngine } from "./batch-engine";
import type { BatchRequestMessage, BatchWorkerMessage } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const engine = createBatchEngine((progress) => {
  scope.postMessage({ type: "progress", ...progress } satisfies BatchWorkerMessage);
});

scope.addEventListener("message", (event: MessageEvent<BatchRequestMessage>) => {
  const { requestId, request } = event.data;
  void engine.handle(request).then((value) => {
    const message = { type: "response", requestId, value } satisfies BatchWorkerMessage;
    scope.postMessage(message);
  }).catch((error: unknown) => {
    scope.postMessage({
      type: "error",
      requestId,
      message: error instanceof Error ? error.message : "背景處理失敗，請重新加入檔案。",
    } satisfies BatchWorkerMessage);
  });
});
