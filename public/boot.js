(() => {
  const root = document.documentElement;
  try {
    const storedTheme = localStorage.getItem("csv2txt.theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      root.dataset.theme = storedTheme;
    }
  } catch {
    // The system color scheme remains available when storage is unavailable.
  }

  root.classList.remove("no-js");
  root.classList.add("js-booting");

  const enterBootState = () => {
    const app = document.querySelector("#app");
    const content = document.querySelector("#app-content");
    if (!(app instanceof HTMLElement) || !(content instanceof HTMLElement)) {
      return false;
    }

    app.setAttribute("aria-busy", "true");
    content.inert = true;
    return true;
  };

  if (!enterBootState()) {
    const observer = new MutationObserver(() => {
      if (enterBootState()) {
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  }
})();
