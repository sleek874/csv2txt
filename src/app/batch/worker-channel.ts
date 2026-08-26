import type {
  BatchRequest,
  BatchRequestMessage,
  BatchResponseValue,
  BatchWorkerMessage,
  OutputProgress,
  ProcessingProgress,
} from "./protocol";

export class WorkerInterruptedError extends Error {}

export interface WorkerChannel {
  request<T extends BatchResponseValue>(request: BatchRequest, transfer?: Transferable[], onOutputProgress?: (progress: OutputProgress) => void): Promise<T>;
  simulate(fault: "error" | "fatal" | "msgerr"): void;
  stop(error: Error): void;
}

interface WorkerChannelOptions {
  onFault(channel: WorkerChannel, error: Error): void;
  onProgress(progress: ProcessingProgress): void;
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function createWorkerChannel(options: WorkerChannelOptions): WorkerChannel {
  const worker = new Worker(new URL("./batch-worker.ts", import.meta.url), { type: "module" });
  const pending = new Map<number, {
    onOutputProgress?: (progress: OutputProgress) => void;
    reject(error: Error): void;
    resolve(value: BatchResponseValue): void;
  }>();
  let nextRequestId = 1;
  let stopped = false;

  function fault(error: Error): void {
    if (!stopped) options.onFault(channel, error);
  }

  const channel: WorkerChannel = {
    request<T extends BatchResponseValue>(request: BatchRequest, transfer: Transferable[] = [], onOutputProgress?: (progress: OutputProgress) => void): Promise<T> {
      if (stopped) return Promise.reject(new WorkerInterruptedError("背景處理已中斷。"));
      const requestId = nextRequestId++;
      return new Promise<T>((resolve, reject) => {
        pending.set(requestId, {
          onOutputProgress,
          reject,
          resolve: (value) => resolve(value as T),
        });
        try {
          worker.postMessage({ requestId, request } satisfies BatchRequestMessage, transfer);
        } catch (error) {
          fault(new Error(message(error, "無法傳送背景處理要求。")));
        }
      });
    },
    simulate(kind) {
      worker.dispatchEvent(kind === "fatal"
        ? new MessageEvent<BatchWorkerMessage>("message", {
          data: { type: "fatal", message: "Synthetic worker failure" },
        })
        : new Event(kind === "msgerr" ? "messageerror" : "error", { cancelable: true }));
    },
    stop(error) {
      if (stopped) return;
      stopped = true;
      worker.terminate();
      pending.forEach(({ reject }) => reject(error));
      pending.clear();
    },
  };

  worker.addEventListener("message", (event: MessageEvent<BatchWorkerMessage>) => {
    if (stopped) return;
    const response = event.data;
    if (response.type === "progress") {
      options.onProgress(response);
      return;
    }
    if (response.type === "fatal") {
      fault(new Error(response.message));
      return;
    }
    if (response.type === "output-progress") {
      const { type: _type, requestId, ...progress } = response;
      pending.get(requestId)?.onOutputProgress?.(progress);
      return;
    }
    const request = pending.get(response.requestId);
    if (!request) return;
    pending.delete(response.requestId);
    if (response.type === "error") request.reject(new Error(response.message));
    else request.resolve(response.value);
  });
  worker.addEventListener("error", (event: ErrorEvent) => {
    event.preventDefault();
    fault(new Error(message(event.error, event.message || "背景處理發生錯誤。")));
  });
  worker.addEventListener("messageerror", () => fault(new Error("無法讀取背景處理結果。")));

  return channel;
}
