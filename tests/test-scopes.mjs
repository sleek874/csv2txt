import { readdirSync } from "node:fs";

export const TEST_SCOPES = Object.freeze({
  unit: Object.freeze([
    "advanced-lookup.test.mjs",
    "advanced-preferences.test.mjs",
    "bytes.test.mjs",
    "compact-workspace.test.mjs",
    "conversion-pipeline.test.mjs",
    "csv.test.mjs",
    "encoding.test.mjs",
    "fixed-width-inverse.test.mjs",
    "fixed-width.test.mjs",
    "input-adapter.test.mjs",
    "offline-cache.test.mjs",
    "preview-query.test.mjs",
    "resources.test.mjs",
    "spreadsheet.test.mjs",
    "workspace-selectors.test.mjs",
  ]),
  application: Object.freeze([
    "advanced-controller.test.mjs",
    "archive.test.mjs",
    "batch-client.test.mjs",
    "batch-engine.test.mjs",
    "format-controller.test.mjs",
    "output.test.mjs",
    "workspace-controller.test.mjs",
  ]),
  contract: Object.freeze([
    "test-system.test.mjs",
    "testdata.test.mjs",
  ]),
  presentation: Object.freeze([
    "presentation-contracts.test.mjs",
  ]),
});

export function filesForScope(scope) {
  if (scope === "all") return Object.values(TEST_SCOPES).flat();
  const selected = TEST_SCOPES[scope];
  if (!selected) throw new Error(`Unknown test scope: ${scope}`);
  return [...selected];
}

export function verifyTestScopes(testDirectory) {
  const classified = Object.entries(TEST_SCOPES).flatMap(([scope, files]) => (
    files.map((file) => ({ file, scope }))
  ));
  const counts = new Map();
  classified.forEach(({ file }) => counts.set(file, (counts.get(file) ?? 0) + 1));
  const duplicates = [...counts].filter(([, count]) => count !== 1).map(([file]) => file);
  if (duplicates.length) throw new Error(`Tests classified more than once: ${duplicates.join(", ")}`);

  const discovered = readdirSync(testDirectory)
    .filter((file) => file.endsWith(".test.mjs"))
    .sort();
  const expected = [...counts.keys()].sort();
  const unclassified = discovered.filter((file) => !counts.has(file));
  const missing = expected.filter((file) => !discovered.includes(file));
  if (unclassified.length || missing.length) {
    throw new Error([
      unclassified.length ? `Unclassified tests: ${unclassified.join(", ")}` : "",
      missing.length ? `Missing classified tests: ${missing.join(", ")}` : "",
    ].filter(Boolean).join("\n"));
  }
  return classified;
}
