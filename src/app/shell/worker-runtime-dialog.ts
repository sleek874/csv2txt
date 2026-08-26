import type { BatchClient, BatchRuntime } from "../batch/batch-client";
import { requireDescendant, requireElement } from "../../browser/dom";
import { createActionDetails } from "./action-details";
import { createDeferredFeedback } from "./deferred-feedback";

export function bindWorkerRuntimeDialog(batchClient: BatchClient): void {
  const app = requireElement<HTMLElement>("#app");
  const content = requireElement<HTMLElement>("#app-content");
  const dialog = requireElement<HTMLDialogElement>("#worker-runtime-dialog");
  const title = requireDescendant<HTMLElement>(dialog, "#worker-runtime-title");
  const spinner = requireDescendant<HTMLElement>(dialog, "#worker-runtime-spinner");
  const details = requireDescendant<HTMLDetailsElement>(dialog, "#worker-runtime-details");
  const error = requireDescendant<HTMLElement>(dialog, "#worker-runtime-error");
  const actionDetails = createActionDetails(details);
  const reload = requireDescendant<HTMLButtonElement>(dialog, "#worker-runtime-reload");
  const feedback = createDeferredFeedback();
  let current = batchClient.runtime();
  let visible = false;
  let returnFocus: HTMLElement | null = null;

  function lock(locked: boolean): void {
    if (locked) {
      content.dataset.runtimeLocked = "true";
      content.inert = true;
      app.setAttribute("aria-busy", "true");
    } else if (content.dataset.runtimeLocked) {
      delete content.dataset.runtimeLocked;
      content.inert = false;
      app.removeAttribute("aria-busy");
    }
  }

  function show(runtime: Exclude<BatchRuntime, { state: "ready" }>): void {
    visible = true;
    title.textContent = runtime.state === "failed" ? "無法處理背景資料" : "正在處理背景資料";
    spinner.hidden = runtime.state === "failed";
    dialog.dataset.tone = runtime.state === "failed" ? "error" : "neutral";
    error.textContent = runtime.error;
    actionDetails.show("查看詳細資料", "error", error);
    if (!dialog.open) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      reload.focus({ preventScroll: true });
    }
  }

  function render(runtime: BatchRuntime): void {
    current = runtime;
    feedback.cancel();
    lock(runtime.state !== "ready");
    if (runtime.state === "ready") {
      visible = false;
      if (dialog.open) dialog.close();
      returnFocus?.focus({ preventScroll: true });
      returnFocus = null;
      return;
    }
    if (runtime.state === "recovering" && runtime.notice === "silent") {
      visible = false;
      if (dialog.open) dialog.close();
      return;
    }
    if (runtime.state === "failed" || visible) {
      show(runtime);
      return;
    }
    feedback.show(() => {
      if (current.state !== "ready") show(current);
    });
  }

  dialog.addEventListener("cancel", (event) => event.preventDefault());
  reload.addEventListener("click", () => window.location.reload());
  batchClient.subscribeRuntime(render);
  render(current);
}
