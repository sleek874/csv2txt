export interface UnloadGuard {
  setPendingFile(pending: boolean): void;
}

export function createUnloadGuard(): UnloadGuard {
  let hasPendingFile = false;

  function handleBeforeUnload(event: BeforeUnloadEvent): void {
    event.preventDefault();
    event.returnValue = "";
  }

  function syncBeforeUnload(): void {
    if (hasPendingFile) {
      window.addEventListener("beforeunload", handleBeforeUnload);
    } else {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    }
  }

  function setPendingFile(pending: boolean): void {
    hasPendingFile = pending;
    syncBeforeUnload();
  }

  return { setPendingFile };
}
