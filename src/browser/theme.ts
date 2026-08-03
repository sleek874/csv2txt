const THEME_STORAGE_KEY = "csv2txt.theme";

type Theme = "light" | "dark";

export function installTheme(): void {
  const systemDarkTheme = window.matchMedia("(prefers-color-scheme: dark)");
  let manualTheme: Theme | null = null;
  let themeColorFrame: number | null = null;

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

  function scheduleThemeColorUpdate(): void {
    if (themeColorFrame !== null) {
      cancelAnimationFrame(themeColorFrame);
    }
    themeColorFrame = requestAnimationFrame(() => {
      themeColorFrame = null;
      const pageColor = getComputedStyle(document.documentElement).backgroundColor;
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.setAttribute("content", pageColor);
    });
  }

  function applyTheme(): void {
    const theme = resolvedTheme();
    document.documentElement.dataset.theme = theme;
    scheduleThemeColorUpdate();

    const toggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
    if (!toggle) {
      return;
    }

    const source = manualTheme ? "自訂" : "系統";
    toggle.setAttribute("aria-checked", String(theme === "dark"));
    toggle.setAttribute("aria-label", `深色模式 ${source}`);
    toggle.title = `${theme === "dark" ? "深色" : "淺色"}模式（${source}）`;
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
