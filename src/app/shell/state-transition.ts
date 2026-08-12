export interface StateTransition {
  update(stateKey: string): void;
}

/**
 * Restarts the shared, subtle state-change animation only when a semantic UI
 * state changes. Progress counters can therefore update without pulsing on
 * every worker event.
 */
export function createStateTransition(root: HTMLElement): StateTransition {
  let currentKey: string | null = null;
  let phase = false;
  root.classList.add("state-transition");

  return {
    update(stateKey) {
      if (currentKey !== null && currentKey !== stateKey) {
        phase = !phase;
        root.dataset.stateTransition = phase ? "a" : "b";
      }
      currentKey = stateKey;
    },
  };
}
