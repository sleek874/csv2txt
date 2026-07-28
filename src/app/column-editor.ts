import type { ColumnSetting } from "../core/types";

interface ColumnControls {
  cumulativeWidth: HTMLElement;
  defaultValue: HTMLInputElement;
  required: HTMLInputElement;
  width: HTMLInputElement;
}

export interface ColumnEditorSnapshot {
  columns: ColumnSetting[] | null;
  totalWidth: number | null;
}

export interface ColumnEditor {
  readonly columnCount: number;
  apply(columns: readonly ColumnSetting[]): void;
  bind(onChange: () => void): void;
  collect(): ColumnEditorSnapshot;
}

function setAriaInvalid(element: HTMLElement, invalid: boolean): void {
  if (invalid) {
    element.setAttribute("aria-invalid", "true");
  } else {
    element.removeAttribute("aria-invalid");
  }
}

export function createColumnEditor(
  container: HTMLTableSectionElement,
  widths: readonly number[],
): ColumnEditor {
  const rows = Array.from(container.rows);
  if (rows.length !== widths.length) {
    throw new Error("The static column editor does not match the default settings.");
  }

  const controls = rows.map((row, index): ColumnControls => {
    const position = index + 1;
    const heading = row.querySelector<HTMLTableCellElement>("th");
    const required = row.querySelector<HTMLInputElement>(".required-input");
    const defaultValue = row.querySelector<HTMLInputElement>(".default-input");
    const width = row.querySelector<HTMLInputElement>(".width-input");
    const cumulativeWidth = row.querySelector<HTMLElement>(".cumulative-width");

    if (!heading || !required || !defaultValue || !width || !cumulativeWidth) {
      throw new Error(`The static editor row for column ${position} is incomplete.`);
    }

    width.value = String(widths[index]);
    return { cumulativeWidth, defaultValue, required, width };
  });

  function syncDefaultInput(control: ColumnControls): void {
    control.defaultValue.disabled = control.required.checked;
    control.defaultValue.placeholder = control.required.checked ? "已停用" : "選填";
    if (control.required.checked) {
      control.defaultValue.value = "";
    }
  }

  function collect(): ColumnEditorSnapshot {
    let cumulativeWidth = 0;
    let widthsAreValid = true;
    const columns = controls.map((control): ColumnSetting => {
      const widthBytes = Number(control.width.value);
      const widthIsValid = Number.isInteger(widthBytes) && widthBytes >= 1;
      setAriaInvalid(control.width, !widthIsValid);
      widthsAreValid &&= widthIsValid;

      if (widthsAreValid) {
        cumulativeWidth += widthBytes;
        control.cumulativeWidth.textContent = String(cumulativeWidth);
      } else {
        control.cumulativeWidth.textContent = "—";
      }

      return {
        required: control.required.checked,
        defaultValue: control.required.checked ? "" : control.defaultValue.value,
        widthBytes,
      };
    });

    return {
      columns: widthsAreValid ? columns : null,
      totalWidth: widthsAreValid ? cumulativeWidth : null,
    };
  }

  function apply(columns: readonly ColumnSetting[]): void {
    if (columns.length !== controls.length) {
      throw new Error("The settings do not match the static column editor.");
    }

    controls.forEach((control, index) => {
      const column = columns[index];
      if (!column) {
        throw new Error(`The settings are missing column ${index + 1}.`);
      }
      control.required.checked = column.required;
      control.defaultValue.value = column.defaultValue;
      control.width.value = String(column.widthBytes);
      syncDefaultInput(control);
    });
    collect();
  }

  function bind(onChange: () => void): void {
    controls.forEach((control) => {
      control.width.addEventListener("input", onChange);
      control.defaultValue.addEventListener("input", onChange);
      control.required.addEventListener("change", () => {
        syncDefaultInput(control);
        onChange();
      });
    });
  }

  controls.forEach(syncDefaultInput);
  collect();

  return {
    columnCount: controls.length,
    apply,
    bind,
    collect,
  };
}
