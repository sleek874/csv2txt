const THEME_STORAGE_KEY = "csv2txt.theme";

type Theme = "light" | "dark";

export function installTheme(): void {
  const systemDarkTheme = window.matchMedia("(prefers-color-scheme: dark)");
  let manualTheme: Theme | null = null;

  try {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") {
      manualTheme = storedTheme;
    }
  } catch {
    // The in-memory toggle still works when persistent storage is unavailable.
  }

  function resolvedTheme(): Theme {
    return manualTheme ?? (systemDarkTheme.matches ? "dark" : "light");
  }

  function applyTheme(): void {
    const theme = resolvedTheme();
    document.documentElement.dataset.theme = theme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#10171c" : "#f4f7f8");

    const toggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
    if (!toggle) {
      return;
    }

    const source = manualTheme ? "自訂" : "系統";
    toggle.setAttribute("aria-checked", String(theme === "dark"));
    toggle.setAttribute(
      "aria-label",
      `深色模式 ${source}，目前${theme === "dark" ? "開啟" : "關閉"}`,
    );
    toggle.title = `目前為${theme === "dark" ? "深色" : "淺色"}模式（${source}設定）`;
    const mode = toggle.querySelector<HTMLElement>(".theme-toggle-mode");
    if (mode) {
      mode.textContent = source;
    }
  }

  applyTheme();

  document.querySelector<HTMLButtonElement>("#theme-toggle")
    ?.addEventListener("click", () => {
      manualTheme = resolvedTheme() === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_STORAGE_KEY, manualTheme);
      } catch {
        // The selected theme remains active for this page session.
      }
      applyTheme();
    });

  systemDarkTheme.addEventListener("change", () => {
    if (!manualTheme) {
      applyTheme();
    }
  });
}
