import type {
  Alignment,
  ConversionResult,
  ValidationIssue,
} from "../core/types";

const ISSUE_DISPLAY_LIMIT = 200;
const WHITESPACE_MARKERS: Readonly<
  Record<string, { symbol: string; label: string; wide?: boolean }>
> = {
  " ": { symbol: "·", label: "半形空格" },
  "　": { symbol: "□", label: "全形空格", wide: true },
  "\t": { symbol: "→", label: "定位字元" },
  "\r": { symbol: "↵", label: "換行字元" },
  "\n": { symbol: "↵", label: "換行字元" },
  "\u00a0": { symbol: "⍽", label: "不換行空格" },
};

interface ResultsViewOptions {
  alignment: () => Alignment;
  issueTableBody: HTMLTableSectionElement;
  previewResults: HTMLElement;
  previewRowLimitSelect: HTMLSelectElement;
}

export function createResultsView(options: ResultsViewOptions) {
  function appendPreviewValue(container: HTMLElement, value: string): void {
    let plainText = "";

    const flushPlainText = (): void => {
      if (plainText !== "") {
        container.append(document.createTextNode(plainText));
        plainText = "";
      }
    };

    for (let index = 0; index < value.length; index += 1) {
      let character = value[index] ?? "";
      if (character === "\r" && value[index + 1] === "\n") {
        character = "\r";
        index += 1;
      }
      const markerDefinition = WHITESPACE_MARKERS[character];
      if (!markerDefinition) {
        plainText += character;
        continue;
      }

      flushPlainText();
      const marker = document.createElement("span");
      marker.className = markerDefinition.wide
        ? "content-whitespace-marker content-whitespace-marker-wide"
        : "content-whitespace-marker";
      marker.textContent = markerDefinition.symbol;
      marker.setAttribute("aria-label", markerDefinition.label);
      container.append(marker);
    }

    flushPlainText();
  }

  function renderPreview(result: ConversionResult): void {
    const previousScrollLeft =
      options.previewResults.querySelector<HTMLElement>(".preview-chunk")?.scrollLeft ?? 0;
    options.previewResults.replaceChildren();
    const allValidRows = result.rows.filter((row) => row.valid);
    const selectedLimit = options.previewRowLimitSelect.value === "all"
      ? allValidRows.length
      : Number(options.previewRowLimitSelect.value);
    const validRows = allValidRows.slice(0, selectedLimit);

    if (validRows.length === 0) {
      const notice = document.createElement("div");
      notice.className = "notice error-notice";
      const strong = document.createElement("strong");
      strong.textContent = "沒有可預覽的資料";
      const detail = document.createElement("span");
      detail.textContent = "請查看問題清單。";
      notice.append(strong, detail);
      options.previewResults.append(notice);
      return;
    }

    const heading = document.createElement("p");
    heading.className = "preview-heading";
    heading.textContent = validRows.length === allValidRows.length
      ? `全部 ${allValidRows.length} 筆正確資料預覽（每筆 ${result.recordWidthBytes} 位元組）`
      : `前 ${validRows.length} / ${allValidRows.length} 筆正確資料預覽（每筆 ${result.recordWidthBytes} 位元組）`;
    options.previewResults.append(heading);

    const previewChunk = document.createElement("div");
    previewChunk.className = "preview-chunk";
    previewChunk.tabIndex = 0;
    previewChunk.setAttribute("aria-label", "正確資料預覽，可上下及左右捲動");
    const previewChunkRows = document.createElement("div");
    previewChunkRows.className = "preview-chunk-rows";

    const columnGuide = document.createElement("div");
    columnGuide.className = "preview-column-guide";
    const columnGuideLabel = document.createElement("span");
    columnGuideLabel.className = "preview-column-guide-label";
    columnGuideLabel.textContent = "欄位";
    const columnGuideFields = document.createElement("div");
    columnGuideFields.className = "preview-column-guide-fields big5-text";

    const guideSourceFields = validRows[0]?.fields ?? [];
    guideSourceFields.forEach((field) => {
      const widthBytes = field.valueBytes + field.paddingBytes;
      const guideField = document.createElement("span");
      guideField.className = "column-guide-fragment";
      guideField.style.width = `${widthBytes}ch`;
      guideField.setAttribute(
        "aria-label",
        `欄位${field.fieldIndex}：欄寬 ${widthBytes} 位元組`,
      );

      const number = document.createElement("span");
      number.className = "column-guide-number";
      number.textContent = String(field.fieldIndex);
      number.setAttribute("aria-hidden", "true");
      guideField.append(number);
      columnGuideFields.append(guideField);
    });

    columnGuide.append(columnGuideLabel, columnGuideFields);
    previewChunkRows.append(columnGuide);

    validRows.forEach((row) => {
      const record = document.createElement("div");
      record.className = "preview-record";
      const label = document.createElement("span");
      label.className = "preview-row-label";
      label.textContent = `第 ${row.sourceRow} 筆`;
      const output = document.createElement("pre");
      output.className = "big5-text";

      row.fields.forEach((field) => {
        const fieldFragment = document.createElement("span");
        fieldFragment.className = "field-fragment";
        fieldFragment.style.width = `${field.valueBytes + field.paddingBytes}ch`;

        const source = document.createElement("span");
        source.className = field.usedDefault ? "value-fragment default-fragment" : "value-fragment";
        source.style.width = `${field.valueBytes}ch`;
        source.title = field.usedDefault
          ? `欄位${field.fieldIndex}：使用空值預設，${field.valueBytes} 位元組`
          : `欄位${field.fieldIndex}：${field.valueBytes} 位元組`;
        appendPreviewValue(source, field.resolvedValue);

        const padding = document.createElement("span");
        padding.className = "padding-fragment";
        padding.style.width = `${field.paddingBytes}ch`;
        const paddingDots = document.createElement("span");
        paddingDots.setAttribute("aria-hidden", "true");
        paddingDots.textContent = "·".repeat(field.paddingBytes);
        padding.append(paddingDots);
        if (field.paddingBytes > 0) {
          padding.setAttribute(
            "aria-label",
            `欄位${field.fieldIndex}：補 ${field.paddingBytes} 個空格`,
          );
        } else {
          padding.setAttribute("aria-hidden", "true");
        }

        if (options.alignment() === "right") {
          fieldFragment.append(padding, source);
        } else {
          fieldFragment.append(source, padding);
        }
        output.append(fieldFragment);
      });

      record.append(label, output);
      previewChunkRows.append(record);
    });

    previewChunk.append(previewChunkRows);
    options.previewResults.append(previewChunk);
    previewChunk.scrollLeft = previousScrollLeft;
  }

  function renderIssues(issues: readonly ValidationIssue[]): void {
    options.issueTableBody.replaceChildren();

    if (issues.length === 0) {
      const row = options.issueTableBody.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 4;
      cell.className = "empty-table-message success-message";
      cell.textContent = "驗證通過，可以下載。";
      return;
    }

    issues.slice(0, ISSUE_DISPLAY_LIMIT).forEach((issue) => {
      const row = options.issueTableBody.insertRow();
      row.className = issue.severity === "error" ? "issue-error" : "issue-warning";
      row.insertCell().textContent = issue.sourceRow ? String(issue.sourceRow) : "—";
      row.insertCell().textContent = issue.fieldIndex ? `欄位${issue.fieldIndex}` : "—";
      row.insertCell().textContent = issue.severity === "error" ? "錯誤" : "提醒";
      row.insertCell().textContent = issue.message;
    });

    if (issues.length > ISSUE_DISPLAY_LIMIT) {
      const row = options.issueTableBody.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 4;
      cell.className = "empty-table-message";
      cell.textContent = `另有 ${issues.length - ISSUE_DISPLAY_LIMIT} 項問題未顯示。`;
    }
  }

  return { renderIssues, renderPreview };
}
