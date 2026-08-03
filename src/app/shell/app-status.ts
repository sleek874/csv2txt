import { requireElement } from "../../browser/dom";

export interface AppStatus {
  announce(message: string): void;
}

export function createAppStatus(): AppStatus {
  const region = requireElement<HTMLElement>("#app-status");
  return {
    announce(message) {
      region.textContent = message;
    },
  };
}
