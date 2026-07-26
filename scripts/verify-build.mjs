import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

const distUrl = new URL("../dist/", import.meta.url);
const serviceWorker = readFileSync(new URL("sw.js", distUrl), "utf8");
const indexHtml = readFileSync(new URL("index.html", distUrl), "utf8");
const manifestSource = readFileSync(new URL(".vite/manifest.json", distUrl), "utf8");
const manifest = JSON.parse(manifestSource);

function collectManifestGroup(roots) {
  const pending = [...roots];
  const visitedKeys = new Set();
  const files = new Set();

  while (pending.length > 0) {
    const key = pending.pop();
    if (!key || visitedKeys.has(key)) {
      continue;
    }
    visitedKeys.add(key);
    const chunk = manifest[key];
    assert.ok(chunk, `Vite manifest is missing the required entry: ${key}`);
    files.add(chunk.file);
    chunk.css?.forEach((file) => files.add(file));
    chunk.assets?.forEach((file) => files.add(file));
    pending.push(...(chunk.imports ?? []));
  }

  return files;
}

function relativePaths(files) {
  return Array.from(files, (fileName) => `./${fileName}`).sort();
}

function readPathGroup(name) {
  const match = serviceWorker.match(new RegExp(`const ${name} = (\\[[^;]*\\]);`, "u"));
  assert.ok(match?.[1], `Missing ${name} in the generated service worker.`);
  return JSON.parse(match[1]);
}

function verifyHtmlReferences(html) {
  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/gu), (match) => match[1]);
  assert.equal(
    new Set(ids).size,
    ids.length,
    "Generated HTML must not contain duplicate IDs.",
  );
  const knownIds = new Set(ids);
  const references = [
    ...Array.from(
      html.matchAll(/\s(?:aria-describedby|aria-labelledby)="([^"]+)"/gu),
      (match) => match[1].split(/\s+/u),
    ).flat(),
    ...Array.from(
      html.matchAll(/\shref="#([^"]+)"/gu),
      (match) => match[1],
    ),
  ];
  references.forEach((reference) => {
    assert.ok(
      knownIds.has(reference),
      `Generated HTML references a missing ID: ${reference}`,
    );
  });
}

const precachePaths = readPathGroup("PRECACHE_PATHS");
const excelPaths = readPathGroup("EXCEL_PATHS");
const fontPaths = readPathGroup("FONT_PATHS");
const expectedExcelFiles = collectManifestGroup(["src/core/spreadsheet.ts"]);
const expectedFontFiles = collectManifestGroup([
  "src/styles/preview-font.css",
  "src/assets/fonts/SarasaMonoTC-Regular.woff2",
]);
const expectedBaseFiles = collectManifestGroup(["index.html", "src/main.ts"]);
expectedExcelFiles.forEach((file) => expectedBaseFiles.delete(file));
expectedFontFiles.forEach((file) => {
  expectedBaseFiles.delete(file);
  expectedExcelFiles.delete(file);
});

assert.deepEqual(
  precachePaths,
  ["./", ...relativePaths(expectedBaseFiles)],
  "Base resources must match the Vite manifest graph.",
);
assert.deepEqual(
  excelPaths,
  relativePaths(expectedExcelFiles),
  "Excel resources must match the Vite manifest graph.",
);
assert.deepEqual(
  fontPaths,
  relativePaths(expectedFontFiles),
  "Font resources must match the Vite manifest graph.",
);

const expectedBuildId = createHash("sha256")
  .update(manifestSource)
  .update("\n")
  .update(indexHtml)
  .digest("hex")
  .slice(0, 16);
assert.match(
  serviceWorker,
  new RegExp(
    `const APP_CACHE_NAME = "csv2txt-app-${expectedBuildId}";`,
    "u",
  ),
  "Application cache version must derive from the Vite manifest and final HTML.",
);

for (const path of [...precachePaths, ...excelPaths, ...fontPaths]) {
  if (path === "./") {
    continue;
  }
  assert.ok(
    existsSync(new URL(path.replace(/^\.\//u, ""), distUrl)),
    `Generated resource group references a missing file: ${path}`,
  );
}

assert.ok(excelPaths.length >= 2, "Excel module and dependency chunks must be grouped.");
assert.ok(fontPaths.some((path) => path.endsWith(".woff2")), "Preview font must be grouped.");
assert.ok(
  excelPaths.every((path) => !precachePaths.includes(path)),
  "Excel resources must not be part of the base precache.",
);
assert.ok(
  fontPaths.every((path) => !precachePaths.includes(path)),
  "Font resources must not be part of the base precache.",
);
assert.match(
  serviceWorker,
  /prepareExcel\(\)\.then\(prepareFonts\)/u,
  "Idle preparation must preserve Excel-before-font ordering.",
);
assert.match(serviceWorker, /event\.data\?\.type !== "PREPARE_RESOURCES"/u);
assert.doesNotMatch(serviceWorker, /PREPARE_(?:FONT|OPTIONAL_RESOURCES)|fonts-v1/u);

verifyHtmlReferences(indexHtml);
assert.match(indexHtml, /<h1>CSV \/ Excel 轉 Big5 定長文字檔<\/h1>/u);
assert.match(indexHtml, /id="noscript-heading"/u);
assert.match(indexHtml, /id="settings-file"[\s\S]*?aria-label=/u);
assert.match(indexHtml, /id="source-file"[\s\S]*?aria-label=/u);
assert.doesNotMatch(indexHtml, /id="app"[^>]*\shidden(?:\s|>)/u);
assert.match(indexHtml, /<html[^>]*class="no-js"/u);
assert.doesNotMatch(indexHtml, /noscript\.css/u);
assert.match(
  indexHtml,
  /<main id="app-content"[^>]*\sinert>/u,
  "The painted workflow must remain inert while the main app loads.",
);
assert.match(indexHtml, /<nav class="workflow-nav" aria-label="轉換步驟">/u);
assert.match(
  indexHtml,
  /<link rel="canonical" href="https:\/\/sleek874\.github\.io\/csv2txt\/"\s*\/?>/u,
);
assert.match(indexHtml, /id="settings-file"[\s\S]*?tabindex="-1"/u);
assert.match(indexHtml, /id="source-file"[\s\S]*?tabindex="-1"/u);
assert.doesNotMatch(
  indexHtml,
  /id="preview-results"[^>]*aria-live/u,
  "Large preview updates must not be exposed as a live region.",
);
assert.match(indexHtml, /id="app-loading"[\s\S]*?class="busy-spinner"/u);
assert.match(indexHtml, /id="file-processing-indicator"[\s\S]*?\shidden/u);
const baseCss = precachePaths
  .filter((path) => path.endsWith(".css"))
  .map((path) => readFileSync(
    new URL(path.replace(/^\.\//u, ""), distUrl),
    "utf8",
  ))
  .join("\n");
assert.match(
  baseCss,
  /\.no-js #app-loading[\s\S]*?display:none/u,
  "No-script visibility rules must remain in manifest-managed base CSS.",
);

const baseJavaScript = precachePaths.filter((path) => path.endsWith(".js"));
const baseGzipBytes = baseJavaScript.reduce((total, path) => {
  const assetUrl = new URL(path.replace(/^\.\//u, ""), distUrl);
  return total + gzipSync(readFileSync(assetUrl)).byteLength;
}, 0);
assert.ok(
  baseGzipBytes < 240 * 1024,
  `Base JavaScript exceeds the 240 KiB gzip budget: ${baseGzipBytes} bytes.`,
);
const excelGzipBytes = excelPaths
  .filter((path) => path.endsWith(".js"))
  .reduce((total, path) => {
    const assetUrl = new URL(path.replace(/^\.\//u, ""), distUrl);
    return total + gzipSync(readFileSync(assetUrl)).byteLength;
  }, 0);
assert.ok(
  excelGzipBytes < 350 * 1024,
  `Excel JavaScript exceeds the 350 KiB gzip budget: ${excelGzipBytes} bytes.`,
);

const generatedFiles = readdirSync(distUrl, { recursive: true })
  .map(String);
for (const agentFile of ["llms.txt", "robots.txt", "sitemap.xml"]) {
  assert.ok(
    generatedFiles.includes(agentFile),
    `Agent discovery file is missing from the build: ${agentFile}`,
  );
}
assert.equal(
  generatedFiles.some((file) => file.endsWith(".map")),
  false,
  "Production source maps must remain disabled.",
);
for (const path of precachePaths.filter((item) => item.endsWith(".js"))) {
  const source = readFileSync(new URL(path.replace(/^\.\//u, ""), distUrl), "utf8");
  assert.doesNotMatch(source, /sourceMappingURL/u);
}

console.log(
  `Verified static shell, accessibility references, agent discovery, and optional resource groups; base JavaScript is ${(baseGzipBytes / 1024).toFixed(1)} KiB gzip.`,
);
