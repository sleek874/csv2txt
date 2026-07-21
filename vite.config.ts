import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "production-content-security-policy",
      apply: "build",
      transformIndexHtml(html) {
        return html.replace("connect-src 'self' ws:", "connect-src 'none'");
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
