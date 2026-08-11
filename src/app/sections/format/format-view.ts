import { requireDescendant, requireElement } from "../../../browser/dom";
import {
  FILE_FORMAT_LABELS,
  fileFormatForOutput,
  outputFormatForFileFormat,
  type FileFormat,
  type OutputFormat,
} from "../../../core/file-formats";
import type { WorkspaceSnapshot } from "../../state/workspace-types";

export interface FormatView {
  bind(options: {
    onInputChange: (format: FileFormat) => void;
    onOutputChange: (format: OutputFormat) => void;
  }): void;
  render(snapshot: WorkspaceSnapshot): void;
}

function fileFormat(value: string): FileFormat {
  return value === "csv" || value === "xlsx" ? value : "txt";
}

export function createFormatView(): FormatView {
  const root = requireElement<HTMLElement>("#format-step");
  const input = requireDescendant<HTMLSelectElement>(root, "#input-format");
  const output = requireDescendant<HTMLSelectElement>(root, "#selected-output-format");
  const summary = requireDescendant<HTMLElement>(root, "#format-summary");

  return {
    bind(options) {
      input.addEventListener("change", () => options.onInputChange(fileFormat(input.value)));
      output.addEventListener("change", () => (
        options.onOutputChange(outputFormatForFileFormat(fileFormat(output.value)))
      ));
    },
    render(snapshot) {
      const outputFileFormat = fileFormatForOutput(snapshot.outputFormat);
      input.value = snapshot.inputFormat;
      output.value = outputFileFormat;
      summary.textContent = `將把 ${FILE_FORMAT_LABELS[snapshot.inputFormat]} 檔轉換成 ${FILE_FORMAT_LABELS[outputFileFormat]} 檔。`;
    },
  };
}
