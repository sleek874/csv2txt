function revealApplication(): void {
  const app = document.querySelector<HTMLElement>("#app");
  if (app) {
    app.hidden = false;
  }
  document.querySelector("#app-loading")?.remove();
}

function renderLoadingError(): void {
  const loading = document.querySelector<HTMLElement>("#app-loading");
  const message = loading?.querySelector<HTMLElement>(".app-loading__text");
  loading?.classList.add("app-loading--error");
  if (message) {
    message.textContent = "載入失敗，請重新整理後再試。";
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
  detail.textContent = "為避免檔案選擇畫面遭其他網站覆蓋或誤導，本工具不會在內嵌框架中執行。";

  const link = document.createElement("a");
  link.className = "primary-button embed-open-link";
  link.href = window.location.href;
  link.target = "_top";
  link.rel = "noopener noreferrer";
  link.textContent = "直接開啟此工具";

  notice.append(eyebrow, heading, detail, link);
  app.replaceChildren(notice);
}

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
