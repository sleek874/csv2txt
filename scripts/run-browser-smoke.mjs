import assert from "node:assert/strict";
import { accessSync, constants, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import puppeteer from "puppeteer-core";

import { startPreviewServer } from "./lib/preview-server.mjs";

const chromePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const temporaryRoot = "/tmp";
accessSync(chromePath, constants.X_OK);
const artifactDirectory = new URL("../reports/browser/", import.meta.url);
mkdirSync(artifactDirectory, { recursive: true });
const profileDirectory = mkdtempSync(join(temporaryRoot, "csv2txt-chrome-"));
const downloadDirectory = mkdtempSync(join(temporaryRoot, "csv2txt-downloads-"));
const fixturePath = new URL("../testdata/csv/clean-single.csv", import.meta.url).pathname;
let browser;
let server;

try {
  server = await startPreviewServer();
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: profileDirectory,
    args: [
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,900",
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
  await page.waitForFunction(() => {
    const app = document.querySelector("#app");
    const content = document.querySelector("#app-content");
    return app?.getAttribute("aria-busy") !== "true" && content?.inert === false;
  }, { timeout: 15_000 });

  const shell = await page.evaluate(() => ({
    heading: document.querySelector("h1")?.textContent?.trim(),
    sections: document.querySelectorAll("main > section").length,
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    readiness: document.querySelector("#readiness-status .status-indicator__text")?.textContent?.trim(),
  }));
  assert.equal(shell.heading, "離線資料轉換");
  assert.equal(shell.sections, 5);
  assert.ok(shell.documentOverflow <= 1, `desktop document overflowed by ${shell.documentOverflow}px`);
  assert.ok(shell.readiness);

  await page.select("#input-format", "csv");
  const input = await page.$("#source-file");
  assert.ok(input);
  await input.uploadFile(fixturePath);
  await page.waitForFunction(() => (
    document.querySelectorAll("#file-tree tr[data-tree-node-id]").length > 0
    && document.querySelector("#download-button")?.disabled === false
  ), { timeout: 30_000 });
  const conversion = await page.evaluate(() => ({
    activeCount: document.querySelector("#active-files-count")?.textContent?.trim(),
    downloadLabel: document.querySelector("#download-button")?.textContent?.trim(),
    fileName: document.querySelector("#preview-file-name")?.textContent?.trim(),
    summary: document.querySelector("#download-status-summary")?.textContent?.trim(),
  }));
  assert.equal(conversion.activeCount, "1");
  assert.equal(conversion.fileName, "clean-single.csv");
  assert.match(conversion.downloadLabel ?? "", /下載 TXT/u);
  assert.match(conversion.summary ?? "", /1 個輸出檔案.*已勾選 1 列/u);

  const client = await page.createCDPSession();
  await client.send("Browser.setDownloadBehavior", {
    behavior: "allow", downloadPath: downloadDirectory,
  });
  await page.click("#download-button");
  await page.waitForFunction(() => (
    document.querySelector("#app-status")?.textContent?.includes("已建立")
  ), { timeout: 30_000 });
  let downloads = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    downloads = readdirSync(downloadDirectory).filter((file) => !file.endsWith(".crdownload"));
    if (downloads.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(downloads.length, 1);
  assert.match(downloads[0], /clean-single\.txt$/u);

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  const narrow = await page.evaluate(() => ({
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    selectedVisible: document.querySelector("#active-files-panel")?.hidden === false,
  }));
  assert.ok(narrow.documentOverflow <= 1, `narrow document overflowed by ${narrow.documentOverflow}px`);
  assert.equal(narrow.reducedMotion, true);
  assert.equal(narrow.selectedVisible, true);

  const screenshotPath = new URL("smoke-390x844.png", artifactDirectory).pathname;
  await page.screenshot({ path: screenshotPath, fullPage: true });
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(failedResponses, []);

  const summary = {
    chrome: await browser.version(),
    conversion,
    desktop: shell,
    downloads,
    narrow,
    screenshot: screenshotPath,
    url: server.url,
  };
  writeFileSync(new URL("summary.json", artifactDirectory), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Headless Chrome smoke passed: ${summary.chrome}, ${server.url}, desktop 1280x900, narrow 390x844.`);
  console.log(`Artifact: ${screenshotPath}`);
} finally {
  await browser?.close();
  await server?.stop();
  for (const directory of [profileDirectory, downloadDirectory]) {
    if (directory.startsWith(`${temporaryRoot}/csv2txt-`)) rmSync(directory, { recursive: true, force: true });
  }
}
