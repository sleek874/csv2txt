import { defineConfig } from "vite";

import {
  developmentContentSecurityPolicy,
  productionContentSecurityPolicy,
} from "./build/vite/content-security-policy.ts";
import { offlineServiceWorker, offlineWorkerResources } from "./build/vite/offline-service-worker.ts";

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
  worker: {
    format: "es",
    plugins: () => [offlineWorkerResources()],
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll("\\", "/");
          if (normalizedId.includes("/node_modules/xlsx/")) return "worker-excel";
          if (normalizedId.includes("/node_modules/fflate/")) return "worker-archive";
          return undefined;
        },
      },
    },
  },
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
