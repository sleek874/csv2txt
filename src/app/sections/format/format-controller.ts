import type { BatchClient } from "../../batch/batch-client";
import type { WorkspaceModel } from "../../state/workspace-model";
import type { FormatView } from "./format-view";

export function createFormatController(options: {
  batchClient: BatchClient;
  model: WorkspaceModel;
  view: FormatView;
}) {
  let outputGeneration = 0;
  return {
    bind() {
      options.view.bind({
        onInputChange: (format) => options.model.setInputFormat(format),
        onOutputChange: (format) => {
          const currentGeneration = ++outputGeneration;
          const records = options.model.snapshot().files.flatMap((item) => item.file ? [item.file] : []);
          options.model.setOutputFormat(format, records.length > 0 ? "loading" : "ready");
          if (records.length === 0) return;
          void options.batchClient.refreshOutput(records.map((file) => file.id), format).then((refreshed) => {
            if (currentGeneration === outputGeneration && options.model.snapshot().outputFormat === format) {
              options.model.updateFileRecords(refreshed);
              options.model.setOutputPreparation("ready");
            }
          }).catch(() => {
            if (currentGeneration === outputGeneration && options.model.snapshot().outputFormat === format) {
              if (options.model.snapshot().files.length === 0) options.model.setOutputPreparation("ready");
              else options.model.setOutputPreparation(
                "error",
                "無法完成輸出檢查。請重新選擇輸出格式後再試一次。",
              );
            }
          });
        },
      });
      options.model.subscribe(options.view.render);
      options.view.render(options.model.snapshot());
    },
  };
}
