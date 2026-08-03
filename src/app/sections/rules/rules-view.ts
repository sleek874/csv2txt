import { requireDescendant, requireElement } from "../../../browser/dom";
import { FIXED_FIELDS } from "../../../core/fixed-profile";

export interface FixedRulePresentation {
  fieldLabel: string;
  widthBytes: number;
  pattern: string;
  description: string;
}

export function getFixedRulePresentations(): readonly FixedRulePresentation[] {
  return FIXED_FIELDS.map((field) => ({
    fieldLabel: `欄位${field.index}`,
    widthBytes: field.widthBytes,
    pattern: field.pattern.source,
    description: field.description,
  }));
}

function createTextCell(value: string): HTMLTableCellElement {
  const cell = document.createElement("td");
  cell.textContent = value;
  return cell;
}

function renderFixedRules(body: HTMLTableSectionElement): void {
  const rows = document.createDocumentFragment();
  getFixedRulePresentations().forEach((field) => {
    const row = document.createElement("tr");
    const heading = document.createElement("th");
    const patternCell = document.createElement("td");
    const pattern = document.createElement("code");
    heading.scope = "row";
    heading.textContent = field.fieldLabel;
    pattern.textContent = field.pattern;
    patternCell.append(pattern);
    row.append(
      heading,
      createTextCell(String(field.widthBytes)),
      patternCell,
      createTextCell(field.description),
    );
    rows.append(row);
  });
  body.replaceChildren(rows);
}

export function bindRulesView(): void {
  const root = requireElement<HTMLElement>("#rules-step");
  const disclosure = requireDescendant<HTMLDetailsElement>(root, "#rules-disclosure");
  const body = requireDescendant<HTMLTableSectionElement>(root, "#fixed-rules-body");
  const renderOnFirstOpen = (): void => {
    if (!disclosure.open) return;
    renderFixedRules(body);
    disclosure.removeEventListener("toggle", renderOnFirstOpen);
  };
  if (disclosure.open) {
    renderFixedRules(body);
    return;
  }
  disclosure.addEventListener("toggle", renderOnFirstOpen);
}
