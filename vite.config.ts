import { defineConfig } from "vite";

import {
  developmentContentSecurityPolicy,
  productionContentSecurityPolicy,
} from "./build/vite/content-security-policy.ts";
import { offlineServiceWorker } from "./build/vite/offline-service-worker.ts";

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
    chunkSizeWarningLimit: 950,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll("\\", "/");
          if (normalizedId.includes("/node_modules/xlsx/")) {
            return "excel";
          }
          if (normalizedId.includes("/node_modules/fflate/")) {
            return "archive";
          }
          return undefined;
        },
      },
    },
  },
});
