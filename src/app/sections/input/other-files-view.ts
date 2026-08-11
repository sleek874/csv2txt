import { requireDescendant } from "../../../browser/dom";
import { FILE_FORMAT_LABELS } from "../../../core/file-formats";
import { otherWorkspaceItems } from "../../state/workspace-selectors";
import type { WorkspaceItem, WorkspaceSnapshot } from "../../state/workspace-types";
import { completeFileTableBody, updateFileTableFooter } from "./file-table-view";

export interface OtherFilesView {
  bind(onRemoveFile: (fileId: string) => void): void;
  clear(): void;
  render(snapshot: WorkspaceSnapshot): void;
}

function unsupportedFileType(item: Pick<WorkspaceItem, "ignoredReason" | "virtualPath">): string {
  if (item.ignoredReason === "symlink") return "不支援（捷徑）";
  const fileName = item.virtualPath.split("/").at(-1) ?? item.virtualPath;
  const extension = fileName.match(/\.([^.]{1,8})$/u)?.[1]?.toLocaleUpperCase("en-US");
  return `不支援（${extension || "檔案類型"}）`;
}

export function otherFilePresentation(
  item: Pick<WorkspaceItem, "ignoredReason" | "sourceFormat" | "state" | "virtualPath">,
): { format: string; status: string } {
  if (item.state === "error" && !item.sourceFormat) {
    return {
      format: "壓縮檔",
      status: "未加入",
    };
  }
  if (item.state === "ignored") {
    return {
      format: unsupportedFileType(item),
      status: "未加入",
    };
  }
  if (!item.sourceFormat) {
    return { format: "不支援（檔案類型）", status: "未加入" };
  }
  return {
    format: FILE_FORMAT_LABELS[item.sourceFormat],
    status: "已保留",
  };
}

export function createOtherFilesView(root: HTMLElement): OtherFilesView {
  const list = requireDescendant<HTMLTableSectionElement>(root, "#other-files-list");
  const total = requireDescendant<HTMLTableRowElement>(root, "#other-files-total");

  function renderEmpty(): void {
    list.replaceChildren();
    completeFileTableBody(list, {
      columnCount: 4,
      emptyMessage: "目前沒有其他檔案。",
      hasRows: false,
    });
    updateFileTableFooter(total, 0);
  }

  return {
    bind(onRemoveFile) {
      list.addEventListener("click", (event) => {
        const button = event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>("[data-remove-file-id]")
          : null;
        if (button?.dataset.removeFileId) onRemoveFile(button.dataset.removeFileId);
      });
    },
    clear() {
      renderEmpty();
    },
    render(snapshot) {
      const items = otherWorkspaceItems(snapshot);
      list.replaceChildren();
      if (items.length === 0) {
        renderEmpty();
        return;
      }
      items.forEach((item) => {
        const row = list.insertRow();
        row.dataset.kind = "file";
        const nameCell = document.createElement("th");
        nameCell.scope = "row";
        nameCell.className = "inventory-name-cell";
        const itemCopy = document.createElement("div");
        itemCopy.className = "file-tree-item other-file-item";
        const disclosure = document.createElement("span");
        disclosure.className = "file-tree-disclosure";
        disclosure.setAttribute("aria-hidden", "true");
        const nameLine = document.createElement("span");
        nameLine.className = "file-tree-name-line";
        const name = document.createElement("span");
        name.className = "file-tree-name";
        name.textContent = item.virtualPath;
        name.title = item.virtualPath;
        nameLine.append(name);
        itemCopy.append(disclosure, nameLine);
        nameCell.append(itemCopy);
        row.append(nameCell);
        const presentation = otherFilePresentation(item);
        const format = row.insertCell();
        format.className = "other-file-format";
        format.textContent = presentation.format;
        const status = row.insertCell();
        status.className = "other-file-status";
        status.textContent = presentation.status;
        const removeCell = row.insertCell();
        removeCell.className = "inventory-remove-cell";
        const remove = document.createElement("button");
        remove.className = "file-tree-remove";
        remove.type = "button";
        remove.textContent = "×";
        remove.dataset.removeFileId = item.id;
        remove.setAttribute("aria-label", `從清單移除 ${item.virtualPath}`);
        remove.title = "從清單移除";
        removeCell.append(remove);
      });
      completeFileTableBody(list, {
        columnCount: 4,
        emptyMessage: "目前沒有其他檔案。",
        hasRows: true,
      });
      updateFileTableFooter(total, items.length);
    },
  };
}
