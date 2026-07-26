import { defineConfig } from "vite";

import {
  developmentContentSecurityPolicy,
  productionContentSecurityPolicy,
} from "./build/vite/content-security-policy";
import { offlineServiceWorker } from "./build/vite/offline-service-worker";

export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      buffer: "buffer/",
      string_decoder: "string_decoder/",
    },
  },
  plugins: [
    developmentContentSecurityPolicy(),
    offlineServiceWorker(),
    productionContentSecurityPolicy(),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    manifest: true,
    sourcemap: false,
    chunkSizeWarningLimit: 850,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return id.replaceAll("\\", "/").includes("/node_modules/xlsx/")
            ? "excel"
            : undefined;
        },
      },
    },
  },
});
