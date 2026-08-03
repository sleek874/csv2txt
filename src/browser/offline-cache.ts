export type OfflineCacheState =
  | "development"
  | "unsupported"
  | "preparing"
  | "ready"
  | "error";

export interface OfflineCache {
  prepareOfflineUse(): Promise<void>;
  prioritizePreviewFont(): Promise<void>;
}

interface OfflineCacheOptions {
  baseUrl: string;
  production: boolean;
  onStateChange: (state: OfflineCacheState) => void;
}

interface OfflinePreparationResult {
  ok: boolean;
}

interface OfflinePreparationRequest {
  includeArchive: boolean;
  includeExcel: boolean;
  type: "PREPARE_RESOURCES";
}

const PREVIEW_FONT = '400 1em "Sarasa Mono TC"';
const IDLE_PREPARATION_DELAY_MS = 1_500;

function runWhenIdle(task: () => void): void {
  window.setTimeout(() => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(task, { timeout: 4_000 });
      return;
    }
    task();
  }, IDLE_PREPARATION_DELAY_MS);
}

function requestPreparation(
  worker: ServiceWorker,
  includeExcel: boolean,
  includeArchive: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();

    channel.port1.onmessage = (event: MessageEvent<OfflinePreparationResult>) => {
      channel.port1.close();
      if (event.data.ok) {
        resolve();
      } else {
        reject(new Error("離線資源準備失敗。"));
      }
    };
    channel.port1.onmessageerror = () => {
      channel.port1.close();
      reject(new Error("無法確認離線資源狀態。"));
    };

    const request: OfflinePreparationRequest = {
      includeArchive,
      includeExcel,
      type: "PREPARE_RESOURCES",
    };
    worker.postMessage(request, [channel.port2]);
  });
}

async function loadPreviewFont(): Promise<void> {
  await import("../styles/preview-font.css");
  const loadedFonts = await document.fonts.load(PREVIEW_FONT);
  if (loadedFonts.length === 0) {
    throw new Error("無法載入預覽字型。");
  }
}

async function activatePreviewFont(
  worker: ServiceWorker,
  includeExcel: boolean,
  includeArchive: boolean,
): Promise<void> {
  await requestPreparation(worker, includeExcel, includeArchive);
  await loadPreviewFont();
}

export function createOfflineCache(options: OfflineCacheOptions) {
  let workerPromise: Promise<ServiceWorker | null> | null = null;

  function prepareWorker(): Promise<ServiceWorker | null> {
    workerPromise ??= (async () => {
      if (!options.production || !("serviceWorker" in navigator)) {
        return null;
      }

      const scope = new URL(options.baseUrl, window.location.href).href;
      const existingRegistration = await navigator.serviceWorker.getRegistration(scope);
      const registration = existingRegistration
        ?? await navigator.serviceWorker.register(`${options.baseUrl}sw.js`, {
          scope: options.baseUrl,
          updateViaCache: "none",
        });
      const readyRegistration = await navigator.serviceWorker.ready;

      if (existingRegistration) {
        void registration.update().catch(() => {
          // Keep the current offline version when an update check cannot reach the network.
        });
      }

      return readyRegistration.active;
    })().catch((error: unknown) => {
      workerPromise = null;
      throw error;
    });
    return workerPromise;
  }

  async function prepareOfflineUse(): Promise<void> {
    if (!options.production) {
      options.onStateChange("development");
      return;
    }
    if (!("serviceWorker" in navigator)) {
      options.onStateChange("unsupported");
      return;
    }

    options.onStateChange("preparing");

    try {
      const worker = await prepareWorker();

      runWhenIdle(() => {
        if (!worker) {
          options.onStateChange("error");
          return;
        }

        void activatePreviewFont(worker, true, true)
          .then(() => options.onStateChange("ready"))
          .catch(() => options.onStateChange("error"));
      });
    } catch {
      options.onStateChange("error");
    }
  }

  async function prioritizePreviewFont(): Promise<void> {
    if (!options.production) {
      await loadPreviewFont();
      return;
    }

    try {
      const worker = await prepareWorker();
      if (worker) {
        await activatePreviewFont(worker, false, false);
      } else {
        await loadPreviewFont();
      }
    } catch {
      // The system monospace fallback remains usable while offline preparation retries.
    }
  }

  return { prepareOfflineUse, prioritizePreviewFont };
}
