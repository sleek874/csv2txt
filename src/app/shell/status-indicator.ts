import { createStateTransition } from "./state-transition";

export type StatusIndicatorTone = "neutral" | "info" | "success" | "warning" | "error";

export interface StatusIndicator {
  set(options: { loading?: boolean; text: string; tone: StatusIndicatorTone }): void;
}

export function createStatusIndicator(root: HTMLElement): StatusIndicator {
  const text = root.querySelector<HTMLElement>(".status-indicator__text");
  if (!text) {
    throw new Error("找不到 status indicator 文字元素。");
  }
  const transition = createStateTransition(root);
  return {
    set(options) {
      root.dataset.tone = options.tone;
      root.dataset.loading = String(options.loading ?? false);
      text.textContent = options.text;
      transition.update(`${options.tone}:${String(options.loading ?? false)}:${options.text}`);
    },
  };
}
