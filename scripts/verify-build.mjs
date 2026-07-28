import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

const distUrl = new URL("../dist/", import.meta.url);
const serviceWorker = readFileSync(new URL("sw.js", distUrl), "utf8");
const indexHtml = readFileSync(new URL("index.html", distUrl), "utf8");
const bootSource = readFileSync(new URL("boot.js", distUrl), "utf8");
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
  const ariaReferenceGroups = Array.from(
    html.matchAll(/\s(?:aria-describedby|aria-labelledby)="([^"]+)"/gu),
    (match) => match[1].split(/\s+/u),
  );
  ariaReferenceGroups.forEach((group) => {
    assert.equal(
      new Set(group).size,
      group.length,
      "An ARIA reference list must not repeat the same ID.",
    );
  });
  const references = [
    ...ariaReferenceGroups.flat(),
    ...Array.from(
      html.matchAll(/\shref="#([^"]+)"/gu),
      (match) => match[1],
    ),
    ...Array.from(
      html.matchAll(/<label[^>]*\sfor="([^"]+)"/gu),
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
  ["./", "./boot.js", ...relativePaths(expectedBaseFiles)],
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
  .update("\n")
  .update(bootSource)
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
assert.match(indexHtml, /<script[^>]*src="\.\/boot\.js"[^>]*><\/script>/u);
assert.match(indexHtml, /id="settings-file"[^>]*\shidden(?:\s|>)/u);
assert.match(indexHtml, /id="source-file"[^>]*\shidden(?:\s|>)/u);
assert.doesNotMatch(indexHtml, /id="app"[^>]*\shidden(?:\s|>)/u);
assert.match(indexHtml, /<html[^>]*class="no-js"/u);
assert.doesNotMatch(indexHtml, /noscript\.css/u);
assert.doesNotMatch(
  indexHtml,
  /<main id="app-content"[^>]*\sinert>/u,
  "The no-script document must not be permanently inert.",
);
assert.doesNotMatch(indexHtml, /workflow-nav/u);
for (const sectionId of [
  "profile-step",
  "columns-step",
  "global-step",
  "source-step",
  "results-step",
]) {
  assert.match(indexHtml, new RegExp(`<section id="${sectionId}"`, "u"));
}
assert.match(
  indexHtml,
  /<link rel="canonical" href="https:\/\/sleek874\.github\.io\/csv2txt\/"\s*\/?>/u,
);
assert.doesNotMatch(indexHtml, /id="settings-file"[^>]*aria-label=/u);
assert.doesNotMatch(indexHtml, /id="source-file"[^>]*aria-label=/u);
assert.match(
  indexHtml,
  /id="load-settings-button"[^>]*>上傳設定檔<\/button>/u,
);
assert.match(
  indexHtml,
  /id="save-settings-button"[^>]*>下載設定檔<\/button>/u,
);
assert.match(
  indexHtml,
  /id="load-default-button"[^>]*>使用預設設定<\/button>/u,
);
assert.match(indexHtml, /<label for="source-encoding">CSV 來源編碼<\/label>/u);
assert.match(indexHtml, /<label for="expected-rows">預期資料筆數<\/label>/u);
assert.match(indexHtml, /<label for="alignment">輸出對齊方式<\/label>/u);
assert.match(indexHtml, /<option value="left">靠左<\/option>/u);
assert.match(indexHtml, /<option value="right">靠右<\/option>/u);
assert.match(
  indexHtml,
  /<label for="remove-whitespace">來源空白字元處理<\/label>/u,
);
assert.match(
  indexHtml,
  /<option value="remove" selected>移除<\/option>/u,
);
assert.match(indexHtml, /<option value="preserve">保留<\/option>/u);
assert.match(indexHtml, /來源值經空白處理後為空時套用。/u);
assert.match(
  indexHtml,
  /id="remove-whitespace-help">套用空值預設與驗證前處理；保留時會在預覽標示。/u,
);
assert.doesNotMatch(indexHtml, /id="show-whitespace"/u);
assert.doesNotMatch(indexHtml, /id="settings-status"[^>]*aria-label=/u);
assert.doesNotMatch(
  indexHtml,
  /id="settings-status"[^>]*(?:role|aria-live)=/u,
  "Autosave progress must not be announced after every edit.",
);
assert.doesNotMatch(indexHtml, /id="source-file-picker"[^>]*aria-describedby=/u);
assert.doesNotMatch(
  indexHtml,
  /id="preview-results"[^>]*aria-live/u,
  "Large preview updates must not be exposed as a live region.",
);
assert.match(
  indexHtml,
  /class="header-meta"[\s\S]*?<p class="eyebrow">瀏覽器本機處理<\/p>[\s\S]*?class="header-meta__separator"[^>]*>·<\/span>[\s\S]*?id="readiness-status"[^>]*data-state="components"[\s\S]*?>載入必要元件<\/span>/u,
);
assert.doesNotMatch(
  indexHtml,
  /id="readiness-status"[^>]*(?:role|aria-live)=/u,
  "Background readiness progress must not behave as a live region.",
);
assert.doesNotMatch(indexHtml, /readiness-status__indicator/u);
assert.doesNotMatch(indexHtml, /id="app-loading"/u);
assert.equal(
  Array.from(indexHtml.matchAll(/id="width-\d+"/gu)).length,
  15,
  "The initial HTML must reserve all 15 column-editor rows.",
);
assert.match(indexHtml, /id="app-status" class="visually-hidden"/u);
assert.match(
  indexHtml,
  /id="app-status"[^>]*role="status"[^>]*aria-live="polite"/u,
);
assert.match(indexHtml, /id="file-processing-indicator"[\s\S]*?\shidden/u);
assert.match(
  indexHtml,
  /id="source-file-error"[^>]*role="alert"[^>]*hidden/u,
);
assert.doesNotMatch(indexHtml, /id="source-file-error"[^>]*tabindex=/u);
const baseCss = precachePaths
  .filter((path) => path.endsWith(".css"))
  .map((path) => readFileSync(
    new URL(path.replace(/^\.\//u, ""), distUrl),
    "utf8",
  ))
  .join("\n");
assert.doesNotMatch(
  baseCss,
  /!important/u,
  "Application styles must not rely on important overrides.",
);
assert.match(
  baseCss,
  /\.header-badges\{[^}]*width:9\.5rem/u,
  "The theme control must keep its reserved width.",
);
assert.match(
  baseCss,
  /\.theme-toggle\{[^}]*width:100%[^}]*height:2\.25rem/u,
  "The theme capsule must fill the reserved header width.",
);
assert.match(
  baseCss,
  /\.header-meta\{[^}]*display:flex[^}]*min-height:1\.5rem/u,
  "The eyebrow and readiness status must share one stable line.",
);
assert.match(
  baseCss,
  /\.readiness-status\{[^}]*width:7\.75rem[^}]*height:1\.5rem[^}]*background:var\(--color-surface-soft\)/u,
  "The readiness status must reserve a stable background capsule.",
);
const readinessStatusRule = baseCss.match(/\.readiness-status\{[^}]*\}/u)?.[0];
assert.ok(readinessStatusRule, "The readiness status rule must exist.");
assert.doesNotMatch(
  readinessStatusRule,
  /animation:/u,
  "The readiness status background must remain static.",
);
const readinessGlow = baseCss.match(
  /@keyframes readiness-loading-glow\{[\s\S]*?\}\}/u,
)?.[0];
assert.ok(readinessGlow, "Loading readiness states must use a text glow animation.");
assert.match(readinessGlow, /text-shadow:/u);
assert.doesNotMatch(
  readinessGlow,
  /(?:background|box-shadow|filter|opacity):/u,
  "The loading animation must affect only the text shadow.",
);
assert.doesNotMatch(
  baseCss,
  /readiness-status--(?:settled|ready|error)/u,
  "Readiness states must share one stable layout.",
);
assert.match(
  baseCss,
  /\.no-js #app-content[\s\S]*?display:none/u,
  "No-script visibility rules must remain in manifest-managed base CSS.",
);
assert.match(
  baseCss,
  /\.no-js \.readiness-status\{display:none/u,
  "The loading status must stay hidden when JavaScript is unavailable.",
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
