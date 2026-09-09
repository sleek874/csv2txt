import assert from "node:assert/strict";
import test from "node:test";

import { createOfflineCache } from "../src/browser/offline-cache.ts";

function installBrowserGlobals({ serviceWorker, immediateTimers = false } = {}) {
  const originals = {
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
  };
  const fakeWindow = {
    location: { href: "http://127.0.0.1:4173/" },
    setTimeout(callback) {
      if (immediateTimers) callback();
      return 1;
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: serviceWorker === undefined ? {} : { serviceWorker },
  });
  return () => {
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

test("reports development and unsupported environments without registering a worker", async () => {
  let restore = installBrowserGlobals();
  try {
    const states = [];
    await createOfflineCache({
      baseUrl: "./", production: false, onStateChange: (state) => states.push(state),
    }).prepareOfflineUse();
    assert.deepEqual(states, ["development"]);
  } finally {
    restore();
  }

  restore = installBrowserGlobals();
  try {
    const states = [];
    await createOfflineCache({
      baseUrl: "./", production: true, onStateChange: (state) => states.push(state),
    }).prepareOfflineUse();
    assert.deepEqual(states, ["unsupported"]);
  } finally {
    restore();
  }
});

test("registers the stable worker once and reports failed resource preparation", async () => {
  const posted = [];
  const worker = {
    postMessage(request, ports) {
      posted.push(request);
      ports[0].postMessage({ ok: false });
    },
  };
  const registrations = [];
  const serviceWorker = {
    async getRegistration(scope) { registrations.push(["get", scope]); return undefined; },
    async register(url, options) { registrations.push(["register", url, options]); },
    ready: Promise.resolve({ active: worker }),
  };
  const restore = installBrowserGlobals({ serviceWorker, immediateTimers: true });
  try {
    const states = [];
    await createOfflineCache({
      baseUrl: "./", production: true, onStateChange: (state) => states.push(state),
    }).prepareOfflineUse();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(states, ["preparing", "error"]);
    assert.equal(registrations[0][0], "get");
    assert.deepEqual(registrations[1], ["register", "./sw.js", {
      scope: "./", updateViaCache: "none",
    }]);
    assert.deepEqual(posted, [{ type: "PREPARE_RESOURCES" }]);
  } finally {
    restore();
  }
});

test("clears a failed registration promise so a later preparation can retry", async () => {
  let attempts = 0;
  const serviceWorker = {
    async getRegistration() {
      attempts += 1;
      throw new Error("registration unavailable");
    },
    ready: Promise.resolve({ active: null }),
  };
  const restore = installBrowserGlobals({ serviceWorker });
  try {
    const states = [];
    const cache = createOfflineCache({
      baseUrl: "./", production: true, onStateChange: (state) => states.push(state),
    });
    await cache.prepareOfflineUse();
    await cache.prepareOfflineUse();
    assert.equal(attempts, 2);
    assert.deepEqual(states, ["preparing", "error", "preparing", "error"]);
  } finally {
    restore();
  }
});
