import type { BatchClient } from "../../batch/batch-client";
import type { WorkspaceModel } from "../../state/workspace-model";
import type { FormatView } from "./format-view";

export function createFormatController(options: {
  batchClient: BatchClient;
  model: WorkspaceModel;
  view: FormatView;
}) {
  function render(): void {
    options.view.render(options.model.snapshot());
  }

  return {
    bind() {
      options.view.bind({
        onInputChange(format) {
          if (options.model.snapshot().inputFormat === format) return;
          options.batchClient.invalidateOutput();
          options.model.setInputFormat(format);
        },
        onOutputChange(format) {
          if (options.model.snapshot().outputFormat === format) return;
          options.batchClient.invalidateOutput();
          options.model.setOutputFormat(format);
        },
      });
      options.model.subscribe(render);
      render();
    },
  };
}
