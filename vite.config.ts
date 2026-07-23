import { defineConfig, type Plugin } from "vite";

function developmentContentSecurityPolicy(): Plugin {
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

function offlineServiceWorker(): Plugin {
  const cacheSchemaVersion = "v2";
  let transformedIndexHtml = "";

  return {
    name: "offline-service-worker",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        transformedIndexHtml = html;
        return html;
      },
    },
    generateBundle(_options, bundle) {
      const files = Object.values(bundle)
        .map((entry) => entry.fileName)
        .filter((fileName) => !fileName.endsWith(".map") && fileName !== "sw.js")
        .sort();
      const fontPaths = files
        .filter((fileName) => /\.(?:woff2?|ttf|otf)$/i.test(fileName))
        .map((fileName) => `./${fileName}`);
      const precachePaths = [
        "./",
        "./favicon.svg",
        "./noscript.css",
        ...files
          .filter((fileName) => !/\.(?:woff2?|ttf|otf)$/i.test(fileName))
          .map((fileName) => `./${fileName}`),
      ];

      let fingerprint = 2166136261;
      for (const character of `${transformedIndexHtml}\n${precachePaths.join("\n")}`) {
        fingerprint ^= character.charCodeAt(0);
        fingerprint = Math.imul(fingerprint, 16777619);
      }

      const cacheName = `csv2txt-app-${cacheSchemaVersion}-${(fingerprint >>> 0).toString(16)}`;
      const source = `const APP_CACHE_NAME = ${JSON.stringify(cacheName)};
const APP_CACHE_PREFIX = "csv2txt-app-";
const FONT_CACHE_NAME = "csv2txt-fonts-v1";
const PRECACHE_PATHS = ${JSON.stringify(precachePaths)};
const FONT_PATHS = ${JSON.stringify(fontPaths)};

function scopedRequest(path, cache) {
  return new Request(new URL(path, self.registration.scope), { cache });
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

async function prepareFonts() {
  const cache = await caches.open(FONT_CACHE_NAME);
  const expectedUrls = new Set(
    FONT_PATHS.map((path) => new URL(path, self.registration.scope).href),
  );

  await Promise.all(FONT_PATHS.map(async (path) => {
    const request = scopedRequest(path, "force-cache");
    if (await cache.match(request, { ignoreVary: true })) {
      return;
    }

    const response = await fetch(request);
    if (!response || response.status !== 200 || response.type === "opaque") {
      throw new Error("Unable to cache preview font.");
    }
    await cache.put(request, response);
  }));

  const cachedRequests = await cache.keys();
  await Promise.all(
    cachedRequests
      .filter((request) => !expectedUrls.has(request.url))
      .map((request) => cache.delete(request)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(installApplication());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(APP_CACHE_PREFIX) && name !== APP_CACHE_NAME)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "PREPARE_OFFLINE") {
    return;
  }

  const replyPort = event.ports[0];
  event.waitUntil(
    prepareFonts()
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
  };
}

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
    sourcemap: false,
  },
});
