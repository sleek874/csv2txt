/// <reference lib="webworker" />

import { createBatchEngine } from "./batch-engine";
import type { BatchRequestMessage, BatchWorkerMessage, OutputProgress } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const engine = createBatchEngine((progress) => {
  scope.postMessage({ type: "progress", ...progress } satisfies BatchWorkerMessage);
});

function reportFatal(error: unknown): void {
  try {
    scope.postMessage({
      type: "fatal",
      message: error instanceof Error ? error.message : String(error),
    } satisfies BatchWorkerMessage);
  } catch {
    scope.close();
  }
}

scope.addEventListener("error", (event) => {
  event.preventDefault();
  reportFatal(event.error ?? event.message);
});

scope.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  reportFatal(event.reason);
});

scope.addEventListener("message", (event: MessageEvent<BatchRequestMessage>) => {
  const { requestId, request } = event.data;
  const reportOutputProgress = (progress: OutputProgress) => {
    scope.postMessage({ type: "output-progress", requestId, ...progress } satisfies BatchWorkerMessage);
  };
  void engine.handle(request, reportOutputProgress).then((value) => {
    const message = { type: "response", requestId, value } satisfies BatchWorkerMessage;
    scope.postMessage(message);
  }).catch((error: unknown) => {
    try {
      scope.postMessage({
        type: "error",
        requestId,
        message: error instanceof Error ? error.message : "背景處理失敗，請重新加入檔案。",
      } satisfies BatchWorkerMessage);
    } catch (postError) {
      reportFatal(postError);
    }
  });
});
