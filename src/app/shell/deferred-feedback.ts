export const FEEDBACK_DELAY_MS = 300;

export function createDeferredFeedback() {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    show(render: () => void) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        render();
      }, FEEDBACK_DELAY_MS);
    },
  };
}
