import type { Plugin } from "vite";

export function developmentContentSecurityPolicy(): Plugin {
  return {
    name: "development-content-security-policy",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(
        "style-src 'self'",
        "style-src 'self' 'unsafe-inline'",
      );
    },
  };
}

export function productionContentSecurityPolicy(): Plugin {
  return {
    name: "production-content-security-policy",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace("connect-src 'self' ws:", "connect-src 'none'");
    },
  };
}
