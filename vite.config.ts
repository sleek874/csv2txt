import { defineConfig, type Plugin } from "vite";

function offlineServiceWorker(): Plugin {
  return {
    name: "offline-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = Object.values(bundle)
        .map((entry) => entry.fileName)
        .filter((fileName) => !fileName.endsWith(".map") && fileName !== "sw.js")
        .sort();
      const precachePaths = ["./", ...files.map((fileName) => `./${fileName}`)];

      let fingerprint = 2166136261;
      for (const character of precachePaths.join("\n")) {
        fingerprint ^= character.charCodeAt(0);
        fingerprint = Math.imul(fingerprint, 16777619);
      }

      const cacheName = `csv2txt-app-${(fingerprint >>> 0).toString(16)}`;
      const source = `const CACHE_NAME = ${JSON.stringify(cacheName)};
const CACHE_PREFIX = "csv2txt-app-";
const PRECACHE_PATHS = ${JSON.stringify(precachePaths)};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_PATHS.map((path) => new Request(
        new URL(path, self.registration.scope),
        { cache: "reload" },
      ))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
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
  ) {
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) {
        return cached;
      }

      if (request.mode === "navigate") {
        return caches.match(new URL("./", self.registration.scope)).then((shell) => {
          if (shell) {
            return shell;
          }
          return fetch(request);
        });
      }

      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type === "opaque") {
          return response;
        }

        const cachedResponse = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, cachedResponse));
        return response;
      });
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
    sourcemap: true,
  },
});
