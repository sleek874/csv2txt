export interface UnloadGuard {
  setPendingFile(pending: boolean, owner?: string): void;
}

export function createUnloadGuard(): UnloadGuard {
  const pendingOwners = new Set<string>();

  function handleBeforeUnload(event: BeforeUnloadEvent): void {
    event.preventDefault();
    event.returnValue = "";
  }

  function syncBeforeUnload(): void {
    if (pendingOwners.size > 0) {
      window.addEventListener("beforeunload", handleBeforeUnload);
    } else {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    }
  }

  function setPendingFile(pending: boolean, owner = "default"): void {
    if (pending) pendingOwners.add(owner);
    else pendingOwners.delete(owner);
    syncBeforeUnload();
  }

  return { setPendingFile };
}
