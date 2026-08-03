import { requireElement } from "../../browser/dom";
import type { OfflineCacheState } from "../../browser/offline-cache";
import { createStatusIndicator } from "./status-indicator";

export interface ReadinessView {
  render(state: OfflineCacheState): void;
}

export function createReadinessView(): ReadinessView {
  const indicator = createStatusIndicator(requireElement<HTMLElement>("#readiness-status"));
  return {
    render(state) {
      const presentations = {
        development: { loading: false, text: "開發模式", tone: "neutral" },
        unsupported: { loading: false, text: "需連線使用", tone: "warning" },
        preparing: { loading: true, text: "準備離線使用", tone: "info" },
        ready: { loading: false, text: "已可離線使用", tone: "success" },
        error: { loading: false, text: "需連線使用", tone: "warning" },
      } as const;
      indicator.set(presentations[state]);
    },
  };
}
