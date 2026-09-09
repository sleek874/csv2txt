import { accessSync, constants, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import lighthouse from "lighthouse";
import puppeteer from "puppeteer-core";

import { startPreviewServer } from "./lib/preview-server.mjs";

const chromePath = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const temporaryRoot = "/tmp";
accessSync(chromePath, constants.X_OK);
const artifactDirectory = new URL("../reports/lighthouse/", import.meta.url);
mkdirSync(artifactDirectory, { recursive: true });
const profileDirectory = mkdtempSync(join(temporaryRoot, "csv2txt-lighthouse-"));
let browser;
let server;

const thresholds = {
  performance: 0.80,
  accessibility: 1.00,
  "best-practices": 1.00,
  seo: 0.90,
};

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
  const port = Number(new URL(browser.wsEndpoint()).port);
  const result = await lighthouse(server.url, {
    port,
    output: ["html", "json"],
    logLevel: "error",
    formFactor: "desktop",
    screenEmulation: {
      mobile: false, width: 1280, height: 900, deviceScaleFactor: 1, disabled: false,
    },
  });
  if (!result) throw new Error("Lighthouse returned no result.");
  const reports = Array.isArray(result.report) ? result.report : [result.report];
  const json = reports.find((report) => {
    try {
      JSON.parse(report);
      return true;
    } catch {
      return false;
    }
  });
  const html = reports.find((report) => report !== json);
  if (!html || !json) throw new Error("Lighthouse did not return both HTML and JSON reports.");
  writeFileSync(new URL("report.html", artifactDirectory), html);
  writeFileSync(new URL("report.json", artifactDirectory), json);

  const { lhr } = result;
  const scores = Object.fromEntries(Object.entries(lhr.categories).map(([id, category]) => (
    [id, Math.round((category.score ?? 0) * 100)]
  )));
  const metricIds = [
    "first-contentful-paint", "largest-contentful-paint", "total-blocking-time",
    "cumulative-layout-shift", "speed-index",
  ];
  const metrics = metricIds.map((id) => lhr.audits[id]).filter(Boolean).map((audit) => ({
    id: audit.id, title: audit.title, value: audit.displayValue ?? String(audit.numericValue ?? ""),
  }));
  const findings = Object.values(lhr.audits)
    .filter((audit) => typeof audit.score === "number" && audit.score < 1)
    .filter((audit) => !["notApplicable", "manual", "informative"].includes(audit.scoreDisplayMode))
    .sort((left, right) => (left.score ?? 0) - (right.score ?? 0))
    .slice(0, 12)
    .map((audit) => ({
      id: audit.id,
      score: Math.round((audit.score ?? 0) * 100),
      title: audit.title,
      value: audit.displayValue ?? "",
      interpretation: ({
        "robots-txt": "Direct robots.txt is valid; the strict connect-src 'none' policy blocks Lighthouse's page-context fetch.",
        "llms-txt": "Direct llms.txt contains an H1; the strict connect-src 'none' policy blocks Lighthouse's page-context fetch.",
        "unused-javascript": "The initial shared application runtime contains code not exercised during the synthetic page-load trace.",
        "render-blocking-insight": "The base stylesheet remains on the first-render critical path.",
        "network-dependency-tree-insight": "The synchronous boot script must resolve the current release shell before the main application loads.",
      })[audit.id] ?? "",
    }));
  const failures = Object.entries(thresholds).flatMap(([id, minimum]) => {
    const score = lhr.categories[id]?.score ?? 0;
    return score >= minimum ? [] : [`${id} ${Math.round(score * 100)} < ${Math.round(minimum * 100)}`];
  });
  const markdown = [
    "# Lighthouse report",
    "",
    `- URL: ${server.url}`,
    `- Generated: ${lhr.fetchTime}`,
    `- Lighthouse: ${lhr.lighthouseVersion}`,
    `- Chrome: ${lhr.userAgent}`,
    "",
    "## Scores",
    "",
    ...Object.entries(scores).map(([id, score]) => `- ${id}: **${score}**`),
    "",
    "## Main metrics",
    "",
    ...metrics.map((metric) => `- ${metric.title}: ${metric.value}`),
    "",
    "## Main findings",
    "",
    ...(findings.length
      ? findings.map((finding) => `- ${finding.title}: ${finding.score}${finding.value ? ` (${finding.value})` : ""} [${finding.id}]${finding.interpretation ? ` — ${finding.interpretation}` : ""}`)
      : ["- No scored audit below 100."]),
    "",
    "## Interpretation boundary",
    "",
    "Lighthouse is a synthetic page-load and static accessibility audit. It does not prove screen-reader, native picker, download-dialog, offline-update, receiving-system, or real-device behavior.",
    "",
  ].join("\n");
  writeFileSync(new URL("summary.md", artifactDirectory), markdown);
  console.log(`Lighthouse scores: ${Object.entries(scores).map(([id, score]) => `${id} ${score}`).join(", ")}.`);
  console.log(`Artifacts: ${new URL("summary.md", artifactDirectory).pathname}, ${new URL("report.html", artifactDirectory).pathname}`);
  if (failures.length) throw new Error(`Lighthouse thresholds failed: ${failures.join(", ")}`);
} finally {
  await browser?.close();
  await server?.stop();
  if (profileDirectory.startsWith(`${temporaryRoot}/csv2txt-`)) {
    rmSync(profileDirectory, { recursive: true, force: true });
  }
}
