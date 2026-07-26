export function renderColumnEditor(
  container: HTMLTableSectionElement,
  widths: readonly number[],
): void {
  let cumulativeWidth = 0;
  const rows = widths.map((width, index) => {
    const position = index + 1;
    cumulativeWidth += width;

    const row = document.createElement("tr");
    const heading = document.createElement("th");
    heading.scope = "row";
    heading.textContent = `欄位${position}`;

    const requiredCell = document.createElement("td");
    requiredCell.className = "center-cell";
    const required = document.createElement("input");
    required.id = `required-${index}`;
    required.className = "required-input";
    required.type = "checkbox";
    required.setAttribute("aria-label", `欄位${position}不可空白`);
    required.setAttribute("aria-describedby", "required-help");
    requiredCell.append(required);

    const defaultCell = document.createElement("td");
    const defaultValue = document.createElement("input");
    defaultValue.id = `default-${index}`;
    defaultValue.className = "default-input";
    defaultValue.type = "text";
    defaultValue.autocomplete = "off";
    defaultValue.placeholder = "選填";
    defaultValue.setAttribute("aria-label", `欄位${position}空值預設`);
    defaultValue.setAttribute("aria-describedby", "default-help");
    defaultCell.append(defaultValue);

    const widthCell = document.createElement("td");
    const widthInput = document.createElement("input");
    widthInput.id = `width-${index}`;
    widthInput.className = "width-input";
    widthInput.type = "number";
    widthInput.min = "1";
    widthInput.step = "1";
    widthInput.inputMode = "numeric";
    widthInput.value = String(width);
    widthInput.setAttribute("aria-label", `欄位${position}欄寬`);
    widthInput.setAttribute("aria-describedby", "width-help");
    widthCell.append(widthInput);

    const cumulativeCell = document.createElement("td");
    cumulativeCell.className = "number-cell cumulative-width";
    cumulativeCell.textContent = String(cumulativeWidth);

    row.append(heading, requiredCell, defaultCell, widthCell, cumulativeCell);
    return row;
  });

  container.replaceChildren(...rows);
}
