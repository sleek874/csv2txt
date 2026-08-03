import { requireDescendant } from "../../../browser/dom";
import type { WorkspaceItem, WorkspaceSource } from "../../state/workspace-types";

export interface FileTreeView {
  bind(options: {
    onRemoveFile: (fileId: string) => void;
    onRemoveSource: (sourceId: string) => void;
    onSelect: (fileId: string) => void;
  }): void;
  clear(): void;
  render(
    sources: readonly WorkspaceSource[],
    files: readonly WorkspaceItem[],
    selectedFileId: string | null,
  ): void;
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

function filePresentation(item: WorkspaceItem): { label: string; tone: string } {
  if (item.state === "processing") return { label: "檢查中", tone: "info" };
  if (item.state === "error" || !item.file) return { label: "無法處理", tone: "error" };
  if (item.file.summary.errorCount > 0) {
    return { label: `${item.file.summary.errorCount} 錯誤`, tone: "error" };
  }
  if (item.file.summary.warningCount > 0) {
    return { label: `${item.file.summary.warningCount} 警告`, tone: "warning" };
  }
  return { label: "可下載", tone: "success" };
}

function groupPresentation(items: readonly WorkspaceItem[]): { label: string; tone: string } {
  if (items.some((item) => item.state === "processing")) {
    return { label: "檢查中", tone: "info" };
  }
  const errors = items.reduce((total, item) => (
    total + (item.state === "error" ? 1 : item.file?.summary.errorCount ?? 0)
  ), 0);
  if (errors > 0) return { label: `${errors} 錯誤`, tone: "error" };
  const warnings = items.reduce((total, item) => total + (item.file?.summary.warningCount ?? 0), 0);
  if (warnings > 0) return { label: `${warnings} 警告`, tone: "warning" };
  return { label: `${items.length} 個檔案`, tone: "success" };
}

function buildTree(
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

export function createFileTreeView(root: HTMLElement): FileTreeView {
  const tree = requireDescendant<HTMLUListElement>(root, "#file-tree");
  const count = requireDescendant<HTMLElement>(root, "#file-tree-count");
  const selectSourceButton = requireDescendant<HTMLButtonElement>(root, "#select-source-button");
  const collapsedNodes = new Set<string>();

  function nodeButton(nodeId: string): HTMLButtonElement | null {
    return Array.from(tree.querySelectorAll<HTMLButtonElement>("[data-tree-node-id]"))
      .find((button) => button.dataset.treeNodeId === nodeId) ?? null;
  }

  function visibleButtons(): HTMLButtonElement[] {
    return Array.from(tree.querySelectorAll<HTMLButtonElement>("[data-tree-node-id]"))
      .filter((button) => !button.closest<HTMLUListElement>("ul[hidden]"));
  }

  function setExpanded(button: HTMLButtonElement, expanded: boolean): void {
    const nodeId = button.dataset.treeNodeId;
    const group = button.closest("li")?.querySelector<HTMLUListElement>(":scope > ul[role='group']");
    if (!nodeId || !group) return;
    button.setAttribute("aria-expanded", String(expanded));
    group.hidden = !expanded;
    if (expanded) collapsedNodes.delete(nodeId);
    else collapsedNodes.add(nodeId);
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
        const button = target?.closest<HTMLButtonElement>("[data-tree-node-id]");
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
      const hadTreeFocus = document.activeElement instanceof Element
        && tree.contains(document.activeElement);
      tree.replaceChildren();
      count.textContent = "";
      collapsedNodes.clear();
      if (hadTreeFocus) selectSourceButton.focus({ preventScroll: true });
    },
    render(sources, files, selectedFileId) {
      const hadTreeFocus = document.activeElement instanceof Element
        && tree.contains(document.activeElement);
      const focusedNodeId = document.activeElement instanceof HTMLButtonElement
        ? document.activeElement.dataset.treeNodeId
        : undefined;
      tree.replaceChildren();
      count.textContent = `${sources.length} 個來源 · ${files.length} 個檔案`;

      function appendNode(node: TreeNode, parent: HTMLUListElement, parentNodeId?: string): void {
        const presentation = node.item
          ? filePresentation(node.item)
          : groupPresentation(node.items);
        const listItem = document.createElement("li");
        listItem.setAttribute("role", "none");
        const row = document.createElement("div");
        row.className = "file-tree-row";
        row.dataset.selected = String(node.item?.id === selectedFileId);

        const button = document.createElement("button");
        button.className = "file-tree-item";
        button.type = "button";
        button.setAttribute("role", "treeitem");
        button.setAttribute("aria-selected", String(node.item?.id === selectedFileId));
        button.dataset.treeNodeId = node.id;
        button.dataset.tone = presentation.tone;
        if (parentNodeId) button.dataset.parentNodeId = parentNodeId;
        if (node.item) button.dataset.fileId = node.item.id;
        if (node.children.length > 0) {
          button.setAttribute("aria-expanded", String(!collapsedNodes.has(node.id)));
        }

        const disclosure = document.createElement("span");
        disclosure.className = "file-tree-disclosure";
        disclosure.setAttribute("aria-hidden", "true");
        disclosure.textContent = node.children.length > 0 ? "›" : "";
        const marker = document.createElement("span");
        marker.className = "file-tree-marker";
        marker.setAttribute("aria-hidden", "true");
        const name = document.createElement("span");
        name.className = "file-tree-name";
        name.textContent = node.label;
        name.title = node.item?.virtualPath ?? node.label;
        const state = document.createElement("span");
        state.className = "file-tree-state";
        state.textContent = presentation.label;
        button.setAttribute("aria-label", `${node.label}，${presentation.label}`);
        button.append(disclosure, marker, name, state);

        const remove = document.createElement("button");
        remove.className = "file-tree-remove";
        remove.type = "button";
        remove.textContent = "×";
        if (node.kind === "source") {
          remove.dataset.removeSourceId = node.source.id;
          remove.setAttribute("aria-label", `從工作區移除 ${node.source.name}`);
        } else if (node.kind === "file" && node.item) {
          remove.dataset.removeFileId = node.item.id;
          remove.setAttribute("aria-label", `從工作區移除 ${node.item.virtualPath}`);
        } else {
          remove.hidden = true;
        }
        remove.title = "從工作區移除";
        row.append(button, remove);
        listItem.append(row);

        if (node.children.length > 0) {
          const group = document.createElement("ul");
          group.className = "file-tree-group";
          group.setAttribute("role", "group");
          group.hidden = collapsedNodes.has(node.id);
          node.children.forEach((child) => appendNode(child, group, node.id));
          listItem.append(group);
        }
        parent.append(listItem);
      }

      buildTree(sources, files).forEach((node) => appendNode(node, tree));
      const buttons = Array.from(tree.querySelectorAll<HTMLButtonElement>("[data-tree-node-id]"));
      const selected = buttons.find((button) => button.dataset.fileId === selectedFileId) ?? null;
      const active = selected && !selected.closest<HTMLUListElement>("ul[hidden]")
        ? selected
        : visibleButtons()[0] ?? null;
      buttons.forEach((button) => { button.tabIndex = button === active ? 0 : -1; });
      if (hadTreeFocus) {
        const replacement = focusedNodeId ? nodeButton(focusedNodeId) : null;
        const focusTarget = replacement && !replacement.closest<HTMLUListElement>("ul[hidden]")
          ? replacement
          : active;
        focusTarget?.focus({ preventScroll: true });
      }
    },
  };
}
