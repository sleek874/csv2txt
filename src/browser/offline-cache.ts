export type OfflineCacheState =
  | "development"
  | "unsupported"
  | "preparing"
  | "ready"
  | "error";

interface OfflineCacheOptions {
  baseUrl: string;
  production: boolean;
  onStateChange: (state: OfflineCacheState) => void;
}

interface OfflinePreparationResult {
  ok: boolean;
}

const PREVIEW_FONT = '400 1em "Sarasa Mono TC"';

function runWhenIdle(task: () => void): void {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(task, { timeout: 2_000 });
    return;
  }

  window.setTimeout(task, 1_000);
}

function prepareOfflineFont(worker: ServiceWorker): Promise<void> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();

    channel.port1.onmessage = (event: MessageEvent<OfflinePreparationResult>) => {
      channel.port1.close();
      if (event.data.ok) {
        resolve();
      } else {
        reject(new Error("離線字型準備失敗。"));
      }
    };
    channel.port1.onmessageerror = () => {
      channel.port1.close();
      reject(new Error("無法確認離線字型狀態。"));
    };

    worker.postMessage({ type: "PREPARE_OFFLINE" }, [channel.port2]);
  });
}

async function activatePreviewFont(worker: ServiceWorker): Promise<void> {
  await prepareOfflineFont(worker);
  const loadedFonts = await document.fonts.load(PREVIEW_FONT);
  if (loadedFonts.length === 0) {
    throw new Error("無法載入預覽字型。");
  }
}

export function createOfflineCache(options: OfflineCacheOptions) {
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

      runWhenIdle(() => {
        const worker = readyRegistration.active;
        if (!worker) {
          options.onStateChange("error");
          return;
        }

        void activatePreviewFont(worker)
          .then(() => options.onStateChange("ready"))
          .catch(() => options.onStateChange("error"));
      });
    } catch {
      options.onStateChange("error");
    }
  }

  return { prepareOfflineUse };
}
