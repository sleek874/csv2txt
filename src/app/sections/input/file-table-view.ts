export function completeFileTableBody(
  body: HTMLTableSectionElement,
  options: {
    columnCount: number;
    emptyMessage: string;
    hasRows: boolean;
  },
): void {
  const row = body.insertRow();
  row.className = options.hasRows ? "inventory-table-spacer" : "inventory-table-empty-row";
  if (options.hasRows) row.setAttribute("aria-hidden", "true");
  const cell = row.insertCell();
  cell.colSpan = options.columnCount;
  if (!options.hasRows) {
    cell.className = "empty-table-message";
    const message = document.createElement("span");
    message.className = "empty-table-message-copy";
    message.textContent = options.emptyMessage;
    cell.append(message);
  }
}

export function updateFileTableFooter(
  row: HTMLTableRowElement,
  fileCount: number,
  values: readonly (number | string)[] = [],
): void {
  const label = row.querySelector<HTMLElement>("[data-total-label]");
  if (label) label.textContent = `全部 ${fileCount} 個檔案`;
  row.querySelectorAll<HTMLElement>("[data-total-value]").forEach((cell, index) => {
    cell.textContent = String(values[index] ?? "");
  });
}
