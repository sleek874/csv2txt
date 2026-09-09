import { readFileSync } from "node:fs";

const reportUrl = new URL("../coverage/unit/coverage-summary.json", import.meta.url);
const report = JSON.parse(readFileSync(reportUrl, "utf8"));
const metrics = ["statements", "branches", "functions", "lines"];
const globalMinimums = { statements: 90, branches: 80, functions: 85, lines: 90 };
const fileMinimums = { statements: 70, branches: 60, functions: 60, lines: 70 };

function failuresFor(label, coverage, minimums) {
  return metrics.flatMap((metric) => {
    const actual = coverage[metric]?.pct;
    const minimum = minimums[metric];
    return typeof actual === "number" && actual >= minimum
      ? []
      : [`${label} ${metric}: ${String(actual)}% < ${minimum}%`];
  });
}

const failures = failuresFor("global", report.total, globalMinimums);
for (const [file, coverage] of Object.entries(report)) {
  if (file === "total") continue;
  failures.push(...failuresFor(file, coverage, fileMinimums));
}

if (failures.length) {
  throw new Error(`Coverage gate failed:\n${failures.join("\n")}`);
}

console.log([
  "Coverage gate passed:",
  ...metrics.map((metric) => `${metric} ${report.total[metric].pct}%`),
  `per-file floors ${fileMinimums.lines}% lines/statements, ${fileMinimums.branches}% branches, ${fileMinimums.functions}% functions`,
].join(" "));
