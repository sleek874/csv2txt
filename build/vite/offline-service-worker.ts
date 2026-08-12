import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Manifest, Plugin } from "vite";

interface GeneratedAsset {
  source: string | Uint8Array;
}

const MANIFEST_FILE_NAME = ".vite/manifest.json";
const BOOT_FILE_NAME = "boot.js";
const BASE_MANIFEST_ROOTS = ["index.html", "src/main.ts"];
const WORKER_MANIFEST_ROOTS = ["src/app/batch/batch-worker.ts"];
const EXCEL_MANIFEST_ROOTS = ["src/core/formats/spreadsheet.ts"];
const ARCHIVE_MANIFEST_ROOTS = ["src/core/archive/zip.ts"];
const FONT_MANIFEST_ROOTS = [
  "src/styles/preview-font.css",
  "src/assets/fonts/SarasaMonoTC-Regular.woff2",
];
const emittedWorkerFiles = {
  archive: new Set<string>(),
  core: new Set<string>(),
  excel: new Set<string>(),
};

function collectManifestGroup(
  manifest: Manifest,
  roots: readonly string[],
): Set<string> {
  const pending = [...roots];
  const files = new Set<string>();
  const visitedKeys = new Set<string>();

  while (pending.length > 0) {
    const key = pending.pop();
    if (!key || visitedKeys.has(key)) {
      continue;
    }
    visitedKeys.add(key);
    const chunk = manifest[key];
    if (!chunk) {
      throw new Error(`Vite manifest is missing the required entry: ${key}`);
    }
    files.add(chunk.file);
    chunk.css?.forEach((file) => files.add(file));
    chunk.assets?.forEach((file) => files.add(file));
    pending.push(...(chunk.imports ?? []));
  }

  return files;
}

function collectOptionalManifestGroup(manifest: Manifest, roots: readonly string[]): Set<string> {
  return roots.every((root) => manifest[root]) ? collectManifestGroup(manifest, roots) : new Set<string>();
}

function readAssetSource(asset: GeneratedAsset): string {
  return typeof asset.source === "string"
    ? asset.source
    : new TextDecoder().decode(asset.source);
}

function readManifestAsset(asset: GeneratedAsset): {
  manifest: Manifest;
  source: string;
} {
  const source = readAssetSource(asset);
  return {
    manifest: JSON.parse(source) as Manifest,
    source,
  };
}

function relativePaths(files: Iterable<string>): string[] {
  return Array.from(files, (fileName) => `./${fileName}`).sort();
}

export function offlineWorkerResources(): Plugin {
  return {
    name: "offline-worker-resources",
    apply: "build",
    buildStart() {
      emittedWorkerFiles.archive.clear();
      emittedWorkerFiles.core.clear();
      emittedWorkerFiles.excel.clear();
    },
    generateBundle(_options, bundle) {
      Object.keys(bundle).filter((file) => file.endsWith(".js")).forEach((file) => {
        if (/(?:spreadsheet|worker-excel)-/iu.test(file)) emittedWorkerFiles.excel.add(file);
        else if (/(?:zip|worker-archive)-/iu.test(file)) emittedWorkerFiles.archive.add(file);
        else emittedWorkerFiles.core.add(file);
      });
    },
  };
}

export function offlineServiceWorker(): Plugin {
  let bootSource = "";

  return {
    name: "offline-service-worker",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      bootSource = readFileSync(resolve(config.publicDir, BOOT_FILE_NAME), "utf8");
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const manifestAsset = bundle[MANIFEST_FILE_NAME];
        const indexHtmlAsset = bundle["index.html"];
        if (!manifestAsset || manifestAsset.type !== "asset") {
          this.error(
            `Vite did not emit ${MANIFEST_FILE_NAME} before service-worker generation.`,
          );
        }
        if (!indexHtmlAsset || indexHtmlAsset.type !== "asset") {
          this.error("Vite did not emit index.html before service-worker generation.");
        }

        const { manifest, source: manifestSource } = readManifestAsset(manifestAsset);
        const indexHtmlSource = readAssetSource(indexHtmlAsset);
        const baseFiles = collectManifestGroup(manifest, BASE_MANIFEST_ROOTS);
        const workerFiles = collectOptionalManifestGroup(manifest, WORKER_MANIFEST_ROOTS);
        emittedWorkerFiles.core.forEach((file) => workerFiles.add(file));
        const excelFiles = collectOptionalManifestGroup(manifest, EXCEL_MANIFEST_ROOTS);
        const archiveFiles = collectOptionalManifestGroup(manifest, ARCHIVE_MANIFEST_ROOTS);
        emittedWorkerFiles.excel.forEach((file) => excelFiles.add(file));
        emittedWorkerFiles.archive.forEach((file) => archiveFiles.add(file));
        const fontFiles = collectManifestGroup(manifest, FONT_MANIFEST_ROOTS);
        fontFiles.forEach((file) => {
          baseFiles.delete(file);
          excelFiles.delete(file);
          archiveFiles.delete(file);
          workerFiles.delete(file);
        });
        baseFiles.forEach((file) => {
          if (workerFiles.has(file)) baseFiles.delete(file);
        });
        baseFiles.forEach((file) => {
          excelFiles.delete(file);
          archiveFiles.delete(file);
        });
        workerFiles.forEach((file) => {
          if (excelFiles.has(file) || archiveFiles.has(file)) workerFiles.delete(file);
        });
        excelFiles.forEach((file) => archiveFiles.delete(file));

        const precachePaths = ["./", `./${BOOT_FILE_NAME}`, ...relativePaths(baseFiles)];
        const excelPaths = relativePaths(excelFiles);
        const archivePaths = relativePaths(archiveFiles);
        const workerPaths = relativePaths(workerFiles);
        const fontPaths = relativePaths(fontFiles);
        const buildId = createHash("sha256")
          .update(manifestSource)
          .update("\n")
          .update(JSON.stringify({ archivePaths, excelPaths, workerPaths }))
          .update("\n")
          .update(indexHtmlSource)
          .update("\n")
          .update(bootSource)
          .digest("hex")
          .slice(0, 16);
        const cacheName = `csv2txt-app-${buildId}`;
        const source = `const APP_CACHE_NAME = ${JSON.stringify(cacheName)};
const MANAGED_CACHE_PREFIX = "csv2txt-";
const FONT_CACHE_NAME = "csv2txt-fonts";
const PRECACHE_PATHS = ${JSON.stringify(precachePaths)};
const EXCEL_PATHS = ${JSON.stringify(excelPaths)};
const ARCHIVE_PATHS = ${JSON.stringify(archivePaths)};
const WORKER_PATHS = ${JSON.stringify(workerPaths)};
const FONT_PATHS = ${JSON.stringify(fontPaths)};

function scopedRequest(path, cache) {
  return new Request(new URL(path, self.registration.scope), { cache });
}

async function cacheResources(cacheName, paths, removeUnexpected = false) {
  const cache = await caches.open(cacheName);
  const expectedUrls = new Set(
    paths.map((path) => new URL(path, self.registration.scope).href),
  );

  await Promise.all(paths.map(async (path) => {
    const request = scopedRequest(path, "force-cache");
    if (await cache.match(request, { ignoreVary: true })) {
      return;
    }

    const response = await fetch(request);
    if (!response || response.status !== 200 || response.type === "opaque") {
      throw new Error("Unable to cache an optional application resource.");
    }
    await cache.put(request, response);
  }));

  if (removeUnexpected) {
    const cachedRequests = await cache.keys();
    await Promise.all(
      cachedRequests
        .filter((request) => !expectedUrls.has(request.url))
        .map((request) => cache.delete(request)),
    );
  }
}

async function installApplication() {
  const cache = await caches.open(APP_CACHE_NAME);
  const requests = PRECACHE_PATHS.map((path) => scopedRequest(
    path,
    path.startsWith("./assets/") ? "force-cache" : "no-cache",
  ));

  try {
    await cache.addAll(requests);
  } catch (error) {
    await caches.delete(APP_CACHE_NAME);
    throw error;
  }
}

function prepareExcel() {
  return cacheResources(APP_CACHE_NAME, EXCEL_PATHS);
}

function prepareArchive() {
  return cacheResources(APP_CACHE_NAME, ARCHIVE_PATHS);
}

function prepareWorker() {
  return cacheResources(APP_CACHE_NAME, WORKER_PATHS);
}

function prepareFonts() {
  return cacheResources(FONT_CACHE_NAME, FONT_PATHS, true);
}

self.addEventListener("install", (event) => {
  event.waitUntil(installApplication());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => (
            name.startsWith(MANAGED_CACHE_PREFIX)
            && name !== APP_CACHE_NAME
            && name !== FONT_CACHE_NAME
          ))
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "PREPARE_RESOURCES") {
    return;
  }

  const replyPort = event.ports[0];
  const preparation = prepareWorker()
    .then(() => event.data.includeExcel ? prepareExcel() : undefined)
    .then(() => event.data.includeArchive ? prepareArchive() : undefined)
    .then(prepareFonts);
  event.waitUntil(
    preparation
      .then(() => replyPort?.postMessage({ ok: true }))
      .catch(() => replyPort?.postMessage({ ok: false })),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  const scopeUrl = new URL(self.registration.scope);
  const isFontRequest = FONT_PATHS.some(
    (path) => new URL(path, self.registration.scope).href === requestUrl.href,
  );

  if (
    request.method !== "GET"
    || requestUrl.origin !== scopeUrl.origin
    || !requestUrl.pathname.startsWith(scopeUrl.pathname)
  ) {
    return;
  }

  if (isFontRequest) {
    event.respondWith(
      caches.open(FONT_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request, {
          ignoreSearch: true,
          ignoreVary: true,
        });
        if (cached) {
          return cached;
        }

        const response = await fetch(request);
        if (response && response.status === 200 && response.type !== "opaque") {
          await cache.put(request, response.clone());
        }
        return response;
      }),
    );
    return;
  }

  event.respondWith(
    caches.open(APP_CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request, {
        ignoreSearch: true,
        ignoreVary: true,
      });
      if (cached) {
        return cached;
      }

      if (request.mode === "navigate") {
        const shell = await cache.match(
          new URL("./", self.registration.scope),
          { ignoreVary: true },
        );
        return shell ?? fetch(request);
      }

      const response = await fetch(request);
      if (response && response.status === 200 && response.type !== "opaque") {
        await cache.put(request, response.clone());
      }
      return response;
    }),
  );
});
`;

      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source,
      });
      },
    },
  };
}
