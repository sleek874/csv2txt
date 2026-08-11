import type { CodecManager } from "../../resources/codec-manager";
import type { WorkspaceModel } from "../../state/workspace-model";
import type { FormatView } from "./format-view";

export function createFormatController(options: {
  codecs: CodecManager;
  model: WorkspaceModel;
  view: FormatView;
}) {
  return {
    bind() {
      options.view.bind({
        onInputChange: (format) => options.model.setInputFormat(format),
        onOutputChange: (format) => {
          options.model.setOutputFormat(format);
          void options.codecs.prepareOutput(format).catch(() => {
            // Output preparation errors are shown when download is requested.
          });
        },
      });
      options.model.subscribe(options.view.render);
      options.view.render(options.model.snapshot());
    },
  };
}
