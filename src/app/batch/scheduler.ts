import type { ProcessingProgress } from "./protocol";

const PROGRESS_INTERVAL_MS = 100;

export function createProgressScheduler(
  publish: (progress: ProcessingProgress) => void,
) {
  let lastPublishedAt = 0;
  return {
    publish(progress: ProcessingProgress, force = false): void {
      const now = Date.now();
      if (!force && now - lastPublishedAt < PROGRESS_INTERVAL_MS) return;
      lastPublishedAt = now;
      publish(progress);
    },
  };
}

export function yieldToWorker(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
