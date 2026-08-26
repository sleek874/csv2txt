import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import type { Manifest, Plugin } from "vite";

interface GeneratedAsset {
  source: string | Uint8Array;
}

interface ReleaseManifest {
  assets: string[];
  id: string;
  minSw: number;
  schema: number;
  shell: {
    sha256: string;
    url: string;
  };
}

const MANIFEST_FILE_NAME = ".vite/manifest.json";
const BOOT_FILE_NAME = "boot.js";
const BOOT_REFERENCE = `./${BOOT_FILE_NAME}`;
const WORKER_PROTOCOL = 1;
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
    if (!key || visitedKeys.has(key)) continue;
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

function collectOptionalManifestGroup(
  manifest: Manifest,
  roots: readonly string[],
): Set<string> {
  return roots.every((root) => manifest[root])
    ? collectManifestGroup(manifest, roots)
    : new Set<string>();
}

function readAssetSource(asset: GeneratedAsset): string {
  return typeof asset.source === "string"
    ? asset.source
    : new TextDecoder().decode(asset.source);
}

function readManifestAsset(asset: GeneratedAsset): Manifest {
  return JSON.parse(readAssetSource(asset)) as Manifest;
}

function relativePaths(files: Iterable<string>): string[] {
  return Array.from(files, (fileName) => `./${fileName}`).sort();
}

function sha256(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function createReleaseManifest(
  finalHtmlSource: string,
  assets: string[],
): ReleaseManifest {
  const id = sha256(`${finalHtmlSource}\n${JSON.stringify(assets)}`);
  return {
    assets,
    id,
    minSw: WORKER_PROTOCOL,
    schema: 1,
    shell: { sha256: sha256(finalHtmlSource), url: "./" },
  };
}

function serviceWorkerSource(): string {
  return `const WORKER_PROTOCOL = ${WORKER_PROTOCOL};
const RELEASE_SCHEMA = 1;
const RELEASE_URL = "./release.json";
const META_CACHE_NAME = "csv2txt-meta-v1";
const ASSET_CACHE_NAME = "csv2txt-assets-v1";
const SHELL_CACHE_PREFIX = "csv2txt-shell-";
const ACTIVE_RELEASE_KEY = "./__csv2txt_meta__/active-release";
const LAST_CHECK_KEY = "./__csv2txt_meta__/last-check";
const UPDATE_INTERVAL_MS = 15 * 60 * 1000;
const RELEASE_FETCH_TIMEOUT_MS = 4 * 1000;

let updatePromise = null;

function scopedUrl(path) {
  return new URL(path, self.registration.scope);
}

function metadataRequest(path) {
  return new Request(scopedUrl(path));
}

async function readMetadata(path) {
  const cache = await caches.open(META_CACHE_NAME);
  const response = await cache.match(metadataRequest(path));
  return response ? response.text() : null;
}

async function writeMetadata(path, value) {
  const cache = await caches.open(META_CACHE_NAME);
  await cache.put(
    metadataRequest(path),
    new Response(value, { headers: { "content-type": "text/plain; charset=utf-8" } }),
  );
}

function isValidRelease(release) {
  if (
    !release
    || release.schema !== RELEASE_SCHEMA
    || !/^[a-f0-9]{64}$/u.test(release.id)
    || !Number.isInteger(release.minSw)
    || release.minSw < 1
    || release.minSw > WORKER_PROTOCOL
    || release.shell?.url !== "./"
    || !/^[a-f0-9]{64}$/u.test(release.shell.sha256)
    || !Array.isArray(release.assets)
    || release.assets.length === 0
  ) {
    return false;
  }

  const scope = new URL(self.registration.scope);
  const assetRoot = scopedUrl("./assets/");
  const seen = new Set();
  return release.assets.every((path) => {
    if (typeof path !== "string" || !path.startsWith("./assets/") || seen.has(path)) {
      return false;
    }
    seen.add(path);
    const url = scopedUrl(path);
    return url.origin === scope.origin
      && url.pathname.startsWith(assetRoot.pathname)
      && url.search === ""
      && url.hash === "";
  });
}

async function responseSha256(response) {
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function fetchRelease() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RELEASE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(new Request(scopedUrl(RELEASE_URL), {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }));
    if (!response || response.status !== 200 || response.type === "opaque") {
      throw new Error("Unable to load the release manifest.");
    }
    const release = await response.json();
    if (!isValidRelease(release)) {
      throw new Error("The release manifest is incompatible with this worker.");
    }
    return release;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRequired(path) {
  const request = new Request(scopedUrl(path), {
    cache: "no-cache",
    credentials: "same-origin",
  });
  const response = await fetch(request);
  if (!response || response.status !== 200 || response.type === "opaque") {
    throw new Error("Unable to download an application release resource.");
  }
  return { request, response };
}

async function stageRelease(release) {
  const currentRelease = await readMetadata(ACTIVE_RELEASE_KEY);
  if (currentRelease === release.id) return false;

  const assetCache = await caches.open(ASSET_CACHE_NAME);
  for (const path of release.assets) {
    const request = new Request(scopedUrl(path));
    if (await assetCache.match(request, { ignoreVary: true })) continue;
    const fetched = await fetchRequired(path);
    await assetCache.put(fetched.request, fetched.response);
  }

  const shellCacheName = SHELL_CACHE_PREFIX + release.id;
  const shellCache = await caches.open(shellCacheName);
  try {
    const fetchedShell = await fetchRequired(release.shell.url);
    if (await responseSha256(fetchedShell.response.clone()) !== release.shell.sha256) {
      throw new Error("The downloaded application shell does not match its release.");
    }
    await shellCache.put(scopedUrl(release.shell.url), fetchedShell.response);
  } catch (error) {
    await caches.delete(shellCacheName);
    throw error;
  }

  await writeMetadata(ACTIVE_RELEASE_KEY, release.id);
  return true;
}

async function installLatestRelease() {
  const release = await fetchRelease();
  await stageRelease(release);
  await writeMetadata(LAST_CHECK_KEY, String(Date.now()));
}

function waitForWorkerInstall(worker) {
  if (!worker || worker.state !== "installing") return Promise.resolve();
  return new Promise((resolve) => {
    const handleStateChange = () => {
      if (worker.state === "installing") return;
      worker.removeEventListener("statechange", handleStateChange);
      resolve();
    };
    worker.addEventListener("statechange", handleStateChange);
  });
}

async function checkForUpdates(force = false) {
  if (updatePromise) return updatePromise;

  updatePromise = (async () => {
    const lastCheck = Number(await readMetadata(LAST_CHECK_KEY) ?? 0);
    if (!force && Number.isFinite(lastCheck) && Date.now() - lastCheck < UPDATE_INTERVAL_MS) {
      return;
    }
    try {
      await self.registration.update();
    } catch {
      // An application-only release can still be checked when sw.js is unreachable.
    }
    const workerCandidate = self.registration.installing ?? self.registration.waiting;
    if (workerCandidate) {
      await waitForWorkerInstall(workerCandidate);
      return;
    }
    try {
      await stageRelease(await fetchRelease());
    } catch {
      // Keep the active release when the candidate cannot be staged completely.
    }
    await writeMetadata(LAST_CHECK_KEY, String(Date.now()));
  })().finally(() => {
    updatePromise = null;
  });
  return updatePromise;
}

async function activeShell() {
  const releaseId = await readMetadata(ACTIVE_RELEASE_KEY);
  if (!releaseId || !/^[a-f0-9]{64}$/u.test(releaseId)) return null;
  const cache = await caches.open(SHELL_CACHE_PREFIX + releaseId);
  return cache.match(scopedUrl("./"), { ignoreVary: true });
}

async function findSharedAsset(request) {
  const assetCache = await caches.open(ASSET_CACHE_NAME);
  return assetCache.match(request, { ignoreVary: true });
}

async function serveNavigation(request) {
  try {
    await checkForUpdates();
  } catch {
    // The active cached release remains usable while offline.
  }
  const shell = await activeShell();
  return shell ?? fetch(request);
}

async function serveResource(request) {
  const cached = await findSharedAsset(request);
  if (cached) return cached;

  const response = await fetch(request);
  const requestUrl = new URL(request.url);
  const assetsUrl = scopedUrl("./assets/");
  if (
    response
    && response.status === 200
    && response.type !== "opaque"
    && requestUrl.pathname.startsWith(assetsUrl.pathname)
  ) {
    const assetCache = await caches.open(ASSET_CACHE_NAME);
    await assetCache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(installLatestRelease().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "PREPARE_RESOURCES") return;
  const replyPort = event.ports[0];
  event.waitUntil(
    checkForUpdates()
      .then(() => replyPort?.postMessage({ ok: true }))
      .catch(() => replyPort?.postMessage({ ok: false })),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  const scopeUrl = new URL(self.registration.scope);
  if (
    request.method !== "GET"
    || requestUrl.origin !== scopeUrl.origin
    || !requestUrl.pathname.startsWith(scopeUrl.pathname)
  ) return;

  if (requestUrl.href === scopedUrl(RELEASE_URL).href) {
    event.respondWith(fetch(new Request(request, { cache: "no-store" })));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(serveNavigation(request));
    return;
  }
  event.waitUntil(checkForUpdates().catch(() => undefined));
  event.respondWith(serveResource(request));
});
`;
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
  let unhashedBootOutput = "";
  return {
    name: "offline-service-worker",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      bootSource = readFileSync(resolve(config.publicDir, BOOT_FILE_NAME), "utf8");
      unhashedBootOutput = resolve(config.root, config.build.outDir, BOOT_FILE_NAME);
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const manifestAsset = bundle[MANIFEST_FILE_NAME];
        const indexHtmlAsset = bundle["index.html"];
        if (!manifestAsset || manifestAsset.type !== "asset") {
          this.error(`Vite did not emit ${MANIFEST_FILE_NAME} before service-worker generation.`);
        }
        if (!indexHtmlAsset || indexHtmlAsset.type !== "asset") {
          this.error("Vite did not emit index.html before service-worker generation.");
        }

        const manifest = readManifestAsset(manifestAsset);
        const originalHtmlSource = readAssetSource(indexHtmlAsset);
        const bootHash = sha256(bootSource).slice(0, 16);
        const bootPath = `./assets/boot-${bootHash}.js`;
        if (!originalHtmlSource.includes(BOOT_REFERENCE)) {
          this.error(`Built index.html does not reference ${BOOT_REFERENCE}.`);
        }
        const finalHtmlSource = originalHtmlSource.replace(BOOT_REFERENCE, bootPath);
        indexHtmlAsset.source = finalHtmlSource;
        this.emitFile({ type: "asset", fileName: bootPath.slice(2), source: bootSource });

        const releaseFiles = collectManifestGroup(manifest, BASE_MANIFEST_ROOTS);
        const workerFiles = collectOptionalManifestGroup(manifest, WORKER_MANIFEST_ROOTS);
        emittedWorkerFiles.core.forEach((file) => workerFiles.add(file));
        const excelFiles = collectOptionalManifestGroup(manifest, EXCEL_MANIFEST_ROOTS);
        const archiveFiles = collectOptionalManifestGroup(manifest, ARCHIVE_MANIFEST_ROOTS);
        emittedWorkerFiles.excel.forEach((file) => excelFiles.add(file));
        emittedWorkerFiles.archive.forEach((file) => archiveFiles.add(file));
        const fontFiles = collectManifestGroup(manifest, FONT_MANIFEST_ROOTS);
        workerFiles.forEach((file) => releaseFiles.add(file));
        excelFiles.forEach((file) => releaseFiles.add(file));
        archiveFiles.forEach((file) => releaseFiles.add(file));
        fontFiles.forEach((file) => releaseFiles.add(file));

        const assets = [bootPath, ...relativePaths(releaseFiles)]
          .filter((path, index, paths) => paths.indexOf(path) === index)
          .sort();
        const release = createReleaseManifest(finalHtmlSource, assets);
        this.emitFile({ type: "asset", fileName: "release.json", source: JSON.stringify(release) });
        this.emitFile({ type: "asset", fileName: "sw.js", source: serviceWorkerSource() });
      },
    },
    writeBundle() {
      rmSync(unhashedBootOutput, { force: true });
    },
  };
}
