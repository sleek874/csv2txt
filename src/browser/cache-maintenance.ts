export type CacheMaintenanceState =
  | "development"
  | "unsupported"
  | "ready"
  | "refreshing"
  | "error";

interface CacheMaintenanceOptions {
  baseUrl: string;
  cachePrefix: string;
  production: boolean;
  onStateChange: (state: CacheMaintenanceState) => void;
}

export function createCacheMaintenance(options: CacheMaintenanceOptions) {
  let refreshing = false;

  async function enableOfflineUse(): Promise<void> {
    if (!options.production) {
      options.onStateChange("development");
      return;
    }
    if (!("serviceWorker" in navigator)) {
      options.onStateChange("unsupported");
      return;
    }

    try {
      await navigator.serviceWorker.register(`${options.baseUrl}sw.js`, {
        scope: options.baseUrl,
        updateViaCache: "none",
      });
      await navigator.serviceWorker.ready;
      options.onStateChange("ready");
    } catch {
      options.onStateChange("error");
    }
  }

  async function refresh(): Promise<void> {
    if (refreshing) {
      return;
    }

    refreshing = true;
    options.onStateChange("refreshing");

    try {
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(
          names
            .filter((name) => name.startsWith(options.cachePrefix))
            .map((name) => caches.delete(name)),
        );
      }

      if ("serviceWorker" in navigator) {
        const scope = new URL(options.baseUrl, window.location.href).href;
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations
            .filter((registration) => registration.scope === scope)
            .map((registration) => registration.unregister()),
        );
      }

      const freshUrl = new URL(window.location.href);
      freshUrl.searchParams.set("force-refresh", Date.now().toString());
      window.location.replace(freshUrl);
    } catch (error) {
      refreshing = false;
      options.onStateChange("error");
      throw error;
    }
  }

  return { enableOfflineUse, refresh };
}
