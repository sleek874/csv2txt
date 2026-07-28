import { installTheme } from "./browser/theme";

function revealApplication(): void {
  const app = document.querySelector<HTMLElement>("#app");
  if (app) {
    app.removeAttribute("aria-busy");
  }
  document.querySelector<HTMLElement>("#app-content")?.removeAttribute("inert");
  document.documentElement.classList.remove("js-booting");
}

function renderLoadingError(): void {
  const status = document.querySelector<HTMLElement>("#readiness-status");
  const message = status?.querySelector<HTMLElement>(".readiness-status__text");
  if (status) {
    status.dataset.state = "error";
  }
  status?.setAttribute("role", "alert");
  status?.setAttribute("aria-live", "assertive");
  if (message) {
    message.textContent = "工具載入失敗";
  }
}

function renderEmbeddedPage(): void {
  document.documentElement.dataset.embedded = "true";

  const app = document.querySelector<HTMLElement>("#app");
  if (!app) {
    return;
  }

  const notice = document.createElement("main");
  notice.className = "embed-blocked";

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "安全保護";

  const heading = document.createElement("h1");
  heading.textContent = "請直接開啟轉換工具";

  const detail = document.createElement("p");
  detail.textContent = "此工具無法在內嵌頁面中使用。";

  const link = document.createElement("a");
  link.className = "primary-button embed-open-link";
  link.href = window.location.href;
  link.target = "_top";
  link.rel = "noopener noreferrer";
  link.textContent = "直接開啟";

  notice.append(eyebrow, heading, detail, link);
  app.replaceChildren(notice);
}

installTheme();

if (window.self !== window.top) {
  renderEmbeddedPage();
  revealApplication();
} else {
  void import("./main")
    .then(revealApplication)
    .catch((error: unknown) => {
      console.error("Application initialization failed.", error);
      renderLoadingError();
    });
}
