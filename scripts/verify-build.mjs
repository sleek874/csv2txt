import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

const distUrl = new URL("../dist/", import.meta.url);
const serviceWorker = readFileSync(new URL("sw.js", distUrl), "utf8");
const indexHtml = readFileSync(new URL("index.html", distUrl), "utf8");
const bootSource = readFileSync(new URL("boot.js", distUrl), "utf8");
const llmsTxt = readFileSync(new URL("llms.txt", distUrl), "utf8");
const robotsTxt = readFileSync(new URL("robots.txt", distUrl), "utf8");
const sitemapXml = readFileSync(new URL("sitemap.xml", distUrl), "utf8");
const componentStyles = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);
const reusableComponentStyles = readFileSync(
  new URL("../src/styles/components.css", import.meta.url),
  "utf8",
);
const foundationStyles = readFileSync(
  new URL("../src/styles/foundation.css", import.meta.url),
  "utf8",
);
const bootstrapStyles = readFileSync(
  new URL("../src/styles/bootstrap.css", import.meta.url),
  "utf8",
);
const resultStyles = readFileSync(
  new URL("../src/styles/results.css", import.meta.url),
  "utf8",
);
const dataPreviewViewSource = readFileSync(
  new URL("../src/app/sections/input/data-preview-view.ts", import.meta.url),
  "utf8",
);
const encodingSource = readFileSync(
  new URL("../src/core/encoding.ts", import.meta.url),
  "utf8",
);
const outputValidationSource = readFileSync(
  new URL("../src/core/output-validation.ts", import.meta.url),
  "utf8",
);
const themeSource = readFileSync(
  new URL("../src/browser/theme.ts", import.meta.url),
  "utf8",
);
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
    html.matchAll(/\s(?:aria-controls|aria-describedby|aria-labelledby)="([^"]+)"/gu),
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
const archivePaths = readPathGroup("ARCHIVE_PATHS");
const fontPaths = readPathGroup("FONT_PATHS");
const expectedBaseFiles = collectManifestGroup(["index.html", "src/main.ts"]);
const expectedExcelFiles = collectManifestGroup(["src/core/formats/spreadsheet.ts"]);
const expectedArchiveFiles = collectManifestGroup(["src/core/archive/zip.ts"]);
const expectedFontFiles = collectManifestGroup([
  "src/styles/preview-font.css",
  "src/assets/fonts/SarasaMonoTC-Regular.woff2",
]);
expectedFontFiles.forEach((file) => {
  expectedBaseFiles.delete(file);
  expectedExcelFiles.delete(file);
  expectedArchiveFiles.delete(file);
});
expectedBaseFiles.forEach((file) => {
  expectedExcelFiles.delete(file);
  expectedArchiveFiles.delete(file);
});
expectedExcelFiles.forEach((file) => expectedArchiveFiles.delete(file));

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
  archivePaths,
  relativePaths(expectedArchiveFiles),
  "Archive resources must match the Vite manifest graph.",
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

for (const path of [...precachePaths, ...excelPaths, ...archivePaths, ...fontPaths]) {
  if (path === "./") {
    continue;
  }
  assert.ok(
    existsSync(new URL(path.replace(/^\.\//u, ""), distUrl)),
    `Generated resource group references a missing file: ${path}`,
  );
}

assert.ok(excelPaths.length >= 2, "Excel module and dependency chunks must be grouped.");
assert.ok(archivePaths.length >= 1, "Archive dependency chunk must be grouped.");
assert.ok(fontPaths.some((path) => path.endsWith(".woff2")), "Preview font must be grouped.");
assert.ok(
  excelPaths.every((path) => !precachePaths.includes(path)),
  "Excel resources must not be part of the base precache.",
);
assert.ok(
  archivePaths.every((path) => !precachePaths.includes(path)),
  "Archive resources must not be part of the base precache.",
);
assert.ok(
  fontPaths.every((path) => !precachePaths.includes(path)),
  "Font resources must not be part of the base precache.",
);
assert.match(serviceWorker, /prepareExcel\(\)[\s\S]*?prepareArchive\(\)[\s\S]*?prepareFonts/u);
assert.match(serviceWorker, /event\.data\?\.type !== "PREPARE_RESOURCES"/u);
assert.doesNotMatch(serviceWorker, /PREPARE_(?:FONT|OPTIONAL_RESOURCES)|fonts-v1/u);

verifyHtmlReferences(indexHtml);
assert.match(indexHtml, /<h1>離線資料轉換<\/h1>/u);
assert.match(indexHtml, /id="noscript-heading"/u);
assert.match(indexHtml, /<script[^>]*src="\.\/boot\.js"[^>]*><\/script>/u);
assert.match(indexHtml, /id="source-file"[^>]*\shidden(?:\s|>)/u);
assert.match(indexHtml, /id="source-file"[^>]*accept="\.csv,\.xls,\.xlsx,\.txt,\.zip"/u);
assert.match(indexHtml, /id="source-file"[^>]*\smultiple(?:\s|>)/u);
assert.doesNotMatch(indexHtml, /id="app"[^>]*\shidden(?:\s|>)/u);
assert.match(indexHtml, /<html[^>]*class="no-js"/u);
assert.doesNotMatch(indexHtml, /noscript\.css/u);
assert.match(
  indexHtml,
  /<main id="app-content"[^>]*\sinert>/u,
  "The application must stay inert until its controller is ready.",
);
for (const sectionId of [
  "rules-step",
  "input-step",
  "output-step",
  "advanced-step",
]) {
  assert.match(indexHtml, new RegExp(`<section id="${sectionId}"`, "u"));
}
assert.ok(
  ["rules-step", "input-step", "output-step", "advanced-step"]
    .map((id) => indexHtml.indexOf(`id="${id}"`))
    .every((position, index, positions) => index === 0 || position > (positions[index - 1] ?? -1)),
  "The four workflow sections must preserve their fixed order.",
);
assert.match(
  indexHtml,
  /<link rel="canonical" href="https:\/\/sleek874\.github\.io\/csv2txt\/"\s*\/?>/u,
);
assert.doesNotMatch(indexHtml, /id="source-file"[^>]*aria-label=/u);
assert.match(
  indexHtml,
  /<details id="rules-disclosure">[\s\S]*?<summary>[\s\S]*?15[\s\S]*?208[\s\S]*?<\/summary>/u,
  "Fixed rules must start as a native collapsed disclosure with a compact summary.",
);
assert.match(
  indexHtml,
  /<tbody id="fixed-rules-body"><\/tbody>/u,
  "The fixed profile disclosure must expose an initially empty body for lazy rendering.",
);
assert.doesNotMatch(
  indexHtml,
  /<th scope="row">欄位(?:[1-9]|1[0-5])<\/th>/u,
  "Fixed profile rows must come from the TypeScript profile instead of duplicated HTML.",
);
assert.match(indexHtml, /<label for="output-format">輸出格式<\/label>/u);
assert.match(
  indexHtml,
  /<select id="output-format"[^>]*aria-describedby="output-format-help"[\s\S]*?<option value="big5-txt" selected>TXT（BIG-5E）<\/option>[\s\S]*?<option value="csv">CSV（UTF-8）<\/option>[\s\S]*?<option value="xlsx">XLSX<\/option>[\s\S]*?<\/select>/u,
  "Output formats must use one native select and expose all three codecs.",
);
assert.doesNotMatch(indexHtml, /<input[^>]*name="output-format"|class="format-option"/u);
assert.match(
  indexHtml,
  /id="row-filter"[\s\S]*?value="warning"[\s\S]*?value="valid">正確<\/option>[\s\S]*?value="excluded">未選取<\/option>/u,
  "The preview must expose the exclusive warning, output-ready, and excluded row filters.",
);
assert.doesNotMatch(indexHtml, /value="modified"|>自動修正<\/option>/u);
assert.match(
  indexHtml,
  /id="data-page-status"[^>]*aria-live="polite"/u,
  "Explicit preview pagination and filter changes must announce their concise page status.",
);
assert.match(
  indexHtml,
  /class="row-output-heading" scope="col">[\s\S]*?class="row-output-control row-output-heading-control"[\s\S]*?<span>輸出<\/span>[\s\S]*?id="visible-rows-checkbox"[^>]*aria-label="選取目前篩選結果的本頁資料列"[^>]*disabled/u,
  "The preview output header must expose a three-state current-page checkbox.",
);
assert.doesNotMatch(
  indexHtml,
  /select-all-rows-button|unselect-all-rows-button|全選本頁|取消本頁/u,
  "Legacy bulk-action buttons must not duplicate the output-header checkbox.",
);
assert.match(
  dataPreviewViewSource,
  /visibleSourceRows = visibleRows\.map[\s\S]*?visibleRowsCheckbox\.indeterminate = selection\.indeterminate[\s\S]*?onVisibleRowsIncludedChange\(visibleSourceRows, visibleRowsCheckbox\.checked\)/u,
  "Bulk selection must be limited to the current filter and page.",
);
assert.match(
  dataPreviewViewSource,
  /`第 \$\{currentPage \+ 1\} \/ \$\{pageCount\} 頁 · \$\{pageStart \+ 1\}–\$\{pageStart \+ visibleRows\.length\} \/ \$\{filteredRows\.length\} 列`/u,
  "Preview pagination must use one concise page-and-range status line.",
);
assert.match(
  dataPreviewViewSource,
  /outputControl\.className = "row-output-control"[\s\S]*?outputControl\.append\(outputCheckbox\)[\s\S]*?outputCell\.append\(outputControl\)/u,
  "Each preview output checkbox must use a cell-filling label target.",
);
assert.match(
  encodingSource,
  /export const UNRECOGNIZED_CHARACTER = "■"/u,
  "Unrecognized characters must use one shared fullwidth-block marker.",
);
assert.match(
  dataPreviewViewSource,
  /isPrivateUseCodePoint\(codePoint\)[\s\S]*?\? UNRECOGNIZED_CHARACTER[\s\S]*?previewCellValue\(displayedValue\)/u,
  "Preview masking must render unresolved private-use characters as fullwidth blocks.",
);
assert.match(
  dataPreviewViewSource,
  /previewChangeDetail[\s\S]*?previewCellValue\(change\.before\)[\s\S]*?row\.changes\.map\(previewChangeDetail\)/u,
  "Hover correction details must mask unresolved private-use characters.",
);
assert.match(
  outputValidationSource,
  /\.map\(\(\{ codePoint \}\) => `「\$\{UNRECOGNIZED_CHARACTER\}」（\$\{unicodeLabel\(codePoint\)\}）`\)/u,
  "BIG-5E output problems must mask unsupported Unicode while retaining its code point.",
);
assert.match(
  dataPreviewViewSource,
  /rowIssues\(row, file\)\.map\(issueDetail\)[\s\S]*?row\.changes\.map/u,
  "An error-dominant row must retain every warning and correction in its detail box.",
);
assert.doesNotMatch(dataPreviewViewSource, /PRIVATE_USE_RECOVERED[\s\S]*?filter/u);
assert.match(
  indexHtml,
  /<ul id="output-issue-list"[^>]*hidden><\/ul>/u,
  "Section 2 must provide a dedicated list for detailed download problems.",
);
assert.doesNotMatch(indexHtml, /settings-file|settings-status|source-encoding|workflow-tab/u);
assert.doesNotMatch(indexHtml, /正向轉換|反向轉換|全域設定|欄位設定/u);
assert.doesNotMatch(indexHtml, /內部資料|adapter|pipeline|正規化/u);
assert.match(
  indexHtml,
  /id="file-tree-table"[^>]*role="treegrid"[^>]*aria-describedby="file-tree-help"[\s\S]*?<tbody id="file-tree"><\/tbody>/u,
  "The batch inventory tree-table must expose keyboard guidance.",
);
assert.match(indexHtml, /id="data-workspace"[^>]*\shidden(?:\s|>)/u);
assert.match(indexHtml, /id="cell-tooltip"[^>]*role="tooltip"[^>]*hidden/u);
assert.doesNotMatch(indexHtml, /file-issue-list|問題與修改/u);
for (let fieldIndex = 1; fieldIndex <= 15; fieldIndex += 1) {
  assert.match(
    indexHtml,
    new RegExp(`<th scope="col" aria-label="欄位${fieldIndex}">${fieldIndex}<\\/th>`, "u"),
    `Preview field ${fieldIndex} must use a compact visual index and an accessible label.`,
  );
}
assert.doesNotMatch(indexHtml, /id="source-file-picker"[^>]*aria-describedby=/u);
assert.doesNotMatch(
  indexHtml,
  /id="(?:data-table-body|workspace-results)"[^>]*aria-live/u,
  "Large data updates must not be exposed as a live region.",
);
assert.match(
  indexHtml,
  /class="header-meta"[\s\S]*?<p class="eyebrow">瀏覽器本機處理<\/p>[\s\S]*?class="header-meta__separator"[^>]*>·<\/span>[\s\S]*?id="readiness-status"[^>]*class="status-indicator readiness-status"[^>]*data-tone="info"[^>]*data-loading="true"[\s\S]*?class="status-indicator__text">載入必要元件<\/span>/u,
);
assert.doesNotMatch(
  indexHtml,
  /id="readiness-status"[^>]*(?:role|aria-live)=/u,
  "Background readiness progress must not behave as a live region.",
);
assert.doesNotMatch(indexHtml, /readiness-status__indicator/u);
assert.doesNotMatch(indexHtml, /id="app-loading"/u);
assert.match(indexHtml, /id="app-status" class="visually-hidden"/u);
assert.match(
  indexHtml,
  /id="app-status"[^>]*role="status"[^>]*aria-live="polite"/u,
);
assert.match(indexHtml, /id="file-processing-indicator"[\s\S]*?\shidden/u);
assert.match(
  indexHtml,
  /class="file-processing-slot"[\s\S]*?id="file-processing-indicator"/u,
  "The file processing indicator must keep a stable layout slot.",
);
assert.match(
  indexHtml,
  /id="file-status"[\s\S]*?class="file-processing-slot"/u,
  "The file name must stay left-aligned while the stable spinner slot remains trailing.",
);
assert.match(
  indexHtml,
  /id="file-status"[\s\S]*?id="source-file-name"[\s\S]*?class="file-processing-slot"/u,
  "The friendly file status and stable processing slot must remain together.",
);
assert.doesNotMatch(indexHtml, /id="source-file-meta"/u, "The action area must not repeat file counts or total size.");
assert.match(
  indexHtml,
  /id="clear-workspace-button"[^>]*>清空清單<\/button>/u,
  "Clearing the in-memory workspace must be explicit.",
);
assert.match(
  indexHtml,
  /id="mark-all-viewed-button"[\s\S]*?id="select-source-button"[\s\S]*?id="clear-workspace-button"/u,
  "The optional mark-all-viewed action must appear before stable add and clear actions.",
);
assert.doesNotMatch(
  indexHtml,
  /deselect-source-button|start-over-button|清除檔案/u,
  "Legacy destructive-sounding source actions must not return.",
);
assert.match(
  indexHtml,
  /class="output-format-control"/u,
  "Output choices must use the compact native-select control.",
);
assert.match(
  indexHtml,
  /id="file-tree-table" class="inventory-table"[\s\S]*?<th scope="col">檔案<\/th><th scope="col">資料<\/th><th scope="col">正確<\/th><th scope="col">錯誤<\/th><th scope="col">警告<\/th><th scope="col">已選列數<\/th><th id="inventory-output-heading" scope="col">輸出問題<\/th><th scope="col">移除<\/th>[\s\S]*?id="file-tree-total"/u,
  "Section 1 must own the aggregated hierarchy and output-problem summary.",
);
assert.doesNotMatch(
  indexHtml,
  /file-tree-pane|file-tree-count|file-tree-heading/u,
  "The hierarchy must not be wrapped in a repeated sub-region or file-count heading.",
);
assert.doesNotMatch(
  indexHtml,
  /workspace-empty/u,
  "The empty workspace must use the real blank tree instead of a placeholder notice.",
);
assert.doesNotMatch(
  indexHtml,
  /id="workspace-results"[^>]*\shidden/u,
  "The working tree must remain visible when it contains zero files.",
);
assert.doesNotMatch(
  resultStyles,
  /\.file-tree-marker|\.file-tree-kind-icon/u,
  "The hierarchy must rely on disclosure and indentation instead of decorative dots or icons.",
);
assert.doesNotMatch(indexHtml, /compact-summary|output-selected-summary|output-tree-summary/u);
assert.match(
  dataPreviewViewSource,
  /label:\s*"正確",\s*tone:\s*"valid"/u,
  "The preview row status must use the same correct-row label as its filter and summaries.",
);
assert.match(
  indexHtml,
  /id="output-heading">輸出格式[\s\S]*?依下方提示處理後再下載[\s\S]*?id="output-format"[\s\S]*?id="output-problem-link"[^>]*href="#file-tree-table"/u,
  "Section 2 must stay concise and link back to Section 1 problems.",
);
assert.match(
  indexHtml,
  /id="source-file-message"[^>]*hidden/u,
);
assert.doesNotMatch(indexHtml, /id="source-file-message"[^>]*tabindex=/u);
assert.match(
  indexHtml,
  /id="advanced-step"[\s\S]*?id="reference-file"[^>]*accept="\.xls,\.xlsx"[\s\S]*?id="reference-key-column"[\s\S]*?id="reference-column-options"[\s\S]*?id="advanced-download-button"[\s\S]*?<\/section>/u,
  "Section 3 must expose its separate reference picker, lookup mapping, and XLSX download.",
);
assert.doesNotMatch(
  indexHtml,
  /id="advanced-step"[\s\S]*?尚未開放[\s\S]*?<\/section>/u,
  "The implemented advanced section must not retain the deferred placeholder.",
);
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
assert.doesNotMatch(
  `${componentStyles}\n${reusableComponentStyles}\n${bootstrapStyles}\n${resultStyles}`,
  /#[\da-f]{3,8}\b|rgba?\(/iu,
  "Component styles must consume shared palette tokens instead of color literals.",
);
assert.doesNotMatch(
  `${componentStyles}\n${reusableComponentStyles}\n${bootstrapStyles}\n${resultStyles}`,
  /border(?:-(?:top|right|bottom|left))?:\s*1px\s+solid/u,
  "Component styles must consume shared border primitives.",
);
assert.doesNotMatch(
  `${componentStyles}\n${reusableComponentStyles}\n${bootstrapStyles}\n${resultStyles}`,
  /border-radius:\s*(?:0?\.\d+rem|999px)/u,
  "Component styles must consume shared radius primitives.",
);
assert.match(
  foundationStyles,
  /--radius-ui:\s*0\.625rem/u,
  "Common UI containers must share one radius.",
);
assert.match(
  foundationStyles,
  /--border-ui:\s*var\(--border-width-ui\)\s+solid\s+var\(--color-border\)/u,
  "Common UI containers must share one border primitive.",
);
assert.match(
  foundationStyles,
  /\.responsive-grid\s*\{[\s\S]*?auto-fit[\s\S]*?--responsive-column-min/u,
  "Reusable grids must adapt from their available width.",
);
assert.match(
  foundationStyles,
  /:where\([\s\S]*?dialog,[\s\S]*?\.panel,[\s\S]*?\.notice,[\s\S]*?\)\s*\{[\s\S]*?border:\s*var\(--border-ui\);[\s\S]*?border-radius:\s*var\(--radius-ui\);/u,
  "Dialogs, panels, notices, and related surfaces must share geometry.",
);
assert.match(
  baseCss,
  /--color-success-bg:/u,
  "The shared palette must provide a success surface.",
);
assert.match(
  baseCss,
  /--color-warning-border:/u,
  "The shared palette must provide a warning border.",
);
assert.match(
  baseCss,
  /--color-error-bg:/u,
  "The shared palette must provide an error surface.",
);
assert.match(
  baseCss,
  /--color-info-text:/u,
  "The shared palette must provide an informational foreground.",
);
assert.match(
  baseCss,
  /\.header-badges\{[^}]*width:min\(100%,9\.5rem\)/u,
  "The theme control must keep its reserved width without overflowing.",
);
assert.match(
  baseCss,
  /\.theme-toggle\{[^}]*width:100%[^}]*height:var\(--control-height-compact\)/u,
  "The theme capsule must fill the reserved header width.",
);
const headerMetaRule = baseCss.match(/\.header-meta\{[^}]*\}/u)?.[0];
assert.ok(headerMetaRule, "The header metadata rule must exist.");
assert.match(
  headerMetaRule,
  /display:flex/u,
  "The eyebrow and readiness status must share one flex line.",
);
assert.match(
  headerMetaRule,
  /min-height:1\.5rem/u,
  "The eyebrow and readiness status must reserve one stable line.",
);
assert.match(
  reusableComponentStyles,
  /\.status-indicator\s*\{[^}]*width:\s*var\(--status-indicator-width, auto\)[^}]*min-height:\s*var\(--status-indicator-height, 1\.5rem\)[^}]*border:\s*0/u,
  "The reusable status indicator must own stable, configurable geometry.",
);
assert.match(
  bootstrapStyles,
  /\.readiness-status\s*\{[^}]*--status-indicator-width:\s*7\.75rem[^}]*--status-indicator-height:\s*1\.5rem/u,
  "The header readiness instance must reserve its established slot.",
);
const readinessStatusRule = reusableComponentStyles.match(/\.status-indicator\s*\{[^}]*\}/u)?.[0];
assert.ok(readinessStatusRule, "The reusable status indicator rule must exist.");
assert.doesNotMatch(
  readinessStatusRule,
  /(?:background|box-shadow|text-shadow|filter):/u,
  "The readiness status container must not render a box or glow.",
);
const readinessShimmer = baseCss.match(
  /@keyframes status-indicator-text-shimmer\{[\s\S]*?\}\}/u,
)?.[0];
assert.ok(readinessShimmer, "Loading readiness states must use a text shimmer.");
assert.match(readinessShimmer, /background-position:/u);
assert.doesNotMatch(
  readinessShimmer,
  /(?:box-shadow|text-shadow|filter|opacity|transform):/u,
  "The loading shimmer must not animate glow, opacity, filters, or geometry.",
);
assert.match(
  baseCss,
  /prefers-reduced-motion:reduce[\s\S]*?background-image:none/u,
  "Reduced-motion users must receive static readiness text.",
);
assert.match(
  baseCss,
  /forced-colors:active[\s\S]*?background-image:none/u,
  "Forced-color users must receive static readiness text.",
);
assert.match(
  baseCss,
  /\.file-processing-slot\{[^}]*width:var\(--indicator-size\)[^}]*height:var\(--indicator-size\)/u,
  "File processing must keep a stable indicator slot.",
);
assert.match(
  componentStyles,
  /\.panel\s*\{[^}]*container-name:\s*panel[^}]*container-type:\s*inline-size/u,
  "Workflow panels must provide reusable inline-size containers.",
);
assert.match(
  componentStyles,
  /@container panel \(max-width:\s*36rem\)[\s\S]*?\.rules-panel details > summary\s*\{[\s\S]*?flex-direction:\s*column/u,
  "The rules disclosure must reflow from panel width before it overflows.",
);
assert.match(
  componentStyles,
  /@container panel \(max-width:\s*36rem\)[\s\S]*?\.file-status-line\s*\{[\s\S]*?height:\s*4\.5rem[\s\S]*?min-height:\s*4\.5rem/u,
  "Narrow filename states must reserve stable multi-line space.",
);
const tableScrollRule = componentStyles.match(/\.table-scroll\s*\{[^}]*\}/u)?.[0];
assert.ok(tableScrollRule, "Horizontal table scrolling must remain defined.");
assert.doesNotMatch(
  tableScrollRule,
  /scrollbar-gutter:\s*stable/u,
  "Horizontal-only tables must not reserve an unused vertical scrollbar gutter.",
);
assert.match(
  resultStyles,
  /\.data-table\s*\{[^}]*width:\s*max-content[^}]*min-width:\s*100%/u,
  "The preview table must expand from intrinsic fixed-field widths.",
);
assert.match(
  resultStyles,
  /\.data-table :is\(th, td\):nth-child\(12\)\s*\{[^}]*--preview-field-width:\s*120ch/u,
  "Field 9 must reserve its complete 120-byte display width.",
);
assert.match(
  resultStyles,
  /\.data-table thead th\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/u,
  "Preview headers must remain visible while rows scroll.",
);
assert.match(
  resultStyles,
  /\.data-table thead th:nth-child\(n \+ 4\)\s*\{[^}]*text-align:\s*left/u,
  "Preview field indexes 1 through 15 must align with left-aligned cell content.",
);
assert.match(
  dataPreviewViewSource,
  /const FILTERABLE_ROW_STATES:[\s\S]*?function syncFilterOptions\(file: InternalFile, outputIssues: readonly OutputIssue\[\]\): void \{[\s\S]*?option\.disabled = !file\.rows\.some\(\(row\) => rowMatches\(row, file, outputIssues, filter\)\);[\s\S]*?rowFilter\.value = "all";/u,
  "Filters without matching rows must be disabled, with a safe fallback to all rows.",
);
assert.match(
  resultStyles,
  /\.data-table-scroll\s*\{[^}]*height:[^;]+;[^}]*min-height:[^;]+;[^}]*overflow:\s*auto[^}]*scrollbar-gutter:\s*stable/u,
  "The preview viewport must keep a stable height and its horizontal scrollbar at the bottom.",
);
assert.match(
  resultStyles,
  /\.data-table\s*\{[^}]*--preview-row-height:\s*2\.4rem[^}]*width:\s*max-content/u,
  "The preview table must own one reusable natural row-height value.",
);
assert.doesNotMatch(
  resultStyles,
  /\.data-table\s*\{[^}]*height:\s*100%/u,
  "The preview table must not stretch short result sets to fill the viewport.",
);
assert.match(
  resultStyles,
  /\.data-table tbody tr\s*\{[^}]*height:\s*var\(--preview-row-height\)/u,
  "Real, empty, and placeholder preview rows must share one stable row height.",
);
assert.match(
  resultStyles,
  /\.preview-placeholder-row\s*>\s*td\s*\{[^}]*padding-block:\s*0[^}]*pointer-events:\s*none/u,
  "Short preview results must retain non-interactive blank cellular rows.",
);
assert.match(
  dataPreviewViewSource,
  /const PREVIEW_ROW_SLOTS = 14;[\s\S]*?placeholder\.className = "preview-placeholder-row";[\s\S]*?placeholder\.setAttribute\("aria-hidden", "true"\)/u,
  "The preview must pad short or empty result sets with hidden blank rows.",
);
assert.match(
  resultStyles,
  /\.filter-control\s*\{[^}]*white-space:\s*nowrap/u,
  "The preview filter label must not collapse into vertical text.",
);
assert.match(
  resultStyles,
  /\.data-cell-value\s*\{[^}]*font-family:\s*"Sarasa Mono TC"/u,
  "Preview cells must use the deferred fixed-width font when it is ready.",
);
assert.match(
  componentStyles,
  /\.step-heading\s*>\s*span:first-child\s*\{/u,
  "Only the first step-heading child may receive the numbered circle treatment.",
);
assert.match(
  componentStyles,
  /:where\(\[hidden\]\)\s*\{[^}]*display:\s*none/u,
  "Component display rules must not override the hidden attribute.",
);
assert.match(
  resultStyles,
  /\[hidden\]\s*\{[^}]*display:\s*none/u,
  "Result components must not display empty hidden notices.",
);
assert.doesNotMatch(resultStyles, /\.issue-(?:list|card)/u);
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
assert.match(
  bootSource,
  /localStorage\.getItem\("csv2txt\.theme"\)/u,
  "The early boot script must restore the saved theme before first paint.",
);
assert.match(
  themeSource,
  /requestAnimationFrame\(\(\) => \{[\s\S]*?getComputedStyle\(document\.documentElement\)\.backgroundColor[\s\S]*?meta\[name="theme-color"\][\s\S]*?\}\);/u,
  "Theme-color synchronization must defer its computed-style read until the next frame.",
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
assert.match(
  llmsTxt,
  /^#\s+\S.+$/mu,
  "Agent discovery must provide a Markdown H1.",
);
assert.ok(
  llmsTxt.length >= 50,
  "Agent discovery content must not be suspiciously short.",
);
assert.match(
  llmsTxt,
  /\[[^\]]+\]\(https:\/\/[^)]+\)/u,
  "Agent discovery must provide at least one Markdown link.",
);
for (const capability of ["CSV", "BIG-5E TXT", "XLSX", "ZIP", "不會上傳"]) {
  assert.ok(
    llmsTxt.includes(capability),
    `Agent discovery is missing a current capability or privacy statement: ${capability}`,
  );
}
assert.match(
  robotsTxt,
  /^User-agent:\s*\*\s*$/mu,
  "robots.txt must declare the default crawler group.",
);
assert.match(
  robotsTxt,
  /^Allow:\s*\/\s*$/mu,
  "robots.txt must allow the published application path.",
);
assert.match(
  robotsTxt,
  /^Sitemap:\s*https:\/\/sleek874\.github\.io\/csv2txt\/sitemap\.xml\s*$/mu,
  "robots.txt must reference the canonical sitemap URL.",
);
assert.match(
  sitemapXml,
  /<loc>https:\/\/sleek874\.github\.io\/csv2txt\/<\/loc>/u,
  "The sitemap must expose the canonical application URL.",
);
assert.match(
  indexHtml,
  /connect-src 'none'/u,
  "The production CSP must continue to block runtime connections.",
);
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
