import { requireDescendant } from "../../browser/dom";

export type ActionDetailsTone = "error" | "warning";

export interface ActionDetails {
  hide(): void;
  show(label: string, tone: ActionDetailsTone, ...content: Node[]): void;
}

const floatingDetails = new Set<HTMLDetailsElement>();
let documentBound = false;

function close(details: HTMLDetailsElement, restoreFocus = false): void {
  if (!details.open) return;
  details.open = false;
  if (restoreFocus) details.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
}

function bindFloating(details: HTMLDetailsElement): void {
  floatingDetails.add(details);
  details.addEventListener("toggle", () => {
    if (details.open) floatingDetails.forEach((other) => { if (other !== details) close(other); });
  });
  if (documentBound) return;
  documentBound = true;
  document.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Node) floatingDetails.forEach((item) => {
      if (!item.contains(event.target as Node)) close(item);
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") floatingDetails.forEach((item) => close(item, true));
  });
}

export function createActionDetails(details: HTMLDetailsElement): ActionDetails {
  const summary = requireDescendant<HTMLElement>(details, ".action-details-toggle");
  const panel = requireDescendant<HTMLElement>(details, ".action-details-panel");
  if (details.dataset.display === "floating") bindFloating(details);

  return {
    hide() {
      details.open = false;
      details.hidden = true;
      panel.replaceChildren();
    },
    show(label, tone, ...content) {
      details.open = false;
      details.hidden = false;
      summary.textContent = label;
      panel.dataset.tone = tone;
      panel.replaceChildren(...content);
    },
  };
}
