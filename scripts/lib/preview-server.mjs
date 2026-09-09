import { spawn } from "node:child_process";

const HOST = "127.0.0.1";

async function waitForPreview(url, child, output) {
  let closed = child.exitCode !== null;
  child.once("close", () => { closed = true; });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (closed) {
      throw new Error(`Preview server exited with ${child.exitCode}.\n${output()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Preview server did not become ready at ${url}.\n${output()}`);
}

export async function startPreviewServer() {
  const port = Number.parseInt(process.env.CSV2TXT_TEST_PORT ?? "4173", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("CSV2TXT_TEST_PORT must be a valid TCP port.");
  }
  const url = `http://${HOST}:${port}/`;
  const vite = new URL("../../node_modules/vite/bin/vite.js", import.meta.url).pathname;
  const child = spawn(process.execPath, [
    vite, "preview", "--host", HOST, "--port", String(port), "--strictPort",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  const collect = (chunk) => { logs += String(chunk); };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  await waitForPreview(url, child, () => logs);
  return {
    url,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}
