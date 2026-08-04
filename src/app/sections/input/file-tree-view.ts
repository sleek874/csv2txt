import { requireDescendant } from "../../../browser/dom";
import type { OutputIssue } from "../../../core/output-validation";
import type { WorkspaceItem, WorkspaceSnapshot, WorkspaceSource } from "../../state/workspace-types";

export type InventoryFilter = "error" | "warning" | "output";

export interface FileTreeView {
  bind(options: {
    onInspect: (fileId: string, filter: InventoryFilter) => void;
    onMarkAllViewed: () => void;
    onRemoveFile: (fileId: string) => void;
    onRemoveSource: (sourceId: string) => void;
    onSelect: (fileId: string) => void;
  }): void;
  clear(): void;
  render(snapshot: WorkspaceSnapshot, outputIssues: readonly OutputIssue[]): void;
}

export interface InventoryMetrics {
  correctRows: number | null;
  errorCount: number | null;
  ignoredCount: number;
  outputProblems: number | null;
  selectedRows: number | null;
  sourceRows: number | null;
  unreadCount: number;
  warningCount: number | null;
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
  outputIssues.forEach((issue) => {
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
  const includedItems = items.filter((item) => item.state !== "ignored");
  const processing = includedItems.some((item) => item.state === "processing");
  const ignoredCount = items.filter((item) => item.state === "ignored").length;
  const unreadCount = items.filter((item) => item.unread).length;
  if (includedItems.length === 0) {
    return {
      correctRows: null,
      errorCount: null,
      ignoredCount,
      outputProblems: null,
      selectedRows: null,
      sourceRows: null,
      unreadCount,
      warningCount: null,
    };
  }
  if (processing) {
    return {
      correctRows: null,
      errorCount: null,
      ignoredCount,
      outputProblems: null,
      selectedRows: null,
      sourceRows: null,
      unreadCount,
      warningCount: null,
    };
  }
  if (includedItems.every((item) => item.state === "error" || !item.file)) {
    return {
      correctRows: null,
      errorCount: includedItems.length,
      ignoredCount,
      outputProblems: null,
      selectedRows: null,
      sourceRows: null,
      unreadCount,
      warningCount: 0,
    };
  }
  return includedItems.reduce<InventoryMetrics>((metrics, item) => ({
    correctRows: (metrics.correctRows ?? 0) + (item.file?.summary.outputRows ?? 0),
    errorCount: (metrics.errorCount ?? 0) + (
      item.state === "error" ? 1 : item.file?.summary.errorCount ?? 0
    ),
    ignoredCount,
    outputProblems: (metrics.outputProblems ?? 0) + (outputIssueRows.get(item.id)?.size ?? 0),
    selectedRows: (metrics.selectedRows ?? 0) + (item.file?.summary.includedRows ?? 0),
    sourceRows: (metrics.sourceRows ?? 0) + (item.file?.summary.sourceRows ?? 0),
    unreadCount,
    warningCount: (metrics.warningCount ?? 0) + (item.file?.summary.warningCount ?? 0),
  }), {
    correctRows: 0,
    errorCount: 0,
    ignoredCount,
    outputProblems: 0,
    selectedRows: 0,
    sourceRows: 0,
    unreadCount,
    warningCount: 0,
  });
}

function itemPresentation(item: WorkspaceItem): { label: string; tone: string } {
  if (item.state === "ignored") return {
    label: item.ignoredReason === "symlink" ? "捷徑不會加入" : "不支援的檔案類型",
    tone: "neutral",
  };
  if (item.state === "processing") return { label: "檢查中", tone: "info" };
  if (item.state === "error" || !item.file) return { label: "無法開啟", tone: "error" };
  return findingPresentation(item.file.summary.errorCount, item.file.summary.warningCount)
    ?? { label: "已準備好", tone: "success" };
}

function groupPresentation(items: readonly WorkspaceItem[]): { label: string; tone: string } {
  if (items.some((item) => item.state === "processing")) {
    return { label: "檢查中", tone: "info" };
  }
  const active = items.filter((item) => item.state !== "ignored");
  if (active.length === 0) return { label: `${items.length} 個未加入`, tone: "neutral" };
  const errors = active.reduce((total, item) => (
    total + (item.state === "error" ? 1 : item.file?.summary.errorCount ?? 0)
  ), 0);
  const warnings = active.reduce((total, item) => total + (item.file?.summary.warningCount ?? 0), 0);
  return findingPresentation(errors, warnings)
    ?? { label: `${active.length} 個檔案`, tone: "success" };
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
    if (!item.file) return filter === "error" && item.state === "error";
    if (filter === "error") return item.file.summary.errorCount > 0;
    if (filter === "warning") return item.file.summary.warningCount > 0;
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
  const markAllViewed = requireDescendant<HTMLButtonElement>(root, "#mark-all-viewed-button");
  const selectSourceButton = requireDescendant<HTMLButtonElement>(root, "#select-source-button");
  const collapsedNodes = new Set<string>();
  let currentOutputRows = new Map<string, Set<number>>();

  function appendSpacer(): void {
    const spacer = tree.insertRow();
    spacer.className = "inventory-table-spacer";
    spacer.setAttribute("aria-hidden", "true");
    const spacerCell = spacer.insertCell();
    spacerCell.colSpan = 8;
  }

  function resetTotal(): void {
    const totalLabel = total.querySelector<HTMLElement>("[data-total-label]");
    if (totalLabel) totalLabel.textContent = "全部 0 個檔案";
    total.querySelectorAll<HTMLElement>("[data-total-value]").forEach((cell) => {
      cell.textContent = "0";
    });
  }

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
      pending?: boolean;
      tone?: string;
    },
  ): void {
    const cell = row.insertCell();
    cell.className = "inventory-number-cell";
    if (options?.tone) cell.dataset.tone = options.tone;
    if (value === null) {
      cell.textContent = options?.pending || options?.file?.state === "processing" ? "…" : "—";
      return;
    }
    if (value > 0 && options?.file && options.filter) {
      const button = document.createElement("button");
      button.className = "inventory-count-button";
      button.type = "button";
      button.textContent = String(value);
      button.dataset.inspectFileId = options.file.id;
      button.dataset.inspectFilter = options.filter;
      const label = options.filter === "error" ? "錯誤" : options.filter === "warning" ? "警告" : "輸出問題";
      button.setAttribute("aria-label", `查看 ${options.file.virtualPath} 的${label}，共 ${value}`);
      cell.append(button);
      return;
    }
    cell.textContent = String(value);
  }

  function render(snapshot: WorkspaceSnapshot, outputIssues: readonly OutputIssue[]): void {
    const hadTreeFocus = document.activeElement instanceof Element && table.contains(document.activeElement);
    const focusedNodeId = document.activeElement instanceof HTMLButtonElement
      ? document.activeElement.dataset.treeNodeId
      : undefined;
    currentOutputRows = issueRowsByFile(outputIssues);
    const supportedCount = snapshot.files.filter((item) => item.state !== "ignored").length;
    const unreadCount = snapshot.files.filter((item) => item.unread).length;
    markAllViewed.hidden = unreadCount === 0;
    markAllViewed.textContent = "全部標示為已查看";
    tree.replaceChildren();

    function appendNode(
      node: TreeNode,
      depth: number,
      parentNodeId?: string,
      ancestorNodeIds: readonly string[] = [],
    ): void {
      const metrics = inventoryMetrics(node.items, currentOutputRows);
      const pending = node.items.some((item) => item.state === "processing");
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
      if (metrics.ignoredCount > 0) appendBadge(
        badgeLine,
        node.item ? "未加入" : `未加入 ${metrics.ignoredCount}`,
        "neutral",
      );
      copy.append(nameLine, badgeLine);
      const typeLabel = node.kind === "folder" ? "資料夾" : node.source.kind === "archive" && node.kind === "source"
        ? "壓縮檔"
        : "檔案";
      button.setAttribute("aria-label", `${typeLabel} ${node.label}，${presentation.label}`);
      button.append(disclosure, copy);
      nameCell.append(button);
      row.append(nameCell);

      const errorFile = metrics.errorCount && metrics.errorCount > 0
        ? firstAffectedFile(node, "error", currentOutputRows)
        : null;
      const warningFile = metrics.warningCount && metrics.warningCount > 0
        ? firstAffectedFile(node, "warning", currentOutputRows)
        : null;
      const outputFile = metrics.outputProblems && metrics.outputProblems > 0
        ? firstAffectedFile(node, "output", currentOutputRows)
        : null;
      appendMetric(row, metrics.sourceRows, { file: node.item, pending });
      appendMetric(row, metrics.correctRows, { file: node.item, pending, tone: "success" });
      appendMetric(row, metrics.errorCount, { file: errorFile, filter: "error", pending, tone: "error" });
      appendMetric(row, metrics.warningCount, { file: warningFile, filter: "warning", pending, tone: "warning" });
      appendMetric(row, metrics.selectedRows, { file: node.item, pending });
      appendMetric(row, metrics.outputProblems, { file: outputFile, filter: "output", pending, tone: "error" });

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
      removeCell.append(remove);

      node.children.forEach((child) => appendNode(
        child,
        depth + 1,
        node.id,
        [...ancestorNodeIds, node.id],
      ));
    }

    buildTree(snapshot.sources, snapshot.files).forEach((node) => appendNode(node, 1));
    appendSpacer();
    updateVisibility();

    const totalMetrics = inventoryMetrics(snapshot.files, currentOutputRows);
    const totalLabel = total.querySelector<HTMLElement>("[data-total-label]");
    if (totalLabel) {
      totalLabel.textContent = `全部 ${supportedCount} 個檔案`;
    }
    const totalValues = [
      totalMetrics.sourceRows,
      totalMetrics.correctRows,
      totalMetrics.errorCount,
      totalMetrics.warningCount,
      totalMetrics.selectedRows,
      totalMetrics.outputProblems,
    ];
    total.querySelectorAll<HTMLElement>("[data-total-value]").forEach((cell, index) => {
      cell.textContent = totalValues[index] === null
        ? snapshot.files.some((item) => item.state === "processing") ? "…" : "—"
        : String(totalValues[index]);
    });

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
      markAllViewed.addEventListener("click", options.onMarkAllViewed);
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
    clear() {
      const hadTreeFocus = document.activeElement instanceof Element && table.contains(document.activeElement);
      tree.replaceChildren();
      appendSpacer();
      resetTotal();
      markAllViewed.hidden = true;
      collapsedNodes.clear();
      currentOutputRows.clear();
      if (hadTreeFocus) selectSourceButton.focus({ preventScroll: true });
    },
    render,
  };
}
