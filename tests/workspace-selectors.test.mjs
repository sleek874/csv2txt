import assert from "node:assert/strict";
import test from "node:test";

import {
  activeWorkspaceItems,
  activeWorkspaceSnapshot,
  canonicalActiveWorkspaceItems,
  otherWorkspaceItems,
} from "../src/app/state/workspace-selectors.ts";

function snapshot(selectedFileId = "csv-b") {
  return {
    inputFormat: "csv",
    outputFormat: "big5-txt",
    selectedFileId,
    sources: [
      { id: "source-a", kind: "file", name: "a.csv" },
      { id: "source-b", kind: "archive", name: "batch.zip" },
      { id: "source-c", kind: "file", name: "other.xlsx" },
    ],
    files: [
      { id: "csv-b", sourceId: "source-b", sourceFormat: "csv", virtualPath: "batch.zip/Z.csv" },
      { id: "xlsx", sourceId: "source-c", sourceFormat: "xlsx", virtualPath: "other.xlsx" },
      { id: "csv-a", sourceId: "source-a", sourceFormat: "csv", virtualPath: "a.csv" },
    ],
  };
}

test("separates active and other families without mutating workspace order", () => {
  const workspace = snapshot();
  assert.deepEqual(activeWorkspaceItems(workspace).map(({ id }) => id), ["csv-b", "csv-a"]);
  assert.deepEqual(otherWorkspaceItems(workspace).map(({ id }) => id), ["xlsx"]);
  assert.deepEqual(canonicalActiveWorkspaceItems(workspace).map(({ id }) => id), ["csv-a", "csv-b"]);
  assert.deepEqual(workspace.files.map(({ id }) => id), ["csv-b", "xlsx", "csv-a"]);
});

test("projects an active snapshot with owned sources and a valid selection", () => {
  const selected = activeWorkspaceSnapshot(snapshot("xlsx"));
  assert.deepEqual(selected.files.map(({ id }) => id), ["csv-b", "csv-a"]);
  assert.deepEqual(selected.sources.map(({ id }) => id), ["source-a", "source-b"]);
  assert.equal(selected.selectedFileId, "csv-b");

  const retained = activeWorkspaceSnapshot(snapshot("csv-a"));
  assert.equal(retained.selectedFileId, "csv-a");

  const empty = activeWorkspaceSnapshot({ ...snapshot(), inputFormat: "txt" });
  assert.deepEqual(empty.files, []);
  assert.deepEqual(empty.sources, []);
  assert.equal(empty.selectedFileId, null);
});
