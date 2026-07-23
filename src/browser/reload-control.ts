interface ReloadControlOptions {
  confirmMessage: string;
  onConfirmedReload: () => Promise<void>;
}

export function wasBrowserReload(): boolean {
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return entry?.type === "reload";
}

export function createReloadControl(options: ReloadControlOptions) {
  let hasPendingFile = false;
  let reloading = false;

  function handleBeforeUnload(event: BeforeUnloadEvent): void {
    event.preventDefault();
    event.returnValue = options.confirmMessage;
  }

  function syncBeforeUnload(): void {
    if (hasPendingFile && !reloading) {
      window.addEventListener("beforeunload", handleBeforeUnload);
    } else {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    }
  }

  function setPendingFile(pending: boolean): void {
    hasPendingFile = pending;
    syncBeforeUnload();
  }

  async function requestReload(): Promise<void> {
    if (reloading) {
      return;
    }
    if (hasPendingFile && !window.confirm(options.confirmMessage)) {
      return;
    }

    reloading = true;
    syncBeforeUnload();
    try {
      await options.onConfirmedReload();
    } catch {
      reloading = false;
      syncBeforeUnload();
    }
  }

  window.addEventListener("keydown", (event) => {
    const isRefresh = event.key === "F5"
      || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r");
    if (!isRefresh) {
      return;
    }

    event.preventDefault();
    void requestReload();
  });

  return { requestReload, setPendingFile };
}
