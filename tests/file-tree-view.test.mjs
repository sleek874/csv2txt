import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTree,
  findingPresentation,
  inventoryMetrics,
  removalTarget,
} from "../src/app/sections/input/file-tree-view.ts";

test("lists file-tree error and warning counts without hiding either", () => {
  assert.deepEqual(findingPresentation(2, 3), {
    label: "2 錯誤 · 3 警告",
    tone: "error",
  });
  assert.deepEqual(findingPresentation(0, 3), { label: "3 警告", tone: "warning" });
  assert.equal(findingPresentation(0, 0), null);
});

test("aggregates rows and output problems for accepted entries", () => {
  const ready = {
    id: "ready",
    sourceId: "source",
    unread: true,
    file: {
      summary: {
        blankRows: 1,
        rejectedRows: 1,
        dataRows: 10,
        correctRows: 6,
        errorRows: 2,
        warningRows: 2,
        includedRows: 9,
      },
    },
  };
  assert.deepEqual(inventoryMetrics([ready], new Map([["ready", new Set([2, 4])]])), {
    blankRows: 1,
    rejectedRows: 1,
    dataRows: 10,
    correctRows: 6,
    errorRows: 2,
    warningRows: 2,
    selectedRows: 9,
    outputProblems: 2,
    unreadCount: 1,
  });
});

test("removes direct top-level files recoverably but confirms archive sources", () => {
  const directSource = { id: "direct", kind: "file", name: "direct.csv" };
  const directItem = {
    id: "direct-item",
    relativePath: "",
    size: 1,
    sourceId: directSource.id,
    virtualPath: "direct.csv",
  };
  const archiveSource = { id: "archive", kind: "archive", name: "batch.zip" };
  const archiveItem = {
    id: "archive-item",
    relativePath: "folder/file.csv",
    size: 1,
    sourceId: archiveSource.id,
    virtualPath: "batch.zip/folder/file.csv",
  };

  const [directNode] = buildTree([directSource], [directItem]);
  const [archiveNode] = buildTree([archiveSource], [archiveItem]);
  assert.deepEqual(removalTarget(directNode), { id: "direct-item", kind: "file" });
  assert.deepEqual(removalTarget(archiveNode), { id: "archive", kind: "source" });
  assert.deepEqual(removalTarget(archiveNode.children[0].children[0]), {
    id: "archive-item",
    kind: "file",
  });
});
