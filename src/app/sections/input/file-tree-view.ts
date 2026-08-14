import { requireDescendant } from "../../../browser/dom";
import { FILE_FORMAT_LABELS, type FileFormat } from "../../../core/file-formats";
import type { OutputIssue } from "../../../core/output-validation";
import type { WorkspaceItem, WorkspaceSnapshot, WorkspaceSource } from "../../state/workspace-types";
import { completeFileTableBody, updateFileTableFooter } from "./file-table-view";

export type InventoryFilter = "rejected" | "error" | "warning" | "output";

export interface FileTreeView {
  bind(options: {
    onInspect: (fileId: string, filter: InventoryFilter) => void;
    onRemoveFile: (fileId: string) => void;
    onRemoveSource: (sourceId: string) => void;
    onSelect: (fileId: string) => void;
  }): void;
  clear(inputFormat: FileFormat): void;
  render(snapshot: WorkspaceSnapshot, outputIssues: readonly OutputIssue[], removalLocked?: boolean): void;
}

export interface InventoryMetrics {
  blankRows: number | null;
  correctRows: number | null;
  dataRows: number | null;
  errorRows: number | null;
  outputProblems: number | null;
  rejectedRows: number | null;
  selectedRows: number | null;
  unreadCount: number;
  warningRows: number | null;
}

interface TreeNode {
  children: TreeNode[];
  id: string;
  item?: WorkspaceItem;
  items: WorkspaceItem[];
  kind: "source" | "folder" | "file";
  label: string;
  source: WorkspaceSource;
}

export function findingPresentation(
  errorCount: number,
  warningCount: number,
): { label: string; tone: string } | null {
  const parts: string[] = [];
  if (errorCount > 0) parts.push(`${errorCount} 錯誤`);
  if (warningCount > 0) parts.push(`${warningCount} 警告`);
  return parts.length > 0
    ? { label: parts.join(" · "), tone: errorCount > 0 ? "error" : "warning" }
    : null;
}

function issueRowsByFile(outputIssues: readonly OutputIssue[]): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  outputIssues.filter((issue) => issue.blocking).forEach((issue) => {
    const rows = result.get(issue.fileId) ?? new Set<number>();
    rows.add(issue.sourceRow);
    result.set(issue.fileId, rows);
  });
  return result;
}

export function inventoryMetrics(
  items: readonly WorkspaceItem[],
  outputIssueRows: ReadonlyMap<string, ReadonlySet<number>>,
): InventoryMetrics {
  const unreadCount = items.filter((item) => item.unread).length;
  if (items.length === 0) {
    return {
      blankRows: null,
      correctRows: null,
      dataRows: null,
      errorRows: null,
      outputProblems: null,
      rejectedRows: null,
      selectedRows: null,
      unreadCount,
      warningRows: null,
    };
  }
  if (items.every((item) => !item.file)) {
    return {
      blankRows: null,
      correctRows: null,
      dataRows: null,
      errorRows: null,
      outputProblems: null,
      rejectedRows: null,
      selectedRows: null,
      unreadCount,
      warningRows: null,
    };
  }
  return items.reduce<InventoryMetrics>((metrics, item) => ({
    blankRows: (metrics.blankRows ?? 0) + (item.file?.summary.blankRows ?? 0),
    correctRows: (metrics.correctRows ?? 0) + (item.file?.summary.correctRows ?? 0),
    dataRows: (metrics.dataRows ?? 0) + (item.file?.summary.dataRows ?? 0),
    errorRows: (metrics.errorRows ?? 0) + (item.file?.summary.errorRows ?? 0),
    outputProblems: (metrics.outputProblems ?? 0) + (outputIssueRows.get(item.id)?.size ?? 0),
    rejectedRows: (metrics.rejectedRows ?? 0) + (item.file?.summary.rejectedRows ?? 0),
    selectedRows: (metrics.selectedRows ?? 0) + (item.file?.summary.includedRows ?? 0),
    unreadCount,
    warningRows: (metrics.warningRows ?? 0) + (item.file?.summary.warningRows ?? 0),
  }), {
    blankRows: 0,
    correctRows: 0,
    dataRows: 0,
    errorRows: 0,
    outputProblems: 0,
    rejectedRows: 0,
    selectedRows: 0,
    unreadCount,
    warningRows: 0,
  });
}

function itemPresentation(item: WorkspaceItem): { label: string; tone: string } {
  if (!item.file) return { label: "無法顯示", tone: "error" };
  return findingPresentation(item.file.summary.errorRows, item.file.summary.warningRows)
    ?? { label: "已準備好", tone: "success" };
}

function groupPresentation(items: readonly WorkspaceItem[]): { label: string; tone: string } {
  const errors = items.reduce((total, item) => total + (item.file?.summary.errorRows ?? 0), 0);
  const warnings = items.reduce((total, item) => total + (item.file?.summary.warningRows ?? 0), 0);
  return findingPresentation(errors, warnings)
    ?? { label: `${items.length} 個檔案`, tone: "success" };
}

export function buildTree(
  sources: readonly WorkspaceSource[],
  files: readonly WorkspaceItem[],
): TreeNode[] {
  return sources.map((source) => {
    const sourceFiles = files.filter((file) => file.sourceId === source.id);
    const root: TreeNode = {
      children: [],
      id: `source:${source.id}`,
      items: [...sourceFiles],
      kind: "source",
      label: source.name,
      source,
    };
    if (source.kind === "file" || sourceFiles.some((file) => file.relativePath === "")) {
      root.item = sourceFiles[0];
      return root;
    }

    for (const item of sourceFiles) {
      const segments = item.relativePath.split("/").filter(Boolean);
      let parent = root;
      segments.forEach((segment, index) => {
        const isFile = index === segments.length - 1;
        if (isFile) {
          parent.children.push({
            children: [],
            id: `file:${item.id}`,
            item,
            items: [item],
            kind: "file",
            label: segment,
            source,
          });
          return;
        }
        const path = segments.slice(0, index + 1).join("/");
        let folder = parent.children.find((node) => node.kind === "folder" && node.label === segment);
        if (!folder) {
          folder = {
            children: [],
            id: `folder:${source.id}:${path}`,
            items: [],
            kind: "folder",
            label: segment,
            source,
          };
          parent.children.push(folder);
        }
        folder.items.push(item);
        parent = folder;
      });
    }
    return root;
  });
}

export function removalTarget(node: TreeNode): { id: string; kind: "file" | "source" } | null {
  if (node.kind === "source" && node.source.kind === "archive") {
    return { id: node.source.id, kind: "source" };
  }
  if (node.item && (node.kind === "source" || node.kind === "file")) {
    return { id: node.item.id, kind: "file" };
  }
  return null;
}

function firstAffectedFile(
  node: TreeNode,
  filter: InventoryFilter,
  outputRows: ReadonlyMap<string, ReadonlySet<number>>,
): WorkspaceItem | null {
  return node.items.find((item) => {
    if (!item.file) return false;
    if (filter === "rejected") return item.file.summary.rejectedRows > 0;
    if (filter === "error") return item.file.summary.errorRows > 0;
    if (filter === "warning") return item.file.summary.warningRows > 0;
    return (outputRows.get(item.id)?.size ?? 0) > 0;
  }) ?? null;
}

function appendBadge(parent: HTMLElement, label: string, tone: "info" | "neutral"): void {
  const badge = document.createElement("span");
  badge.className = "status-badge";
  badge.dataset.tone = tone;
  badge.textContent = label;
  parent.append(badge);
}

export function createFileTreeView(root: HTMLElement): FileTreeView {
  const table = requireDescendant<HTMLTableElement>(root, "#file-tree-table");
  const tree = requireDescendant<HTMLTableSectionElement>(root, "#file-tree");
  const total = requireDescendant<HTMLTableRowElement>(root, "#file-tree-total");
  const selectSourceButton = requireDescendant<HTMLButtonElement>(root, "#select-source-button");
  const collapsedNodes = new Set<string>();
  let currentOutputRows = new Map<string, Set<number>>();

  function nodeButton(nodeId: string): HTMLButtonElement | null {
    return Array.from(tree.querySelectorAll<HTMLButtonElement>("[data-tree-node-id]"))
      .find((button) => button.dataset.treeNodeId === nodeId) ?? null;
  }

  function visibleButtons(): HTMLButtonElement[] {
    return Array.from(tree.querySelectorAll<HTMLButtonElement>("[data-tree-node-id]"))
      .filter((button) => !button.closest<HTMLTableRowElement>("tr")?.hidden);
  }

  function updateVisibility(): void {
    tree.querySelectorAll<HTMLTableRowElement>("tr[data-tree-node-id]").forEach((row) => {
      const ancestors = JSON.parse(row.dataset.ancestorNodeIds ?? "[]") as string[];
      row.hidden = ancestors.some((nodeId) => collapsedNodes.has(nodeId));
    });
  }

  function setExpanded(button: HTMLButtonElement, expanded: boolean): void {
    const nodeId = button.dataset.treeNodeId;
    if (!nodeId || !button.hasAttribute("aria-expanded")) return;
    button.setAttribute("aria-expanded", String(expanded));
    const row = button.closest<HTMLTableRowElement>("tr");
    row?.setAttribute("aria-expanded", String(expanded));
    if (expanded) collapsedNodes.delete(nodeId);
    else collapsedNodes.add(nodeId);
    updateVisibility();
  }

  function appendMetric(
    row: HTMLTableRowElement,
    value: number | null,
    options?: {
      file?: WorkspaceItem | null;
      filter?: InventoryFilter;
      tone?: string;
    },
  ): void {
    const cell = row.insertCell();
    cell.className = "inventory-number-cell";
    if (options?.tone) cell.dataset.tone = options.tone;
    if (value === null) {
      cell.textContent = "—";
      return;
    }
    if (value > 0 && options?.file && options.filter) {
      const button = document.createElement("button");
      button.className = "inventory-count-button";
      button.type = "button";
      button.textContent = String(value);
      button.dataset.inspectFileId = options.file.id;
      button.dataset.inspectFilter = options.filter;
      const label = options.filter === "rejected" ? "無法解析" : options.filter === "error" ? "錯誤" : options.filter === "warning" ? "警告" : "輸出問題";
      button.setAttribute("aria-label", `查看 ${options.file.virtualPath} 的${label}，共 ${value}`);
      cell.append(button);
      return;
    }
    cell.textContent = String(value);
  }

  function render(snapshot: WorkspaceSnapshot, outputIssues: readonly OutputIssue[], removalLocked = false): void {
    const hadTreeFocus = document.activeElement instanceof Element && table.contains(document.activeElement);
    const focusedNodeId = document.activeElement instanceof HTMLButtonElement
      ? document.activeElement.dataset.treeNodeId
      : undefined;
    currentOutputRows = issueRowsByFile(outputIssues);
    const supportedCount = snapshot.files.length;
    tree.replaceChildren();

    function appendNode(
      node: TreeNode,
      depth: number,
      parentNodeId?: string,
      ancestorNodeIds: readonly string[] = [],
    ): void {
      const metrics = inventoryMetrics(node.items, currentOutputRows);
      const presentation = node.item ? itemPresentation(node.item) : groupPresentation(node.items);
      const row = tree.insertRow();
      row.dataset.treeNodeId = node.id;
      row.dataset.ancestorNodeIds = JSON.stringify(ancestorNodeIds);
      row.dataset.kind = node.kind === "source" ? node.source.kind : node.kind;
      row.dataset.selected = String(node.item?.id === snapshot.selectedFileId);
      row.setAttribute("aria-level", String(depth));
      row.setAttribute("aria-selected", String(node.item?.id === snapshot.selectedFileId));
      if (node.children.length > 0) {
        row.setAttribute("aria-expanded", String(!collapsedNodes.has(node.id)));
      }

      const nameCell = document.createElement("th");
      nameCell.scope = "row";
      nameCell.className = "inventory-name-cell";
      const button = document.createElement("button");
      button.className = "file-tree-item";
      button.type = "button";
      button.dataset.treeNodeId = node.id;
      button.dataset.tone = presentation.tone;
      button.style.setProperty("--tree-depth", String(depth - 1));
      if (parentNodeId) button.dataset.parentNodeId = parentNodeId;
      if (node.item) button.dataset.fileId = node.item.id;
      if (node.children.length > 0) {
        button.setAttribute("aria-expanded", String(!collapsedNodes.has(node.id)));
      }

      const disclosure = document.createElement("span");
      disclosure.className = "file-tree-disclosure";
      disclosure.setAttribute("aria-hidden", "true");
      disclosure.textContent = node.children.length > 0 ? "›" : "";
      const copy = document.createElement("span");
      copy.className = "file-tree-copy";
      const nameLine = document.createElement("span");
      nameLine.className = "file-tree-name-line";
      const name = document.createElement("span");
      name.className = "file-tree-name";
      name.textContent = node.label;
      name.title = node.item?.virtualPath ?? node.label;
      nameLine.append(name);
      const badgeLine = document.createElement("span");
      badgeLine.className = "file-tree-badge-line";
      if (metrics.unreadCount > 0) appendBadge(
        badgeLine,
        node.item ? "新加入" : `新加入 ${metrics.unreadCount}`,
        "info",
      );
      copy.append(nameLine, badgeLine);
      const typeLabel = node.kind === "folder" ? "資料夾" : node.source.kind === "archive" && node.kind === "source"
        ? "壓縮檔"
        : "檔案";
      button.setAttribute("aria-label", `${typeLabel} ${node.label}，${presentation.label}`);
      button.append(disclosure, copy);
      nameCell.append(button);
      row.append(nameCell);

      const rejectedFile = metrics.rejectedRows && metrics.rejectedRows > 0
        ? firstAffectedFile(node, "rejected", currentOutputRows)
        : null;
      const errorFile = metrics.errorRows && metrics.errorRows > 0
        ? firstAffectedFile(node, "error", currentOutputRows)
        : null;
      const warningFile = metrics.warningRows && metrics.warningRows > 0
        ? firstAffectedFile(node, "warning", currentOutputRows)
        : null;
      const outputFile = metrics.outputProblems && metrics.outputProblems > 0
        ? firstAffectedFile(node, "output", currentOutputRows)
        : null;
      appendMetric(row, metrics.blankRows, { file: node.item });
      appendMetric(row, metrics.rejectedRows, { file: rejectedFile, filter: "rejected", tone: "error" });
      appendMetric(row, metrics.dataRows, { file: node.item });
      appendMetric(row, metrics.correctRows, { file: node.item, tone: "success" });
      appendMetric(row, metrics.errorRows, { file: errorFile, filter: "error", tone: "error" });
      appendMetric(row, metrics.warningRows, { file: warningFile, filter: "warning", tone: "warning" });
      appendMetric(row, metrics.selectedRows, { file: node.item });
      appendMetric(row, metrics.outputProblems, { file: outputFile, filter: "output", tone: "error" });

      const removeCell = row.insertCell();
      removeCell.className = "inventory-remove-cell";
      const remove = document.createElement("button");
      remove.className = "file-tree-remove";
      remove.type = "button";
      remove.textContent = "×";
      const target = removalTarget(node);
      if (target?.kind === "source") {
        remove.dataset.removeSourceId = target.id;
        remove.setAttribute("aria-label", `從清單移除 ${node.source.name}`);
      } else if (target?.kind === "file" && node.item) {
        remove.dataset.removeFileId = target.id;
        remove.setAttribute("aria-label", `從清單移除 ${node.item.virtualPath}`);
      } else {
        remove.hidden = true;
      }
      remove.title = "從清單移除";
      remove.disabled = removalLocked;
      removeCell.append(remove);

      node.children.forEach((child) => appendNode(
        child,
        depth + 1,
        node.id,
        [...ancestorNodeIds, node.id],
      ));
    }

    const nodes = buildTree(snapshot.sources, snapshot.files);
    nodes.forEach((node) => appendNode(node, 1));
    completeFileTableBody(tree, {
      columnCount: 10,
      emptyMessage: `目前沒有 ${FILE_FORMAT_LABELS[snapshot.inputFormat]} 檔案。`,
      hasRows: nodes.length > 0,
    });
    updateVisibility();

    const totalMetrics = inventoryMetrics(snapshot.files, currentOutputRows);
    const totalValues = [
      totalMetrics.blankRows,
      totalMetrics.rejectedRows,
      totalMetrics.dataRows,
      totalMetrics.correctRows,
      totalMetrics.errorRows,
      totalMetrics.warningRows,
      totalMetrics.selectedRows,
      totalMetrics.outputProblems,
    ];
    updateFileTableFooter(total, supportedCount, totalValues.map((value) => value ?? "—"));

    const buttons = Array.from(tree.querySelectorAll<HTMLButtonElement>("[data-tree-node-id]"));
    const selected = buttons.find((candidate) => candidate.dataset.fileId === snapshot.selectedFileId) ?? null;
    const active = selected && !selected.closest<HTMLTableRowElement>("tr")?.hidden
      ? selected
      : visibleButtons()[0] ?? null;
    buttons.forEach((candidate) => { candidate.tabIndex = candidate === active ? 0 : -1; });
    if (hadTreeFocus) {
      const replacement = focusedNodeId ? nodeButton(focusedNodeId) : null;
      const focusTarget = replacement && !replacement.closest<HTMLTableRowElement>("tr")?.hidden
        ? replacement
        : active;
      focusTarget?.focus({ preventScroll: true });
    }
  }

  return {
    bind(options) {
      tree.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const removeSource = target?.closest<HTMLButtonElement>("[data-remove-source-id]");
        if (removeSource?.dataset.removeSourceId) {
          options.onRemoveSource(removeSource.dataset.removeSourceId);
          return;
        }
        const removeFile = target?.closest<HTMLButtonElement>("[data-remove-file-id]");
        if (removeFile?.dataset.removeFileId) {
          options.onRemoveFile(removeFile.dataset.removeFileId);
          return;
        }
        const inspect = target?.closest<HTMLButtonElement>("[data-inspect-file-id]");
        if (inspect?.dataset.inspectFileId && inspect.dataset.inspectFilter) {
          options.onInspect(inspect.dataset.inspectFileId, inspect.dataset.inspectFilter as InventoryFilter);
          return;
        }
        const row = target?.closest<HTMLTableRowElement>("tr[data-tree-node-id]");
        const button = target?.closest<HTMLButtonElement>("[data-tree-node-id]")
          ?? row?.querySelector<HTMLButtonElement>("[data-tree-node-id]");
        if (!button) return;
        visibleButtons().forEach((candidate) => { candidate.tabIndex = candidate === button ? 0 : -1; });
        if (button.hasAttribute("aria-expanded")) {
          setExpanded(button, button.getAttribute("aria-expanded") !== "true");
        } else if (button.dataset.fileId) {
          options.onSelect(button.dataset.fileId);
        }
      });
      tree.addEventListener("keydown", (event) => {
        const current = event.target instanceof HTMLButtonElement
          ? event.target.closest<HTMLButtonElement>("[data-tree-node-id]")
          : null;
        if (!current) return;
        const items = visibleButtons();
        const currentIndex = items.indexOf(current);
        let requested: HTMLButtonElement | null = null;
        if (event.key === "ArrowDown") requested = items[currentIndex + 1] ?? null;
        if (event.key === "ArrowUp") requested = items[currentIndex - 1] ?? null;
        if (event.key === "Home") requested = items[0] ?? null;
        if (event.key === "End") requested = items.at(-1) ?? null;
        if (event.key === "ArrowRight" && current.hasAttribute("aria-expanded")) {
          if (current.getAttribute("aria-expanded") !== "true") setExpanded(current, true);
          else requested = items[currentIndex + 1] ?? null;
        }
        if (event.key === "ArrowLeft") {
          if (current.getAttribute("aria-expanded") === "true") setExpanded(current, false);
          else if (current.dataset.parentNodeId) requested = nodeButton(current.dataset.parentNodeId);
        }
        if (!requested && !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        if (requested) {
          items.forEach((button) => { button.tabIndex = -1; });
          requested.tabIndex = 0;
          requested.focus();
        }
      });
    },
    clear(inputFormat) {
      const hadTreeFocus = document.activeElement instanceof Element && table.contains(document.activeElement);
      tree.replaceChildren();
      completeFileTableBody(tree, {
        columnCount: 10,
        emptyMessage: `目前沒有 ${FILE_FORMAT_LABELS[inputFormat]} 檔案。`,
        hasRows: false,
      });
      updateFileTableFooter(total, 0, Array(8).fill("—"));
      collapsedNodes.clear();
      currentOutputRows.clear();
      if (hadTreeFocus) selectSourceButton.focus({ preventScroll: true });
    },
    render,
  };
}
