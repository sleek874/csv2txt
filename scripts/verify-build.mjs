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
const advancedPreferencesSource = readFileSync(
  new URL("../src/browser/advanced-preferences.ts", import.meta.url),
  "utf8",
);
const inputSectionViewSource = readFileSync(
  new URL("../src/app/sections/input/input-section-view.ts", import.meta.url),
  "utf8",
);
const encodingSource = readFileSync(
  new URL("../src/core/encoding.ts", import.meta.url),
  "utf8",
);
const big5TxtSource = readFileSync(
  new URL("../src/core/formats/big5-txt.ts", import.meta.url),
  "utf8",
);
const outputValidationSource = readFileSync(
  new URL("../src/core/output-validation.ts", import.meta.url),
  "utf8",
);
const normalizationSource = readFileSync(
  new URL("../src/core/normalization.ts", import.meta.url),
  "utf8",
);
const outputAdapterSource = readFileSync(
  new URL("../src/app/adapters/output-adapter.ts", import.meta.url),
  "utf8",
);
const outputPlanSource = readFileSync(
  new URL("../src/app/sections/output/output-plan.ts", import.meta.url),
  "utf8",
);
const outputControllerSource = readFileSync(
  new URL("../src/app/sections/output/output-controller.ts", import.meta.url),
  "utf8",
);
const otherFilesViewSource = readFileSync(
  new URL("../src/app/sections/input/other-files-view.ts", import.meta.url),
  "utf8",
);
const fileTableViewSource = readFileSync(
  new URL("../src/app/sections/input/file-table-view.ts", import.meta.url),
  "utf8",
);
const fileTreeViewSource = readFileSync(
  new URL("../src/app/sections/input/file-tree-view.ts", import.meta.url),
  "utf8",
);
const fileOperationStatusViewSource = readFileSync(
  new URL("../src/app/sections/input/file-operation-status-view.ts", import.meta.url),
  "utf8",
);
const fileSizePolicySource = readFileSync(
  new URL("../src/core/file-size-policy.ts", import.meta.url),
  "utf8",
);
const formatControllerSource = readFileSync(
  new URL("../src/app/sections/format/format-controller.ts", import.meta.url),
  "utf8",
);
const workspaceTypesSource = readFileSync(
  new URL("../src/app/state/workspace-types.ts", import.meta.url),
  "utf8",
);
const stateTransitionSource = readFileSync(
  new URL("../src/app/shell/state-transition.ts", import.meta.url),
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
const workerPaths = readPathGroup("WORKER_PATHS");
const fontPaths = readPathGroup("FONT_PATHS");
const expectedBaseFiles = collectManifestGroup(["index.html", "src/main.ts"]);
const emittedAssets = readdirSync(new URL("assets/", distUrl)).map((file) => `assets/${file}`);
const expectedExcelFiles = new Set(emittedAssets.filter((file) => /\/(?:spreadsheet|worker-excel)-.*\.js$/u.test(file)));
const expectedArchiveFiles = new Set(emittedAssets.filter((file) => /\/(?:zip|worker-archive)-.*\.js$/u.test(file)));
const expectedWorkerFiles = new Set(emittedAssets.filter((file) => /\/(?:batch-worker|private-use-recovery-mapping)-.*\.js$/u.test(file)));
const expectedFontFiles = collectManifestGroup([
  "src/styles/preview-font.css",
  "src/assets/fonts/SarasaMonoTC-Regular.woff2",
]);
expectedFontFiles.forEach((file) => {
  expectedBaseFiles.delete(file);
  expectedExcelFiles.delete(file);
  expectedArchiveFiles.delete(file);
  expectedWorkerFiles.delete(file);
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
  workerPaths,
  relativePaths(expectedWorkerFiles),
  "Worker resources must match the emitted worker graph.",
);
assert.deepEqual(
  fontPaths,
  relativePaths(expectedFontFiles),
  "Font resources must match the Vite manifest graph.",
);

const expectedBuildId = createHash("sha256")
  .update(manifestSource)
  .update("\n")
  .update(JSON.stringify({ archivePaths, excelPaths, workerPaths }))
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

for (const path of [...precachePaths, ...excelPaths, ...archivePaths, ...workerPaths, ...fontPaths]) {
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
assert.match(indexHtml, /每個檔案上限 100 MB/u);
assert.match(indexHtml, /選擇要用來補充資料的 Excel；檔案上限 100 MB/u);
assert.match(fileSizePolicySource, /FILE_SIZE_LIMIT_MIB = 100/u);
assert.match(fileOperationStatusViewSource, /FILE_SIZE_LIMIT_LABEL/u);
assert.doesNotMatch(indexHtml, /25 M(?:B|iB)/u);
assert.doesNotMatch(indexHtml, /id="app"[^>]*\shidden(?:\s|>)/u);
assert.match(indexHtml, /<html[^>]*class="no-js"/u);
assert.doesNotMatch(indexHtml, /noscript\.css/u);
assert.match(
  indexHtml,
  /<main id="app-content"[^>]*\sinert>/u,
  "The application must stay inert until its controller is ready.",
);
for (const sectionId of [
  "format-step",
  "input-step",
  "output-step",
  "advanced-step",
  "rules-step",
]) {
  assert.match(indexHtml, new RegExp(`<section id="${sectionId}"`, "u"));
}
assert.ok(
  ["format-step", "input-step", "output-step", "advanced-step", "rules-step"]
    .map((id) => indexHtml.indexOf(`id="${id}"`))
    .every((position, index, positions) => index === 0 || position > (positions[index - 1] ?? -1)),
  "The workflow and trailing rules reference must preserve their fixed order.",
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
assert.match(
  indexHtml,
  /id="input-format"[\s\S]*?>TXT<\/option>[\s\S]*?>CSV<\/option>[\s\S]*?>XLSX<\/option>[\s\S]*?id="selected-output-format"[\s\S]*?>TXT<\/option>[\s\S]*?>CSV<\/option>[\s\S]*?>XLSX<\/option>/u,
  "Section 0 must expose independent native input and output selects with concise labels.",
);
assert.doesNotMatch(indexHtml, /id="output-format"|TXT（BIG-5E）|CSV（UTF-8）/u);
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
  /`第 \$\{currentPage \+ 1\} \/ \$\{page\.pageCount\} 頁 · \$\{page\.pageStart \+ 1\}–\$\{page\.pageStart \+ visibleRecords\.length\} \/ \$\{page\.totalRecords\} 列`/u,
  "Preview pagination must use one concise page-and-range status line.",
);
assert.match(
  dataPreviewViewSource,
  /outputControl\.className = "row-output-control"[\s\S]*?outputControl\.append\(outputCheckbox\)[\s\S]*?outputCell\.append\(outputControl\)/u,
  "Each preview output checkbox must use a cell-filling label target.",
);
assert.match(
  encodingSource,
  /export const UNKNOWN_CHARACTER = "？"/u,
  "Unknown input and output characters must use one shared fullwidth question mark.",
);
assert.match(
  encodingSource,
  /export const UNRECOGNIZED_CHARACTER = "■"/u,
  "Preview-only unrecognized characters must use one shared fullwidth-block marker.",
);
assert.match(
  normalizationSource,
  /removeWhitespace\(value\)\.replaceAll\("\?", "？"\)/u,
  "Input normalization must convert ASCII question marks to fullwidth question marks.",
);
assert.match(
  dataPreviewViewSource,
  /previewCellValue\([\s\S]*?replacements\.has\(characterIndex\)[\s\S]*?isPrivateUseCodePoint\(codePoint\)[\s\S]*?\? UNRECOGNIZED_CHARACTER[\s\S]*?previewCellValue\(displayedValue, replacementCharacterIndices\)/u,
  "Preview masking must render unresolved PUA and tracked replacement positions as fullwidth blocks.",
);
assert.match(
  dataPreviewViewSource,
  /previewChangeDetail[\s\S]*?previewCellValue\(change\.before\)[\s\S]*?row\.changes\.map\(previewChangeDetail\)/u,
  "Correction details must mask unresolved private-use characters.",
);
assert.match(
  encodingSource,
  /export function decodeBig5EPartially[\s\S]*?decoded \+= UNKNOWN_CHARACTER[\s\S]*?characterIndex: characterCount[\s\S]*?return \{ text: decoded, unrecognized \}/u,
  "BIG-5E decoding must preserve valid text and record question-mark replacement positions.",
);
assert.match(
  encodingSource,
  /export function encodeBig5EWithReplacement[\s\S]*?big5eEncodedCode\(UNKNOWN_CHARACTER\.codePointAt\(0\)[\s\S]*?substitutions\.push\(\{ character, characterIndex, codePoint \}\)/u,
  "BIG-5E output must replace only unmapped Unicode and retain its diagnostic positions.",
);
assert.match(
  big5TxtSource,
  /decodeBig5EPartially\(fieldBytes\)[\s\S]*?row\.push\(decoded\.text\)[\s\S]*?code: "UNDECODABLE_BIG5E_BYTES"[\s\S]*?replacementCharacterIndices[\s\S]*?technicalDetail/u,
  "BIG-5E input must retain partially decoded fields and targeted byte evidence.",
);
assert.match(
  big5TxtSource,
  /serializeBig5Txt[\s\S]*?encodeBig5EWithReplacement\(value\)\.bytes[\s\S]*?encoded\.length > width/u,
  "BIG-5E serialization must substitute before enforcing fixed byte width.",
);
assert.match(
  outputValidationSource,
  /\.map\(\(\{ codePoint \}\) => `「\$\{UNRECOGNIZED_CHARACTER\}」（\$\{unicodeLabel\(codePoint\)\}）`\)/u,
  "BIG-5E output problems must mask unsupported Unicode while retaining its code point.",
);
assert.match(
  outputValidationSource,
  /blocking: false,[\s\S]*?code: "OUTPUT_UNENCODABLE"[\s\S]*?blocking: true,[\s\S]*?code: "OUTPUT_WIDTH_OVERFLOW"/u,
  "Unmapped characters must be notices while post-substitution width overflow remains blocking.",
);
assert.match(
  outputPlanSource,
  /blockingOutputIssues = files\.flatMap[\s\S]*?file\.blockingOutputIssues[\s\S]*?hasProblems = problems\.length > 0 \|\| blockingOutputIssues\.length > 0[\s\S]*?&& !hasProblems/u,
  "Download eligibility must use only structural problems and blocking output findings.",
);
assert.match(
  outputAdapterSource,
  /validateOutput\(files, format\)\.find\(\(issue\) => issue\.blocking\)/u,
  "The output adapter must reject only blocking format findings.",
);
assert.match(
  dataPreviewViewSource,
  /rowIssues\(row, pageFile\)\.map\(issueDetail\)[\s\S]*?row\.changes\.map/u,
  "An error-dominant row must retain every warning and correction in its detail box.",
);
assert.doesNotMatch(dataPreviewViewSource, /PRIVATE_USE_RECOVERED[\s\S]*?filter/u);
assert.match(
  indexHtml,
  /<details id="output-issue-disclosure"[^>]*class="action-issue-disclosure"[^>]*hidden>[\s\S]*?<summary id="output-issue-summary"[^>]*class="issue-disclosure-toggle action-issue-toggle">[\s\S]*?<ul id="output-issue-list"[^>]*class="action-issue-list"/u,
  "Section 2 must keep detailed download problems in the shared collapsed disclosure.",
);
assert.match(
  indexHtml,
  /<details id="advanced-issue-disclosure"[^>]*class="action-issue-disclosure"[^>]*hidden>[\s\S]*?<summary id="advanced-issue-summary"[^>]*class="issue-disclosure-toggle action-issue-toggle">[\s\S]*?<ul id="advanced-issue-list"[^>]*class="action-issue-list"/u,
  "Section 3 must keep detailed reminders in the shared collapsed disclosure.",
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
assert.doesNotMatch(indexHtml, /id="cell-tooltip"|role="tooltip"/u);
assert.match(
  indexHtml,
  /aria-label="來源列">列<\/th><th scope="col">狀態<\/th>\s*<th class="row-output-heading"/u,
  "The preview must use status as its only issue disclosure column.",
);
assert.doesNotMatch(dataPreviewViewSource, /row-problem-cell|preview-issue-toggle--problem/u);
assert.match(
  dataPreviewViewSource,
  /button\.className = "issue-disclosure-toggle preview-issue-toggle row-status-text"[\s\S]*?button\.dataset\.issueId = issueId[\s\S]*?button\.setAttribute\("aria-controls", issueId\)[\s\S]*?button\.setAttribute\("aria-expanded"[\s\S]*?issueRow\.hidden = !expandedIssues\.has\(issueId\)/u,
  "Issue details must start collapsed and use explicit accessible controls.",
);
assert.match(
  dataPreviewViewSource,
  /tableBody\.addEventListener\("click"[\s\S]*?issueRow\.hidden = !expanded[\s\S]*?button\.setAttribute\("aria-expanded", String\(expanded\)\)/u,
  "Status cells must toggle their detail row on click.",
);
assert.doesNotMatch(
  dataPreviewViewSource,
  /pointerover|pointerout|cell-tooltip|detail-trigger|\.title\s*=/u,
  "Preview details must not depend on hover tooltips.",
);
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
assert.match(
  indexHtml,
  /id="source-file-picker"[\s\S]*?id="select-source-button"[\s\S]*?id="clear-workspace-button"[\s\S]*?id="file-operation-status"[^>]*class="file-operation-status action-card"[^>]*data-tone="neutral"/u,
  "The static picker must remain independent from the persistent operation banner.",
);
assert.doesNotMatch(
  indexHtml,
  /id="file-operation-status"[^>]*(?:aria-live|role)=/u,
  "Operation details must not become a noisy live region.",
);
assert.match(
  indexHtml,
  /class="action-title-line"[\s\S]*?id="file-operation-title"[\s\S]*?class="action-spinner-slot"[^>]*>[\s\S]*?id="file-operation-spinner"[^>]*hidden/u,
  "The processing spinner must keep a fixed inline slot directly after the operation title.",
);
assert.match(
  indexHtml,
  /id="cancel-file-operation"[^>]*hidden[^>]*>取消本次新增<\/button>/u,
  "Slow processing must offer whole-selection cancellation in the banner.",
);
assert.match(
  indexHtml,
  /id="file-operation-status"[\s\S]*?id="mark-all-viewed-button"[^>]*class="secondary-button"[\s\S]*?id="file-operation-details"[^>]*hidden[\s\S]*?id="file-operation-details-summary"[^>]*class="button-control secondary-button issue-disclosure-toggle"/u,
  "Contextual acknowledgement and collapsed failure details must live in the shared banner.",
);
assert.doesNotMatch(indexHtml, /id="source-file-meta"/u, "The action area must not repeat file counts or total size.");
assert.match(
  indexHtml,
  /id="clear-workspace-button"[^>]*>清空清單<\/button>/u,
  "Clearing the in-memory workspace must be explicit.",
);
assert.doesNotMatch(indexHtml, /id="source-file-picker"[\s\S]*?id="mark-all-viewed-button"[\s\S]*?id="select-source-button"/u);
assert.doesNotMatch(
  indexHtml,
  /deselect-source-button|start-over-button|清除檔案/u,
  "Legacy destructive-sounding source actions must not return.",
);
assert.doesNotMatch(indexHtml, /class="output-format-control"/u);
assert.match(
  indexHtml,
  /id="file-tree-table" class="inventory-table"[\s\S]*?<th scope="col">檔案<\/th><th scope="col">空白列<\/th><th scope="col">無法解析<\/th><th scope="col">資料<\/th><th scope="col">正確<\/th><th scope="col">錯誤<\/th><th scope="col">警告<\/th><th scope="col">已選<\/th><th id="inventory-output-heading" scope="col">輸出問題<\/th><th scope="col">移除<\/th>[\s\S]*?id="file-tree-total"/u,
  "Section 1 must own the aggregated hierarchy and output-problem summary.",
);
assert.match(
  indexHtml,
  /id="active-files-tab"[^>]*>[\s\S]*?id="active-files-format">TXT<\/span>[\s\S]*?id="other-files-tab"[^>]*>其他檔案/u,
  "The selected-format tab must use the visible input-format label.",
);
assert.match(
  indexHtml,
  /class="workspace-tabs segmented-tabs"[^>]*role="tablist"/u,
  "File-category tabs must use the shared segmented-control presentation.",
);
assert.match(
  indexHtml,
  /id="active-files-panel"[\s\S]*?class="table-scroll inventory-table-scroll"[\s\S]*?id="file-tree-table"[\s\S]*?id="file-tree-total"[\s\S]*?id="other-files-panel"[\s\S]*?class="table-scroll inventory-table-scroll"[\s\S]*?class="inventory-table other-files-table"[\s\S]*?<th scope="col">檔案<\/th><th scope="col">格式<\/th><th scope="col">狀態<\/th><th scope="col">移除<\/th>[\s\S]*?id="other-files-list"[\s\S]*?id="other-files-total"/u,
  "Both tabs must use the same inventory shell with a persistent footer.",
);
assert.match(
  indexHtml,
  /id="other-files-panel"[\s\S]*?id="other-files-total"[\s\S]*?id="preview-region"[\s\S]*?id="data-workspace"/u,
  "The shared preview must remain outside both file-list tab panels.",
);
assert.doesNotMatch(
  indexHtml,
  /id="(?:active|other)-files-panel"[^>]*state-transition/u,
  "Whole file-list tab panels must switch atomically without display transitions.",
);
assert.match(
  inputSectionViewSource,
  /previewRegion\.dataset\.visible = String\(active\)[\s\S]*?previewRegion\.setAttribute\("aria-hidden", String\(!active\)\)[\s\S]*?previewRegion\.inert = !active[\s\S]*?previewRegionTransition\.update\(active \? "visible" : "hidden"\)/u,
  "Tab selection must preserve preview state and geometry while controlling its separate region.",
);
assert.match(
  resultStyles,
  /\.preview-region\[data-visible="false"\]\s*\{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/u,
  "The inactive preview must disappear without collapsing document height.",
);
assert.match(
  otherFilesViewSource,
  /nameCell\.className = "inventory-name-cell"[\s\S]*?itemCopy\.className = "file-tree-item other-file-item"[\s\S]*?format\.className = "other-file-format"[\s\S]*?status\.className = "other-file-status"[\s\S]*?removeCell\.className = "inventory-remove-cell"[\s\S]*?remove\.className = "file-tree-remove"[\s\S]*?remove\.textContent = "×"[\s\S]*?completeFileTableBody/u,
  "Other files must reuse working-tree rows, aligned remove controls, and the shared table body completion.",
);
assert.match(
  fileTableViewSource,
  /row\.className = options\.hasRows \? "inventory-table-spacer" : "inventory-table-empty-row"[\s\S]*?cell\.colSpan = options\.columnCount[\s\S]*?cell\.className = "empty-table-message"[\s\S]*?message\.className = "empty-table-message-copy"[\s\S]*?`全部 \$\{fileCount\} 個檔案`/u,
  "Both file tabs must use one shared spacer, empty row, and footer renderer.",
);
assert.match(
  resultStyles,
  /\.inventory-table-scroll\s*\{[^}]*height:\s*24rem[^}]*overflow:\s*auto/u,
  "The shared inventory shell must preserve the same viewport height in every state.",
);
assert.match(
  resultStyles,
  /\.inventory-table \.inventory-table-empty-row\s*\{[^}]*height:\s*100%[\s\S]*?\.inventory-table \.inventory-table-empty-row \.empty-table-message\s*\{[^}]*width:\s*auto[^}]*min-width:\s*0[^}]*max-width:\s*none[^}]*padding:\s*0[^}]*vertical-align:\s*middle[\s\S]*?\.empty-table-message-copy\s*\{[^}]*position:\s*sticky[^}]*left:\s*0[^}]*width:\s*100cqw[^}]*text-align:\s*center/u,
  "The shared inventory shell must center every empty state in the visible scroll viewport.",
);
assert.match(
  fileTreeViewSource,
  /completeFileTableBody\(tree,[\s\S]*?`目前沒有 \$\{FILE_FORMAT_LABELS\[[^\]]+\]\} 檔案。`[\s\S]*?updateFileTableFooter/u,
  "The selected-format table must use the shared empty and footer renderers.",
);
assert.match(
  fileTreeViewSource,
  /clear\(inputFormat\)[\s\S]*?completeFileTableBody\(tree,[\s\S]*?hasRows: false[\s\S]*?updateFileTableFooter\(total, 0, Array\(8\)\.fill\("—"\)\)/u,
  "Clearing must produce the same selected-format empty footer as normal rendering.",
);
assert.match(
  otherFilesViewSource,
  /completeFileTableBody\(list,[\s\S]*?emptyMessage: "目前沒有其他檔案。"[\s\S]*?updateFileTableFooter/u,
  "The other-files table must use the same shared empty and footer renderers.",
);
assert.match(
  otherFilesViewSource,
  /FILE_FORMAT_LABELS\[item\.sourceFormat\][\s\S]*?status: "已保留"/u,
  "Other files must contain only retained supported formats.",
);
assert.doesNotMatch(
  otherFilesViewSource,
  /ignoredReason|state === "ignored"|state === "error"|status: "未加入"|不支援（|壓縮檔/u,
  "Upload failures must not return to the retained other-files table.",
);
assert.doesNotMatch(
  `${indexHtml}\n${resultStyles}\n${otherFilesViewSource}`,
  /本次處理|這些檔案已保留，但不會列入本次預覽或輸出|other-files-table-scroll|other-files-empty-row/u,
  "Obsolete tab copy, layout-shifting help, and one-off table markup must not return.",
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
assert.doesNotMatch(
  outputPlanSource,
  /selectedSummary|selectedLabel|omittedRowCount|downloadableRows/u,
  "Section 2 must not rebuild obsolete selected-file or downloadable-row summaries.",
);
assert.match(
  dataPreviewViewSource,
  /label:\s*"正確",\s*tone:\s*"valid"/u,
  "The preview row status must use the same correct-row label as its filter and summaries.",
);
assert.match(
  indexHtml,
  /id="output-heading">下載結果[\s\S]*?輸出格式已在第 0 區選定[\s\S]*?id="download-status-summary"[^>]*class="action-summary"[\s\S]*?id="output-problem-link"[^>]*href="#file-tree-table"/u,
  "Section 2 must keep its concise file and row summary with a link back to Section 1 problems.",
);
assert.match(
  indexHtml,
  /id="output-download-status"[\s\S]*?id="download-status-title"[\s\S]*?id="download-status-spinner"[^>]*hidden/u,
  "Section 2 must reserve a spinner beside its stable download status title.",
);
assert.doesNotMatch(indexHtml, /id="(?:processing-info|source-file-message|file-processing-indicator)"/u);
assert.doesNotMatch(
  `${workspaceTypesSource}\n${fileTreeViewSource}\n${outputPlanSource}`,
  /WorkspaceFileState|item\.state|state === "processing"|normalizeFile\(/u,
  "Published workspace files must not retain the obsolete processing or InternalFile compatibility paths.",
);
assert.match(
  outputPlanSource,
  /type OutputPreparationState = "error" \| "loading" \| "ready"/u,
  "Section 2 output preparation must use an explicit finite state.",
);
assert.doesNotMatch(
  workspaceTypesSource,
  /OutputPreparationState|outputPreparationError|outputPreparationState/u,
  "Section 2 operation state must not leak into the shared workspace snapshot.",
);
assert.doesNotMatch(
  workspaceTypesSource,
  /hasBlockingIssues|outputBlockingRows|outputIssues:|rowCount:/u,
  "Worker summaries must not retain unused or duplicate Section 2 fields.",
);
assert.match(
  outputControllerSource,
  /type Assessment =[\s\S]*?kind: "checking"[\s\S]*?kind: "error"[\s\S]*?async function checkOutput\(\)[\s\S]*?refreshOutput\([\s\S]*?assessment = \{ kind: "idle" \}/u,
  "Output-format preparation must settle in ready or error instead of leaving a permanent spinner.",
);
assert.doesNotMatch(
  formatControllerSource,
  /refreshOutput|setOutputPreparation|BatchClient/u,
  "Section 0 must only publish synchronous format selections.",
);
assert.match(
  indexHtml,
  /id="advanced-step"[\s\S]*?id="reference-file"[^>]*accept="\.xls,\.xlsx"[\s\S]*?id="reference-key-column"[\s\S]*?id="reference-column-options"[\s\S]*?id="advanced-download-button"[\s\S]*?<\/section>/u,
  "Section 3 must expose its separate reference picker, lookup mapping, and XLSX download.",
);
assert.match(
  indexHtml,
  /id="reference-file-name"[\s\S]*?id="reference-status-spinner"[^>]*hidden[\s\S]*?id="advanced-download-title"[\s\S]*?id="advanced-download-spinner"[^>]*hidden/u,
  "Section 3 must reserve spinners beside its reference and download status titles.",
);
assert.match(
  indexHtml,
  /class="action-spinner-slot"[^>]*>[\s\S]*?id="download-status-spinner"[^>]*hidden[\s\S]*?class="action-spinner-slot"[^>]*>[\s\S]*?id="reference-status-spinner"[^>]*hidden[\s\S]*?class="action-spinner-slot"[^>]*>[\s\S]*?id="advanced-download-spinner"[^>]*hidden/u,
  "Loading titles must reserve an inline spinner slot while keeping idle spinners hidden.",
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
assert.match(
  reusableComponentStyles,
  /\.segmented-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[^}]*padding:\s*0\.4rem;[^}]*background:\s*var\(--color-surface-muted\);[\s\S]*?\.segmented-tabs \[role="tab"\]\[aria-selected="true"\]\s*\{[^}]*border-color:\s*var\(--color-accent-border\);[^}]*background:\s*var\(--color-surface\);[^}]*box-shadow:\s*var\(--shadow-ui\);/u,
  "Segmented tabs must preserve a stable rail and clearly raised selected state.",
);
assert.match(
  reusableComponentStyles,
  /\.state-transition\[data-state-transition="a"\][\s\S]*?animation:\s*state-transition-a var\(--transition-fast\);[\s\S]*?@keyframes state-transition-a\s*\{\s*from\s*\{\s*opacity:\s*0\.94;\s*\}[\s\S]*?@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.state-transition,[\s\S]*?\.state-reveal\s*\{\s*animation:\s*none;/u,
  "Semantic updates must share one subtle, reduced-motion-safe settle transition.",
);
assert.doesNotMatch(
  reusableComponentStyles,
  /allow-discrete|@starting-style|opacity:\s*0\.72|\.state-transition[^{]*\{[^}]*(?:display|visibility)/u,
  "State transitions must not fade out or animate layout-affecting visibility changes.",
);
assert.match(
  stateTransitionSource,
  /if \(currentKey !== null && currentKey !== stateKey\)[\s\S]*?root\.dataset\.stateTransition/u,
  "State transitions must replay only for semantic state-key changes.",
);
assert.match(
  fileOperationStatusViewSource,
  /status\.kind === "processing"[\s\S]*?`processing:\$\{status\.progress\.sourceId\}:\$\{status\.progress\.virtualPath\}`[\s\S]*?: status\.kind/u,
  "Processing copy must settle for a new filename without replaying for counter-only progress.",
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
  /\.theme-toggle\{[^}]*width:100%[^}]*height:var\(--control-height-compact\)[^}]*white-space:nowrap/u,
  "The theme capsule must fill its reserved width without wrapping its short label.",
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
  foundationStyles,
  /--action-slot-width:\s*12rem;[\s\S]*?--action-rail-width:\s*24\.5rem;[\s\S]*?--action-gap:\s*0\.5rem;/u,
  "Shared action areas must use the established two-slot measurements.",
);
assert.match(
  componentStyles,
  /\.action-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--action-rail-width\);[^}]*align-items:\s*start;/u,
  "Action cards must align their copy and action rail at the top.",
);
assert.match(
  componentStyles,
  /\.action-card\s*\{[^}]*padding:\s*1rem;[^}]*background:\s*var\(--color-surface-soft\);/u,
  "Action cards must share one surface and inset.",
);
assert.doesNotMatch(
  reusableComponentStyles,
  /\.notice-action\b/u,
  "Obsolete contextual-action sizing must not override the shared button height.",
);
assert.doesNotMatch(
  indexHtml,
  /class="[^"]*(?:notice-action|source-file-picker|download-status-title-line|reference-status-title-line)[^"]*"/u,
  "Shared action markup must not retain superseded layout aliases.",
);
assert.match(
  componentStyles,
  /\.file-operation-status\s*\{[^}]*min-height:\s*4\.625rem;[^}]*border-left:\s*var\(--border-width-emphasis\) solid var\(--color-neutral\);/u,
  "The operation card must reserve its normal size while allowing enlarged content to grow.",
);
assert.match(
  indexHtml,
  /id="source-file-picker"[^>]*class="[^"]*action-card action-layout"[\s\S]*?id="file-operation-status"[^>]*class="file-operation-status action-card"[\s\S]*?id="output-download-status"[^>]*class="[^"]*action-card action-layout"[\s\S]*?id="reference-file-picker"[^>]*class="[^"]*action-card action-layout"[\s\S]*?id="advanced-download-status"[^>]*class="[^"]*action-card action-layout"/u,
  "Sections 1 through 3 must reuse the shared action-card shell.",
);
assert.match(
  componentStyles,
  /\.action-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, var\(--action-slot-width\)\)\);[^}]*align-self:\s*start;[^}]*width:\s*var\(--action-rail-width\);/u,
  "Shared action areas must expose two equal, top-aligned button slots.",
);
assert.match(
  componentStyles,
  /\.issue-disclosure-toggle\s*\{[^}]*position:\s*relative;[^}]*padding-right:[^}]*list-style:\s*none;[\s\S]*?\.issue-disclosure-toggle::after\s*\{[^}]*position:\s*absolute;[^}]*right:[^}]*content:\s*"\+";[\s\S]*?details\[open\] > \.issue-disclosure-toggle::after\s*\{[^}]*content:\s*"−";/u,
  "Issue disclosures across the site must share the preview-style open and close marker.",
);
assert.match(
  componentStyles,
  /\.action-actions-single\s*>\s*:first-child\s*\{[^}]*grid-column:\s*2;/u,
  "Single download actions must occupy the rightmost desktop slot.",
);
assert.match(
  componentStyles,
  /\.action-spinner-slot\s*\{[^}]*width:\s*var\(--indicator-size\);[^}]*height:\s*var\(--indicator-size\);/u,
  "Loading titles must preserve fixed inline spinner geometry.",
);
assert.match(
  componentStyles,
  /\.compact-control\s*\{[^}]*min-height:\s*var\(--control-height-compact\);[^}]*font-size:\s*0\.88rem;/u,
  "Only explicitly compact controls may use the shared smaller treatment.",
);
assert.match(
  componentStyles,
  /:is\(button, \.button-control\)\s*\{[^}]*min-height:\s*var\(--control-height\);[^}]*padding:\s*var\(--control-padding\);[^}]*border:\s*var\(--border-ui-transparent\);/u,
  "Native disclosures styled as buttons must share the button geometry and border foundation.",
);
assert.match(
  foundationStyles,
  /button:focus-visible,\s*\.button-control:focus-visible,[\s\S]*?outline:\s*3px solid var\(--color-focus\);/u,
  "Button-like native controls must share the visible keyboard focus treatment.",
);
assert.match(
  indexHtml,
  /id="row-filter"[^>]*class="compact-control"[\s\S]*?id="previous-page-button"[^>]*class="secondary-button compact-control"[\s\S]*?id="next-page-button"[^>]*class="secondary-button compact-control"/u,
  "The preview filter and pagination buttons must share the compact control size.",
);
assert.match(baseCss, /\.file-operation-details,#cancel-file-operation,#undo-file-operation\{[^}]*grid-column:2/u);
assert.match(baseCss, /#mark-all-viewed-button\{[^}]*grid-column:1/u);
assert.match(
  fileOperationStatusViewSource,
  /document\.addEventListener\("pointerdown"[\s\S]*?!details\.contains\(event\.target\)[\s\S]*?details\.open = false/u,
  "Clicking outside the floating failure details must close them.",
);
assert.match(
  fileOperationStatusViewSource,
  /document\.addEventListener\("keydown"[\s\S]*?event\.key === "Escape"[\s\S]*?details\.open = false/u,
  "Escape must close the floating failure details.",
);
assert.match(
  fileOperationStatusViewSource,
  /markAllViewed\.hidden = busy \|\| unreadCount === 0/u,
  "Mark-all-viewed must persist in its own slot while unread files remain.",
);
assert.match(
  baseCss,
  /\.file-operation-status\{[^}]*min-height:4\.625rem[^}]*overflow:visible/u,
  "The operation banner must reserve a stable desktop minimum while allowing content growth.",
);
assert.match(
  componentStyles,
  /@container panel \(max-width:\s*36rem\)[\s\S]*?\.file-operation-status\s*\{[^}]*min-height:\s*8\.375rem;[\s\S]*?@container panel \(max-width:\s*24rem\)[\s\S]*?\.file-operation-status\s*\{[^}]*min-height:\s*11\.375rem;/u,
  "Responsive operation banners must reserve enough minimum height and grow with wrapped controls.",
);
assert.doesNotMatch(
  componentStyles,
  /\.file-operation-status\s*\{[^}]*\n\s*height:/u,
  "The operation card must not use a fixed height that can overlap enlarged content.",
);
assert.match(
  baseCss,
  /\.file-operation-details \.upload-failure-groups\{(?=[^}]*position:absolute)(?=[^}]*max-height:14rem)(?=[^}]*overflow:auto)[^}]*\}/u,
  "Expanded upload failures must float and scroll without moving banner actions.",
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
assert.doesNotMatch(
  componentStyles,
  /@container panel \(max-width:\s*36rem\)[\s\S]*?\.file-status-line\s*\{[\s\S]*?height:\s*4\.5rem/u,
  "The static source picker must not retain the obsolete mobile loading slot.",
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
  /\.inventory-table thead th:first-child\s*\{[^}]*left:\s*0[^}]*z-index:[^}]*background|\.inventory-table thead th:first-child\s*\{[^}]*left:\s*0[^}]*box-shadow/u,
  "The filename header must share the sticky horizontal position and opaque layer.",
);
assert.match(
  resultStyles,
  /\.file-tree-copy\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) max-content/u,
  "Unread badges must reserve only their content width and otherwise preserve filename space.",
);
assert.match(
  fileTreeViewSource,
  /`新\$\{metrics\.unreadCount\}`/u,
  "Unread badges must keep their count without the longer joined wording.",
);
assert.match(
  resultStyles,
  /\.inventory-table\s*\{[^}]*--inventory-file-column-width:\s*24rem;[^}]*--inventory-number-column-width:\s*5\.75rem;[^}]*--inventory-other-detail-column-width:\s*23rem;[\s\S]*?\.inventory-table :is\(th, td\):first-child\s*\{[^}]*width:\s*var\(--inventory-file-column-width\);[^}]*min-width:\s*var\(--inventory-file-column-width\);[^}]*max-width:\s*var\(--inventory-file-column-width\);[\s\S]*?\.inventory-table\.other-files-table :is\(th, td\):nth-child\(2\),\s*\.inventory-table\.other-files-table :is\(th, td\):nth-child\(3\)\s*\{[^}]*width:\s*var\(--inventory-other-detail-column-width\);[^}]*min-width:\s*var\(--inventory-other-detail-column-width\);[^}]*max-width:\s*var\(--inventory-other-detail-column-width\);/u,
  "Both inventory tabs must share a fixed filename track and equal intrinsic table width.",
);
assert.match(
  resultStyles,
  /@container panel \(max-width:\s*36rem\)\s*\{\s*\.inventory-table\s*\{[^}]*--inventory-file-column-width:\s*17rem;/u,
  "Both narrow inventory tabs must reduce the shared filename track together.",
);
assert.match(
  resultStyles,
  /\.inventory-table thead th\s*\{[^}]*border-right:\s*var\(--border-ui\)[^}]*border-bottom:\s*var\(--border-ui\)[^}]*background:\s*var\(--color-surface-muted\)/u,
  "Inventory headers must use visible shared-token separators against the muted surface.",
);
assert.match(
  resultStyles,
  /\.inventory-name-cell\s*\{[^}]*position:\s*sticky[^}]*left:\s*0[^}]*background:\s*var\(--inventory-row-background, var\(--color-surface\)\)[^}]*box-shadow/u,
  "Filename cells must remain sticky and cover metrics scrolling underneath.",
);
assert.match(
  resultStyles,
  /tr\[data-selected="true"\]\s*\{[^}]*--inventory-row-background:\s*linear-gradient\(var\(--color-accent-bg\), var\(--color-accent-bg\)\),\s*var\(--color-surface\)/u,
  "Selected sticky filename cells must composite the translucent accent over an opaque surface.",
);
assert.match(
  resultStyles,
  /\.inventory-table tfoot \[data-total-label\]\s*\{[^}]*position:\s*sticky[^}]*left:\s*0[^}]*background:\s*var\(--color-surface-muted\)[^}]*box-shadow/u,
  "The inventory total label must stay aligned with the sticky filename column.",
);
assert.match(
  resultStyles,
  /\.inventory-table tfoot :is\(th, td\)\s*\{[^}]*border-top:\s*var\(--border-ui\)[^}]*border-right:\s*var\(--border-ui\)[^}]*border-bottom:\s*0/u,
  "Inventory footers must have a visible top edge and aligned column separators.",
);
assert.doesNotMatch(
  resultStyles,
  /@container[^}]*[\s\S]*?\.inventory-name-cell\s*\{[^}]*position:\s*static/u,
  "Responsive rules must not give filename cells a second non-sticky behavior.",
);
assert.match(
  resultStyles,
  /\.data-table\s*\{[^}]*--preview-byte-columns-width:\s*208ch;[^}]*--preview-leading-columns-width:\s*14\.5rem;[^}]*--preview-field-padding-width:\s*16\.5rem;[^}]*table-layout:\s*fixed;[^}]*width:\s*calc\([^}]*var\(--preview-byte-columns-width\)[^}]*var\(--preview-leading-columns-width\)[^}]*var\(--preview-field-padding-width\)[^}]*\);[^}]*min-width:\s*100%/u,
  "The preview table must keep one fixed width derived from the 208-byte fields and stable utility columns.",
);
assert.doesNotMatch(resultStyles, /\.data-table\s*\{[^}]*width:\s*max-content/u);
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
  /\.data-table thead th\s*\{[^}]*border-right:\s*var\(--border-ui\)[^}]*border-bottom:\s*var\(--border-ui\)[^}]*background:\s*var\(--color-surface-muted\)/u,
  "Preview headers must use the file-tree header separators against the muted surface.",
);
assert.match(
  resultStyles,
  /\.data-table thead th:nth-child\(n \+ 4\)\s*\{[^}]*text-align:\s*left/u,
  "Preview field indexes 1 through 15 must align with left-aligned cell content.",
);
assert.match(
  resultStyles,
  /\.preview-issue-toggle\.row-status-text\s*\{[^}]*position:\s*relative[^}]*justify-content:\s*center[\s\S]*?\.preview-issue-toggle\.row-status-text::after\s*\{[^}]*position:\s*absolute[^}]*right:/u,
  "The disclosure marker must not shift the centered status label.",
);
assert.match(
  dataPreviewViewSource,
  /const ROW_FILTERS:[^=]+=\s*\[[\s\S]*?"all"[\s\S]*?const filterLabels = new Map\([\s\S]*?function syncFilterOptions\(page: PreviewPage\): void \{[\s\S]*?const count = page\.filterCounts\[filter\];[\s\S]*?option\.disabled = filter !== "all" && count === 0;[\s\S]*?option\.textContent = [^;]+\$\{count\}[^;]+;[\s\S]*?rowFilter\.value = "all";/u,
  "Every preview filter must show its row count, with zero-count choices disabled and a safe fallback to all rows.",
);
assert.match(
  componentStyles,
  /select option\s*\{[^}]*color:\s*var\(--color-text\);[^}]*font-weight:\s*700;[\s\S]*?select option:disabled\s*\{[^}]*color:\s*var\(--color-text-subtle\);[^}]*background:\s*var\(--color-surface-muted\);[^}]*font-weight:\s*500;/u,
  "Available and unavailable native select options must remain readable and visually distinct.",
);
assert.match(
  resultStyles,
  /\.filter-control\s*\{[^}]*width:\s*12rem;[\s\S]*?\.filter-control select\s*\{[^}]*min-width:\s*12rem;/u,
  "Preview filter copy changes must not resize the control.",
);
assert.match(
  resultStyles,
  /\.data-table-scroll\s*\{[^}]*height:[^;]+;[^}]*min-height:[^;]+;[^}]*overflow:\s*auto[^}]*scrollbar-gutter:\s*stable/u,
  "The preview viewport must keep a stable height and its horizontal scrollbar at the bottom.",
);
assert.match(
  resultStyles,
  /\.data-table\s*\{[^}]*--preview-row-height:\s*2\.4rem[^}]*table-layout:\s*fixed/u,
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
  dataPreviewViewSource,
  /function setPending\(pending: boolean\): void \{[\s\S]*?root\.inert = pending;[\s\S]*?root\.toggleAttribute\("aria-busy", pending\);[\s\S]*?freeze\(\) \{[\s\S]*?if \(!currentPageData\) return;[\s\S]*?setPending\(true\);[\s\S]*?render\(page\) \{[\s\S]*?renderTable\(page\);[\s\S]*?setPending\(false\);/u,
  "A pending file preview must remain visible but inert until its replacement page is rendered.",
);
assert.match(
  inputSectionViewSource,
  /if \(currentPreviewFileId !== active\.id\) \{[\s\S]*?preview\.freeze\(\);[\s\S]*?requestPreview\(active\.id, "all", 0\);[\s\S]*?renderPreviewPage\(page\) \{[\s\S]*?if \(page\.fileId !== currentPreviewFileId\) return;[\s\S]*?previewName\.textContent = basename\(page\.virtualPath\);[\s\S]*?preview\.render\(page\);/u,
  "File switches must freeze the old preview and atomically commit only the latest requested page.",
);
assert.match(
  inputSectionViewSource,
  /previewErrorFileId === active\.id[\s\S]*?requestPreview\(active\.id, "all", 0\)[\s\S]*?renderPreviewError\(fileId\)[\s\S]*?preview\.fail\(\)/u,
  "A failed preview switch must unfreeze retained content and retry when the selected file is opened again.",
);
assert.doesNotMatch(
  inputSectionViewSource,
  /if \(currentPreviewFileId !== active\.id\) \{[^}]*preview\.clear\(\)/u,
  "Switching files must not collapse the preview while its next page is pending.",
);
assert.match(
  resultStyles,
  /\.subsection-heading\s*\{[^}]*align-items:\s*flex-start/u,
  "The preview filter must align with the top of the filename block.",
);
assert.match(
  `${componentStyles}\n${resultStyles}`,
  /\.field-control\s*\{[^}]*display:\s*grid;[\s\S]*?\.control-heading\s*\{[^}]*font-size:\s*1rem;[\s\S]*?\.advanced-columns\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;/u,
  "Dropdown and checkbox groups must share one heading hierarchy without a separate fieldset frame.",
);
assert.doesNotMatch(
  indexHtml,
  /第一次使用時不預先勾選；之後會勾選上次使用的相同欄位。/u,
  "Advanced preference behavior must not add explanatory copy to the primary UI.",
);
assert.match(
  resultStyles,
  /\.data-cell-value\s*\{[^}]*font-family:\s*"Sarasa Mono TC"/u,
  "Preview cells must use the deferred fixed-width font when it is ready.",
);
assert.match(
  resultStyles,
  /\.data-cell-value\s*\{[^}]*display:\s*block[^}]*min-width:\s*0[^}]*font-family:\s*"Sarasa Mono TC"[^}]*font-weight:\s*400/u,
  "Preview values must keep one fixed-width font and consistent weight in every status.",
);
assert.doesNotMatch(
  resultStyles,
  /\.data-table td\[data-tone="(?:error|warning)"\]\s*\{[^}]*box-shadow/u,
  "Preview issue cells must not use the obsolete underline marker.",
);
assert.match(
  resultStyles,
  /\.data-table td\[data-tone="error"\]\s*\{[^}]*border-left:\s*var\(--border-width-emphasis\) solid var\(--color-error\);[^}]*color:\s*var\(--color-error-text\);[^}]*background:\s*var\(--color-error-bg\);[\s\S]*?\.data-table td\[data-tone="warning"\]\s*\{[^}]*border-left:\s*var\(--border-width-emphasis\) solid var\(--color-warning\);[^}]*color:\s*var\(--color-warning-text\);[^}]*background:\s*var\(--color-warning-bg\);/u,
  "Preview error and warning cells must combine stable text and background colors with a non-color border cue.",
);
assert.doesNotMatch(
  resultStyles,
  /\.data-table td\[data-tone="(?:error|warning)"\] \.data-cell-value/u,
  "Preview issue styling must not depend on a value-sized marker.",
);
assert.doesNotMatch(
  resultStyles,
  /\.data-cell-value\.is-empty\s*\{[^}]*color:/u,
  "Empty preview markers must inherit the current cell text tone.",
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
  advancedPreferencesSource,
  /const STORAGE_KEY = "csv2txt\.advanced-columns\.v1"[\s\S]*?subtle\.digest\("SHA-256"[\s\S]*?getRandomValues\(new Uint8Array\(16\)\)[\s\S]*?storage\?\.setItem\(STORAGE_KEY, JSON\.stringify\(next\)\)/u,
  "Advanced column preferences must persist only salted SHA-256 fingerprints.",
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
assert.match(
  indexHtml,
  /worker-src 'self'/u,
  "The production CSP must explicitly allow only same-origin processing workers.",
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
